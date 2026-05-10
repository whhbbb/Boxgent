import type { Message, ToolUseContent } from "./messages";
import type { Tool } from "./tools";

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ModelOptions {
  baseURL: string;
  apiKey: string;
  model: string;
}

export class OpenAICompatibleModel {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;

  constructor(options: ModelOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async invoke({ messages, tools, signal }: { messages: Message[]; tools: Tool[]; signal?: AbortSignal }): Promise<Message> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: toProviderMessages(messages),
        tools: tools.map(toProviderTool),
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json() as {
      choices: Array<{ message: ChatCompletionMessage }>;
    };
    return fromProviderMessage(payload.choices[0]!.message);
  }
}

function toProviderMessages(messages: Message[]): ChatCompletionMessage[] {
  const result: ChatCompletionMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      for (const item of message.content) {
        if (item.type === "tool_result") {
          result.push({ role: "tool", tool_call_id: item.toolUseId, content: item.content });
        }
      }
      continue;
    }

    const toolCalls = message.content
      .filter((item): item is ToolUseContent => item.type === "tool_use")
      .map((item) => ({
        id: item.id,
        type: "function" as const,
        function: {
          name: item.name,
          arguments: JSON.stringify(item.input),
        },
      }));

    const text = message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    result.push({
      role: message.role as "system" | "user" | "assistant",
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  return result;
}

function fromProviderMessage(message: ChatCompletionMessage): Message {
  const content: Message["content"] = [];
  if (message.content) {
    content.push({ type: "text", text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: safeJson(call.function.arguments),
    });
  }
  return { role: "assistant", content };
}

function toProviderTool(tool: Tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
