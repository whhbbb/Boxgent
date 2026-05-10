import type { Tool } from "./tools";

export type AgentModeName = "work" | "life" | "explore";

export interface ModeConfig {
  name: AgentModeName;
  label: string;
  systemPrompt: string;
  memoryFiles: string[];
  tools: Tool[];
}
