import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

import { defineTool, okToolResult } from "@/core/tools";

export const appendNoteTool = defineTool({
  name: "append_note",
  description: "Append a timestamped note to the agent inbox.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Note content." },
    },
    required: ["text"],
  },
  invoke: async ({ text }, context) => {
    const path = join(context.cwd, "memory", context.mode, "inbox.md");
    await mkdir(dirname(path), { recursive: true });
    const existing = await Bun.file(path).exists() ? await Bun.file(path).text() : "";
    const line = `- ${new Date().toISOString()} ${String(text).trim()}`;
    await Bun.write(path, `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${line}\n`);
    return okToolResult(`Saved note to ${context.mode}/inbox.md`);
  },
});
