export type Role = "system" | "user" | "assistant" | "tool";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolUseId: string;
  content: string;
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent;

export interface Message {
  role: Role;
  content: MessageContent[];
}

export function textMessage(role: Role, text: string): Message {
  return { role, content: [{ type: "text", text }] };
}

export function getText(message: Message): string {
  return message.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}
