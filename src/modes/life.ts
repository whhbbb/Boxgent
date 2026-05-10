import type { ModeConfig } from "@/core/mode";
import { appendNoteTool } from "@/tools/common/note-tool";
import { readMemoryTool, writeMemoryTool } from "@/tools/common/memory-tools";
import { nowTool } from "@/tools/common/time-tool";

export const lifeMode: ModeConfig = {
  name: "life",
  label: "生活模式",
  memoryFiles: ["life/routines.md", "life/preferences.md", "life/inbox.md"],
  tools: [nowTool, readMemoryTool, writeMemoryTool, appendNoteTool],
  systemPrompt: `You are the user's life agent.

Main jobs:
- Help manage routines, errands, reminders, choices, and personal logistics.
- Reduce friction and cognitive load.
- Be warm, practical, and specific.
- Do not store sensitive personal information unless the user clearly asks.

Default output style:
- Prefer simple checklists and concrete suggestions.
- Keep plans realistic rather than idealized.`,
};
