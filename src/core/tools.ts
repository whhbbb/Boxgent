export interface ToolContext {
  mode: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  invoke: (input: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
}

export function defineTool(tool: Tool): Tool {
  return tool;
}

export function okToolResult(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, ...(data === undefined ? {} : { data }) };
}

export function errorToolResult(summary: string, error = summary): ToolResult {
  return { ok: false, summary, error };
}
