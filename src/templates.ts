import fs from "fs";
import os from "os";
import path from "path";
import { parse } from "yaml";
import { TeamTemplate } from "./types";

type LoadedTemplate = { template: TeamTemplate; source: string };

const ALLOWED_MODELS = ["opus", "sonnet", "haiku", "inherit"] as const;
const ALLOWED_PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan", "ignore"] as const;
const ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Write", "Bash"] as const;

const envTemplatesDir = process.env.CCATG_TEMPLATES_DIR;
const builtinTemplatesDir = path.resolve(__dirname, "..", "templates");
const localTemplatesDir = path.resolve(process.cwd(), ".ccatg", "templates");
const orgTemplatesDir = path.resolve(os.homedir(), ".ccatg", "org-templates");

function assertAgentShape(agent: TeamTemplate["agents"][number], source: string, index: number): void {
  if (!agent.name || !agent.description || !agent.promptTemplate) {
    throw new Error(`Invalid agent in ${source} (index ${index}): name, description, and promptTemplate are required`);
  }
}

function assertTemplateShape(template: TeamTemplate, source: string): void {
  if (!template.id || !template.label || !template.description || !Array.isArray(template.agents)) {
    throw new Error(`Invalid template in ${source}: missing required fields`);
  }
  template.agents.forEach((agent, idx) => assertAgentShape(agent, source, idx));
}

function validateRootDirString(rootDir: string): void {
  if (path.isAbsolute(rootDir)) {
    throw new Error(`rootDir must be relative: ${rootDir}`);
  }
  const normalized = path.normalize(rootDir);
  if (normalized.startsWith("..")) {
    throw new Error(`rootDir must not traverse outside project: ${rootDir}`);
  }
}

function loadTemplatesFromDir(dir: string, options: { required: boolean }): LoadedTemplate[] {
  if (!fs.existsSync(dir)) {
    if (options.required) {
      throw new Error(`Templates directory not found: ${dir}`);
    }
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  if (files.length === 0) {
    if (options.required) {
      throw new Error(`No template files (*.yml) found in ${dir}`);
    }
    return [];
  }

  return files.map((file) => {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    let template: TeamTemplate;
    try {
      template = parse(content) as TeamTemplate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse YAML in ${fullPath}: ${message}`);
    }
    if (template.rootDir) {
      validateRootDirString(template.rootDir);
    }
    assertTemplateShape(template, fullPath);
    return { template, source: fullPath };
  });
}

function mergeTemplatesById(sources: LoadedTemplate[]): LoadedTemplate[] {
  const byId = new Map<string, LoadedTemplate>();
  for (const entry of sources) {
    byId.set(entry.template.id, entry);
  }
  return Array.from(byId.values()).sort((a, b) => a.template.id.localeCompare(b.template.id));
}

function loadTemplates(): LoadedTemplate[] {
  const searchOrder: Array<{ dir: string; required: boolean }> = [
    { dir: builtinTemplatesDir, required: true },
    { dir: orgTemplatesDir, required: false },
    { dir: localTemplatesDir, required: false }
  ];

  if (envTemplatesDir) {
    searchOrder.push({ dir: path.resolve(envTemplatesDir), required: true });
  }

  const collected: LoadedTemplate[] = [];
  for (const entry of searchOrder) {
    collected.push(...loadTemplatesFromDir(entry.dir, { required: entry.required }));
  }
  return mergeTemplatesById(collected);
}

let templatesCache: LoadedTemplate[];
try {
  templatesCache = loadTemplates();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ccatg] Failed to load templates: ${message}`);
  process.exit(1);
}

export const templatesWithSource: LoadedTemplate[] = templatesCache;
export const templates: TeamTemplate[] = templatesCache.map((t) => t.template);

export function getTemplateById(id: string): TeamTemplate | undefined {
  return templatesCache.find((t) => t.template.id === id)?.template;
}

export type TemplateValidationResult = {
  templateId: string;
  source: string;
  errors: string[];
};

export function validateTemplates(options: { allowMissingRootDir?: boolean } = {}): TemplateValidationResult[] {
  const projectRoot = process.cwd();
  return templatesCache.map((entry) => {
    const errors: string[] = [];
    const tmpl = entry.template;
    const agentNames = new Set<string>();
    tmpl.agents.forEach((agent, idx) => {
      if (agentNames.has(agent.name)) {
        errors.push(`agents[${idx}].name duplicates earlier agent '${agent.name}'`);
      } else {
        agentNames.add(agent.name);
      }
      if (agent.model && !ALLOWED_MODELS.includes(agent.model as typeof ALLOWED_MODELS[number])) {
        errors.push(`agents[${idx}].model must be one of ${ALLOWED_MODELS.join(", ")}`);
      }
      if (
        agent.permissionMode &&
        !ALLOWED_PERMISSION_MODES.includes(agent.permissionMode as typeof ALLOWED_PERMISSION_MODES[number])
      ) {
        errors.push(
          `agents[${idx}].permissionMode must be one of ${ALLOWED_PERMISSION_MODES.join(", ")}`
        );
      }
      if (agent.tools) {
        const invalid = agent.tools.filter((t) => !ALLOWED_TOOLS.includes(t as typeof ALLOWED_TOOLS[number]));
        if (invalid.length) {
          errors.push(`agents[${idx}].tools has unsupported values: ${invalid.join(", ")}`);
        }
      }
    });

    const rootDir = tmpl.rootDir ?? ".";
    try {
      validateRootDirString(rootDir);
      const resolved = path.resolve(projectRoot, rootDir);
      const normalizedProjectRoot = path.resolve(projectRoot);
      const isWithin =
        resolved === normalizedProjectRoot || resolved.startsWith(`${normalizedProjectRoot}${path.sep}`);
      if (!isWithin) {
        errors.push(`rootDir escapes project root: ${rootDir}`);
      }
      if (!options.allowMissingRootDir && !fs.existsSync(resolved)) {
        errors.push(`rootDir does not exist: ${resolved}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }

    return { templateId: tmpl.id, source: entry.source, errors };
  });
}
