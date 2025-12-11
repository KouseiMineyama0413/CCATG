# Claude Code Agent Team Generator (CCATG)

Language: English | [日本語はこちら](README.ja.md)

CCATG is a developer-facing CLI that generates Claude Code sub-agent teams from YAML templates. It creates `.claude/agents/*.md`, prints `claude --agents` JSON, and validates template safety (including `rootDir`).

## Setup
- Node.js 18+ (CLAUDE CLI required only for `run-with-agents`).
- Install deps: `npm install`
- Build: `npm run build` (outputs to `dist/`)
- Run commands from your project root: `node ./ccatg/dist/index.js <command> ...`.

## Directory Layout & Execution Assumptions
```
project-root/
  ccatg/                # this tool (Node.js/TypeScript)
    package.json
    tsconfig.json
    src/
      index.ts          # CLI entry
      ...
  src/                  # your project code
  .claude/              # created if missing
```
- Keep `ccatg/` at project root; run commands from project root.
- Output for `scope: project` always goes to `project-root/.claude/agents/`.

## Key Commands (run from project root)
```
node ./ccatg/dist/index.js list-templates [--with-source]
node ./ccatg/dist/index.js show-template --id web-product-team
node ./ccatg/dist/index.js generate-files --template web-product-team --scope project \
  [--root-dir apps/admin] [--only a,b | --except c] [--prefix web-] [--dry-run] [--force]
node ./ccatg/dist/index.js print-agents-json --template bugfix-incident-team \
  [--only a,b | --except c] [--prefix web-]
node ./ccatg/dist/index.js run-with-agents --template bugfix-incident-team --prompt "..." \
  [--only a,b | --except c] [--prefix web-]
node ./ccatg/dist/index.js validate-templates [--allow-missing-root]
node ./ccatg/dist/index.js check-agents --template web-product-team [--root-dir ...] \
  [--only a,b | --except c] [--prefix web-]
# (future idea) analyze-repo --path . --output suggestion.yml
```

### Helpful flags
- `--root-dir`: override template `rootDir` for this run; logged as the project root used.
- `--dry-run`: preview planned writes (new/overwrite) and frontmatter without touching files.
- `--only` / `--except`: generate a subset of agents.
- `--prefix`: avoid name/file collisions by prefixing agent names.
- `--force`: allow overwriting existing files (otherwise blocked).
- Validation: checks required fields, unique agent names, allowed tools/model/permission values, safe `rootDir` (relative, non-traversing, exists unless `--allow-missing-root`).
- `check-agents`: compares current `.claude/agents` with the template (ignores `generatedAt`); exits non-zero on differences/missing files.

## Templates (YAML)
- Load order (higher wins): `templates/` (bundled) < `~/.ccatg/org-templates/` < `./.ccatg/templates/` < `CCATG_TEMPLATES_DIR`.
- Add/override by dropping a YAML file; no rebuild needed. `list-templates --with-source` shows which file is used.
- `rootDir` in YAML is resolved relative to command cwd; must stay within project root and be relative (no `..` or absolute). CLI can override with `--root-dir`.
- Built-ins: `web-product-team`, `bugfix-incident-team`, `library-maintainer-team` (each includes `rootDir: .`).

### Template format
```yaml
id: my-team
label: My Custom Team
description: Short description
rootDir: .
version: 1
agents:
  - name: architect
    description: ...
    model: sonnet            # opus | sonnet | haiku | inherit
    permissionMode: plan     # default | acceptEdits | bypassPermissions | plan | ignore
    tools: [Read, Grep, Glob, Write, Bash]
    skills: [planning, design]
    promptTemplate: |-
      You are the software architect...
```

## Data Model & Outputs
- `TeamTemplate`: template metadata + `agents[]` and optional `rootDir`/`version`.
- `SubAgentSpec`: template mapped with `scope` and metadata for generation.
- Markdown generated (`.claude/agents/<name>.md`):
  ```
  ---
  name: <name>
  description: <description>
  tools: Read, Grep, ...
  model: sonnet
  permissionMode: plan
  skills: ...
  templateId: <template id>
  templateVersion: <optional version>
  generatedAt: 2025-12-11T10:00:00.000Z
  ---
  <systemPrompt>
  ```
- JSON for `claude --agents`: `{ "<name>": { description, prompt, tools?, model? }, ... }`

## Safety
- `rootDir` must be relative and inside project root; existence is enforced unless `--allow-missing-root`.
- `generate-files` refuses to overwrite unless `--force`.
- `dry-run` and `check-agents` help inspect before touching files.

## Extending
- Add templates in `templates/` (or the override paths) to extend the catalog.
- CLI logic lives in `src/index.ts`; generation helpers in `src/generator.ts`; template loading/validation in `src/templates.ts`.
