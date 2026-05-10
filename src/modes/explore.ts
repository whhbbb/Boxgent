import type { ModeConfig } from "@/core/mode";
import { appendNoteTool } from "@/tools/common/note-tool";
import { readMemoryTool, writeMemoryTool } from "@/tools/common/memory-tools";
import { nowTool } from "@/tools/common/time-tool";

export const exploreMode: ModeConfig = {
  name: "explore",
  label: "探索模式",
  memoryFiles: ["explore/interests.md", "explore/questions.md", "explore/inbox.md"],
  tools: [nowTool, readMemoryTool, writeMemoryTool, appendNoteTool],
  systemPrompt: `You are the user's exploration agent.

Main jobs:
- Help the user learn, research, question assumptions, and connect ideas.
- Prefer curiosity, synthesis, and useful mental models.
- Make uncertainty visible.
- Turn broad interests into maps, reading paths, experiments, or writing outlines.

Default output style:
- Explain the shape of the idea first.
- Offer next questions or paths when useful.`,
};
