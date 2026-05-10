import { dirname, join, normalize } from "node:path";
import { mkdir } from "node:fs/promises";

import { defineTool, errorToolResult, okToolResult } from "@/core/tools";

function memoryPath(cwd: string, path: unknown): string {
  const relative = typeof path === "string" && path.trim() ? path : "inbox.md";
  const fullPath = normalize(join(cwd, "memory", relative));
  const root = normalize(join(cwd, "memory"));
  if (!fullPath.startsWith(root)) {
    throw new Error("Memory path must stay inside memory/.");
  }
  return fullPath;
}

export const readMemoryTool = defineTool({
  name: "read_memory",
  description: "Read a markdown memory file for the current personal agent.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path under memory/, for example work/projects.md." },
    },
    required: ["path"],
  },
  invoke: async ({ path }, context) => {
    try {
      const file = Bun.file(memoryPath(context.cwd, path));
      if (!(await file.exists())) {
        return errorToolResult(`Memory file does not exist: ${String(path)}`);
      }
      return okToolResult(`Read memory: ${String(path)}`, await file.text());
    } catch (error) {
      return errorToolResult(error instanceof Error ? error.message : String(error));
    }
  },
});

export const writeMemoryTool = defineTool({
  name: "write_memory",
  description: "Append useful, user-approved personal memory to a markdown file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path under memory/, for example life/routines.md." },
      text: { type: "string", description: "Text to append." },
    },
    required: ["path", "text"],
  },
  invoke: async ({ path, text }, context) => {
    try {
      const fullPath = memoryPath(context.cwd, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await Bun.write(fullPath, `${await existingText(fullPath)}\n${String(text).trim()}\n`);
      return okToolResult(`Updated memory: ${String(path)}`);
    } catch (error) {
      return errorToolResult(error instanceof Error ? error.message : String(error));
    }
  },
});

async function existingText(path: string): Promise<string> {
  const file = Bun.file(path);
  return await file.exists() ? await file.text() : "";
}
