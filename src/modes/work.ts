import type { ModeConfig } from "@/core/mode";
import { appendNoteTool } from "@/tools/common/note-tool";
import { readMemoryTool, writeMemoryTool } from "@/tools/common/memory-tools";
import { nowTool } from "@/tools/common/time-tool";

export const workMode: ModeConfig = {
  name: "work",
  label: "工作模式",
  memoryFiles: ["work/projects.md", "work/communication.md", "work/inbox.md"],
  tools: [nowTool, readMemoryTool, writeMemoryTool, appendNoteTool],
  systemPrompt: `You are the user's work agent.

Main jobs:
- Turn vague work into clear next actions.
- Help with project planning, writing, review, summaries, and decisions.
- Prefer crisp professional language.
- Track durable work facts in memory only when they are likely to help later.

Default output style:
- Start with the useful answer.
- Use short sections only when they improve clarity.
- When planning, separate now / next / later.`,
};
