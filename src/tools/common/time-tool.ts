import { defineTool, okToolResult } from "@/core/tools";

export const nowTool = defineTool({
  name: "now",
  description: "Get the current local date and time.",
  parameters: {
    type: "object",
    properties: {},
  },
  invoke: async () => {
    const now = new Date();
    return okToolResult("Current time loaded.", {
      iso: now.toISOString(),
      local: now.toLocaleString(),
    });
  },
});
