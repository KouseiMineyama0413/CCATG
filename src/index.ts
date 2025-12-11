#!/usr/bin/env node
import fs from "fs";
import { Command } from "commander";
import {
  applyPrefix,
  buildAgentsJson,
  buildPlannedWrites,
  filterSpecs,
  getAgentPath,
  normalizeContentWithoutGeneratedAt,
  resolveBaseDir,
  runClaudeWithAgents,
  templateToSubAgentSpecs,
  writeSubAgents
} from "./generator";
import { getTemplateById, templates, templatesWithSource, validateTemplates } from "./templates";
import { SubAgentScope, TeamTemplate } from "./types";
import pkg from "../package.json";

function resolveScope(scope?: string): SubAgentScope {
  if (!scope || scope === "project") {
    return "project";
  }
  if (scope === "user") {
    return "user";
  }
  console.error(`Invalid scope: ${scope}. Use \"project\" or \"user\".`);
  process.exit(1);
}

function requireTemplate(templateId?: string, altId?: string): TeamTemplate {
  const id = templateId ?? altId;
  if (!id) {
    console.error("--template is required");
    process.exit(1);
  }
  const template = getTemplateById(id);
  if (!template) {
    console.error(`Template not found: ${id}`);
    process.exit(1);
  }
  return template;
}

function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((v: string) => v.trim())
    .filter(Boolean);
}

function buildSpecsWithOptions(
  template: TeamTemplate,
  scope: SubAgentScope,
  options: { only?: string[]; except?: string[]; prefix?: string }
) {
  let specs = templateToSubAgentSpecs(template, scope);
  specs = filterSpecs(specs, { only: options.only, except: options.except });
  specs = applyPrefix(specs, options.prefix);
  return specs;
}

const program = new Command();
program
  .name("ccatg")
  .description("Claude Code Agent Team Generator")
  .version(pkg.version);

program
  .command("list-templates")
  .description("List available team templates")
  .option("--with-source", "show source YAML path")
  .action((options) => {
    if (options.withSource) {
      templatesWithSource.forEach((entry) => {
        const t = entry.template;
        console.log(`${t.id}\t${t.label}\t${t.description}\t[source: ${entry.source}]`);
      });
    } else {
      templates.forEach((t) => {
        console.log(`${t.id}\t${t.label}\t${t.description}`);
      });
    }
  });

program
  .command("show-template")
  .description("Show details of a template")
  .option("-t, --template <id>", "template id")
  .option("-i, --id <id>", "template id (alias)")
  .option("-j, --json", "output as JSON")
  .action((options) => {
    const template = requireTemplate(options.template, options.id);
    if (options.json) {
      console.log(JSON.stringify(template, null, 2));
      return;
    }

    console.log(`${template.id}: ${template.label}`);
    console.log(template.description);
    console.log("agents:");
    template.agents.forEach((agent) => {
      console.log(`  - ${agent.name}: ${agent.description}`);
      if (agent.tools?.length) {
        console.log(`    tools: ${agent.tools.join(", ")}`);
      }
      if (agent.model) {
        console.log(`    model: ${agent.model}`);
      }
      if (agent.permissionMode) {
        console.log(`    permissionMode: ${agent.permissionMode}`);
      }
    });
  });

program
  .command("validate-templates")
  .description("Validate loaded templates (schema, values, rootDir existence)")
  .option("--allow-missing-root", "allow missing rootDir without failing", false)
  .action((options) => {
    const results = validateTemplates({ allowMissingRootDir: options.allowMissingRoot });
    const failed = results.filter((r) => r.errors.length > 0);
    if (failed.length === 0) {
      console.log("All templates valid.");
      return;
    }
    failed.forEach((r) => {
      console.error(`Template ${r.templateId} (${r.source}) has errors:`);
      r.errors.forEach((err) => console.error(`  - ${err}`));
    });
    process.exit(1);
  });

