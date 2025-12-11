import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { RuntimeAgentsMap, SubAgentScope, SubAgentSpec, TeamTemplate } from "./types";

const ALLOWED_MODELS = ["opus", "sonnet", "haiku", "inherit"] as const;
const ALLOWED_PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan", "ignore"] as const;
const ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Write", "Bash"] as const;

function quoteIfNeeded(value: string): string {
  const needsQuotes = /[:#\n\r"]/.test(value) || /^\s/.test(value) || /\s$/.test(value);
  return needsQuotes ? JSON.stringify(value) : value;
}

export function templateToSubAgentSpecs(template: TeamTemplate, scope: SubAgentScope): SubAgentSpec[] {
  return template.agents.map((agent) => ({
    name: agent.name,
    description: agent.description,
    tools: agent.tools,
    model: agent.model,
    permissionMode: agent.permissionMode,
    skills: agent.skills,
    systemPrompt: agent.promptTemplate,
    scope,
    templateId: template.id,
    templateVersion: template.version
  }));
}

export function toMarkdown(spec: SubAgentSpec): string {
  const tools = spec.tools?.join(", ");
  const skills = spec.skills?.join(", ");
  const generatedAt = spec.generatedAt ?? new Date().toISOString();

  const frontmatterLines = [
    "---",
    `name: ${quoteIfNeeded(spec.name)}`,
    `description: ${quoteIfNeeded(spec.description)}`,
    spec.tools && spec.tools.length > 0 ? `tools: ${quoteIfNeeded(tools ?? "")}` : "",
    spec.model ? `model: ${quoteIfNeeded(spec.model)}` : "",
    spec.permissionMode ? `permissionMode: ${quoteIfNeeded(spec.permissionMode)}` : "",
    spec.skills && spec.skills.length > 0 ? `skills: ${quoteIfNeeded(skills ?? "")}` : "",
    spec.templateId ? `templateId: ${quoteIfNeeded(spec.templateId)}` : "",
    spec.templateVersion !== undefined ? `templateVersion: ${quoteIfNeeded(String(spec.templateVersion))}` : "",
    `generatedAt: ${quoteIfNeeded(generatedAt)}`,
    "---",
    ""
  ].filter((line) => line !== "");
  frontmatterLines.push("");

  return `${frontmatterLines.join("\n")}\n${spec.systemPrompt}\n`;
}

export function resolveScopeDir(scope: SubAgentScope, baseDir?: string): string {
  const projectRoot = baseDir ? path.resolve(baseDir) : process.cwd();
  return scope === "project"
    ? path.join(projectRoot, ".claude", "agents")
    : path.join(os.homedir(), ".claude", "agents");
}

export function getAgentPath(spec: SubAgentSpec, baseDir?: string): string {
  const dir = resolveScopeDir(spec.scope, baseDir);
  return path.join(dir, `${spec.name}.md`);
}

export function resolveBaseDir(
  templateRootDir?: string,
  overrideRootDir?: string,
  allowMissingRootDir = false
): string {
  const base = process.cwd();
  const selected = overrideRootDir ?? templateRootDir ?? ".";
  if (path.isAbsolute(selected)) {
    throw new Error(`rootDir must be relative: ${selected}`);
  }
  const resolved = path.resolve(base, selected);
  const normalizedBase = path.resolve(base);
  const isWithinBase =
    resolved === normalizedBase || resolved.startsWith(`${normalizedBase}${path.sep}`);
  if (!isWithinBase) {
    throw new Error(`rootDir must stay within project root (${normalizedBase}): ${selected}`);
  }
  if (!allowMissingRootDir && !fs.existsSync(resolved)) {
    throw new Error(`rootDir does not exist: ${resolved} (use --allow-missing-root if intentional)`);
  }
  return resolved;
}

export function applyPrefix(specs: SubAgentSpec[], prefix?: string): SubAgentSpec[] {
  if (!prefix) return specs;
  return specs.map((spec) => ({
    ...spec,
    originalName: spec.name,
    name: `${prefix}${spec.name}`
  }));
}

export function filterSpecs(
  specs: SubAgentSpec[],
  options: { only?: string[]; except?: string[] }
): SubAgentSpec[] {
  if (options.only && options.only.length && options.except && options.except.length) {
    throw new Error("--only and --except cannot be used together");
  }
  if (options.only && options.only.length) {
    const set = new Set(options.only);
    return specs.filter((s) => set.has(s.name));
  }
  if (options.except && options.except.length) {
    const set = new Set(options.except);
    return specs.filter((s) => !set.has(s.name));
  }
  return specs;
}

function withGeneratedAt(spec: SubAgentSpec): SubAgentSpec {
  if (spec.generatedAt) {
    return spec;
  }
  return { ...spec, generatedAt: new Date().toISOString() };
}

export function writeSubAgent(
  spec: SubAgentSpec,
  options: { force?: boolean; baseDir?: string } = {}
): string {
  const dir = resolveScopeDir(spec.scope, options.baseDir);
  const fileName = `${spec.name}.md`;
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  if (!options.force && fs.existsSync(fullPath)) {
    throw new Error(`File already exists (use --force to overwrite): ${fullPath}`);
  }
  fs.writeFileSync(fullPath, toMarkdown(withGeneratedAt(spec)), "utf-8");
  return fullPath;
}

export function writeSubAgents(
  specs: SubAgentSpec[],
  options: { force?: boolean; baseDir?: string } = {}
): string[] {
  return specs.map((spec) => writeSubAgent(spec, options));
}

export function buildPlannedWrites(
  specs: SubAgentSpec[],
  baseDir?: string
): Array<{ path: string; status: "new" | "overwrite"; frontmatter: string; content: string }> {
  return specs.map((spec) => {
    const fullPath = getAgentPath(spec, baseDir);
    const markdown = toMarkdown(withGeneratedAt(spec));
    const preview = markdown.split("\n\n")[0]; // frontmatter block
    const status = fs.existsSync(fullPath) ? "overwrite" : "new";
    return { path: fullPath, status, frontmatter: preview, content: markdown };
  });
}

export function buildAgentsJson(specs: SubAgentSpec[]): string {
  const map: RuntimeAgentsMap = {};
  for (const s of specs) {
    map[s.name] = {
      description: s.description,
      prompt: s.systemPrompt,
      ...(s.tools ? { tools: s.tools } : {}),
      ...(s.model ? { model: s.model } : {})
    };
  }
  return JSON.stringify(map);
}

export function runClaudeWithAgents(specs: SubAgentSpec[], userPrompt: string): string {
  const agentsJson = buildAgentsJson(specs);
  return execFileSync("claude", ["--agents", agentsJson, "-p", userPrompt], { encoding: "utf-8" });
}

export function normalizeContentWithoutGeneratedAt(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !line.toLowerCase().startsWith("generatedat:"))
    .join("\n")
    .trimEnd();
}

export function validateAgentFields(agent: TeamTemplate["agents"][number], source: string, index: number): string[] {
  const errors: string[] = [];
  if (agent.model && !ALLOWED_MODELS.includes(agent.model as typeof ALLOWED_MODELS[number])) {
    errors.push(`agent[${index}].model must be one of ${ALLOWED_MODELS.join(", ")} (${source})`);
  }
  if (
    agent.permissionMode &&
    !ALLOWED_PERMISSION_MODES.includes(agent.permissionMode as typeof ALLOWED_PERMISSION_MODES[number])
  ) {
    errors.push(
      `agent[${index}].permissionMode must be one of ${ALLOWED_PERMISSION_MODES.join(", ")} (${source})`
    );
  }
  if (agent.tools) {
    const invalid = agent.tools.filter((t) => !ALLOWED_TOOLS.includes(t as typeof ALLOWED_TOOLS[number]));
    if (invalid.length) {
      errors.push(`agent[${index}].tools contains unsupported values (${invalid.join(", ")}) in ${source}`);
    }
  }
  return errors;
}
