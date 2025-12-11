export type SubAgentScope = "project" | "user";

export type SubAgentSpec = {
  name: string;
  description: string;
  tools?: string[];
  model?: "opus" | "sonnet" | "haiku" | "inherit";
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "ignore";
  skills?: string[];
  systemPrompt: string;
  scope: SubAgentScope;
  templateId?: string;
  templateVersion?: string | number;
  generatedAt?: string;
  originalName?: string;
};

export type TeamTemplate = {
  id: string;
  label: string;
  description: string;
  rootDir?: string;
  version?: string | number;
  /**
   * Project root directory to use for outputs (e.g., .claude/agents).
   * Resolved relative to process.cwd() if relative; defaults to process.cwd().
   */
  agents: Array<{
    name: string;
    description: string;
    model?: "opus" | "sonnet" | "haiku" | "inherit";
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "ignore";
    tools?: string[];
    skills?: string[];
    promptTemplate: string;
  }>;
};

export type RuntimeAgentConfig = {
  description: string;
  prompt: string;
  tools?: string[];
  model?: "opus" | "sonnet" | "haiku" | "inherit";
};

export type RuntimeAgentsMap = Record<string, RuntimeAgentConfig>;