program
  .command("generate-files")
  .description("Generate .claude/agents markdown files from a template")
  .option("-t, --template <id>", "template id")
  .option("-s, --scope <scope>", "target scope: project | user", "project")
  .option("-f, --force", "overwrite existing files", false)
  .option("--root-dir <path>", "override rootDir in template (relative to project root)")
  .option("--allow-missing-root", "allow missing rootDir (skip existence check)", false)
  .option("--dry-run", "preview without writing files", false)
  .option("--only <names>", "comma-separated agent names to include")
  .option("--except <names>", "comma-separated agent names to exclude")
  .option("--prefix <prefix>", "prefix to prepend to agent names and files")
  .action((options) => {
    const template = requireTemplate(options.template);
    const scope = resolveScope(options.scope);
    try {
      const only = parseCsv(options.only);
      const except = parseCsv(options.except);
      const specs = buildSpecsWithOptions(template, scope, { only, except, prefix: options.prefix });
      const baseDir = resolveBaseDir(template.rootDir, options.rootDir, options.allowMissingRoot);
      console.log(`Using project root: ${baseDir}`);
      if (specs.length === 0) {
        console.log("No agents to generate (filtered by --only/--except).");
        return;
      }

      if (options.dryRun) {
        const planned = buildPlannedWrites(specs, baseDir);
        planned.forEach((p) => {
          console.log(`${p.path} (${p.status})`);
          console.log(p.frontmatter);
          console.log();
        });
        return;
      }

      const paths = writeSubAgents(specs, { force: options.force, baseDir });
      console.log("Generated files:");
      paths.forEach((p) => console.log(`- ${p}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  });

program
  .command("print-agents-json")
  .alias("agents-json")
  .description("Print claude --agents JSON for a template")
  .option("-t, --template <id>", "template id")
  .option("-i, --id <id>", "template id (alias)")
  .option("-s, --scope <scope>", "scope used when mapping to specs", "project")
  .option("--only <names>", "comma-separated agent names to include")
  .option("--except <names>", "comma-separated agent names to exclude")
  .option("--prefix <prefix>", "prefix to prepend to agent names")
  .action((options) => {
    const template = requireTemplate(options.template, options.id);
    const scope = resolveScope(options.scope);
    try {
      const only = parseCsv(options.only);
      const except = parseCsv(options.except);
      const specs = buildSpecsWithOptions(template, scope, { only, except, prefix: options.prefix });
      const json = buildAgentsJson(specs);
      console.log(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  });

program
  .command("check-agents")
  .description("Check existing .claude/agents files against a template")
  .option("-t, --template <id>", "template id")
  .option("-s, --scope <scope>", "target scope: project | user", "project")
  .option("--root-dir <path>", "override rootDir in template (relative to project root)")
  .option("--allow-missing-root", "allow missing rootDir (skip existence check)", false)
  .option("--only <names>", "comma-separated agent names to include")
  .option("--except <names>", "comma-separated agent names to exclude")
  .option("--prefix <prefix>", "prefix to prepend to agent names and files")
  .action((options) => {
    const template = requireTemplate(options.template);
    const scope = resolveScope(options.scope);
    try {
      const only = parseCsv(options.only);
      const except = parseCsv(options.except);
      const specs = buildSpecsWithOptions(template, scope, { only, except, prefix: options.prefix });
      const baseDir = resolveBaseDir(template.rootDir, options.rootDir, options.allowMissingRoot);
      console.log(`Using project root: ${baseDir}`);
      if (specs.length === 0) {
        console.log("No agents to check (filtered by --only/--except).");
        return;
      }
      const planned = buildPlannedWrites(specs, baseDir);
      let mismatches = 0;
      planned.forEach((p) => {
        if (!fs.existsSync(p.path)) {
          console.log(`${p.path} is missing`);
          mismatches += 1;
          return;
        }
        const existing = fs.readFileSync(p.path, "utf-8");
        const expected = normalizeContentWithoutGeneratedAt(p.content);
        const actual = normalizeContentWithoutGeneratedAt(existing);
        if (expected !== actual) {
          console.log(`${p.path} differs from template`);
          mismatches += 1;
        } else {
          console.log(`${p.path} is up to date`);
        }
      });
      if (mismatches > 0) {
        process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  });

program
  .command("run-with-agents")
  .description("Run claude CLI with agents JSON built from a template")
  .option("-t, --template <id>", "template id")
  .requiredOption("-p, --prompt <prompt>", "user prompt to pass to claude")
  .option("-s, --scope <scope>", "scope used when mapping to specs", "project")
  .option("--only <names>", "comma-separated agent names to include")
  .option("--except <names>", "comma-separated agent names to exclude")
  .option("--prefix <prefix>", "prefix to prepend to agent names")
  .action((options) => {
    const template = requireTemplate(options.template);
    const scope = resolveScope(options.scope);
    try {
      const only = parseCsv(options.only);
      const except = parseCsv(options.except);
      const specs = buildSpecsWithOptions(template, scope, { only, except, prefix: options.prefix });
      const output = runClaudeWithAgents(specs, options.prompt);
      process.stdout.write(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to run claude: ${message}`);
      process.exit(1);
    }
  });

program.parse();
