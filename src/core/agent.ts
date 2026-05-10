import type { Message, ToolUseContent } from "./messages";
import { getText, textMessage } from "./messages";
import type { ModeConfig } from "./mode";
import type { OpenAICompatibleModel } from "./model";

export interface AgentRunResult {
  mode: string;
  answer: string;
  messages: Message[];
}

export type AgentRunEvent =
  | { type: "model_start"; step: number; mode: string }
  | { type: "model_done"; step: number; mode: string; toolCount: number }
  | { type: "tool_start"; step: number; mode: string; toolName: string }
  | { type: "tool_done"; step: number; mode: string; toolName: string; ok: boolean }
  | { type: "final"; step: number; mode: string };

export class BoxgentAgent {
  private readonly model: OpenAICompatibleModel;
  private readonly cwd: string;
  private readonly maxSteps: number;

  constructor({ model, cwd, maxSteps = 8 }: { model: OpenAICompatibleModel; cwd: string; maxSteps?: number }) {
    this.model = model;
    this.cwd = cwd;
    this.maxSteps = maxSteps;
  }

  async run({
    input,
    mode,
    signal,
    onEvent,
    visibleProcess = false,
  }: {
    input: string;
    mode: ModeConfig;
    signal?: AbortSignal;
    onEvent?: (event: AgentRunEvent) => void;
    visibleProcess?: boolean;
  }): Promise<AgentRunResult> {
    const messages: Message[] = [
      textMessage("system", buildSystemPrompt(mode, { visibleProcess })),
      textMessage("user", input),
    ];

    for (let step = 0; step < this.maxSteps; step++) {
      onEvent?.({ type: "model_start", step: step + 1, mode: mode.name });
      const assistant = await this.model.invoke({ messages, tools: mode.tools, signal });
      messages.push(assistant);

      const toolUses = assistant.content.filter((item): item is ToolUseContent => item.type === "tool_use");
      onEvent?.({ type: "model_done", step: step + 1, mode: mode.name, toolCount: toolUses.length });
      if (toolUses.length === 0) {
        onEvent?.({ type: "final", step: step + 1, mode: mode.name });
        return { mode: mode.name, answer: getText(assistant), messages };
      }

      for (const toolUse of toolUses) {
        const tool = mode.tools.find((item) => item.name === toolUse.name);
        onEvent?.({ type: "tool_start", step: step + 1, mode: mode.name, toolName: toolUse.name });
        const result = tool
          ? await tool.invoke(toolUse.input, { mode: mode.name, cwd: this.cwd, signal })
          : { ok: false, summary: `Tool ${toolUse.name} was not found.` };
        onEvent?.({
          type: "tool_done",
          step: step + 1,
          mode: mode.name,
          toolName: toolUse.name,
          ok: isSuccessfulToolResult(result),
        });

        messages.push({
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolUseId: toolUse.id,
              content: JSON.stringify(result),
            },
          ],
        });
      }
    }

    return {
      mode: mode.name,
      answer: visibleProcess
        ? "<process>Reached the current step limit before producing a final response.</process>\n<answer>我已经达到当前运行步数上限，请缩小任务范围后继续。</answer>"
        : "我已经达到当前运行步数上限，请缩小任务范围后继续。",
      messages,
    };
  }
}

function isSuccessfulToolResult(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === "object" &&
      "ok" in result &&
      (result as { ok: unknown }).ok,
  );
}

function buildSystemPrompt(mode: ModeConfig, options: { visibleProcess: boolean }): string {
  const visibleProcessPrompt = options.visibleProcess
    ? `
Visible process output is requested for this interface.
- Respond in the user's language unless they explicitly ask for another language.
- Include a brief user-visible process summary, not hidden chain-of-thought.
- Keep the process summary to 1-3 concise bullets or short sentences.
- Do not invent tool usage; mention tools only if they were actually used.
- Wrap the process summary in <process>...</process>.
- Wrap the final answer in <answer>...</answer>.
- Do not put any other text outside those tags.`
    : "";

  return `${mode.systemPrompt}

You are running in ${mode.label}.
Use tools when they materially improve the answer.
When using memory, prefer reading before writing.
Keep responses concise, useful, and grounded in the user's actual context.${visibleProcessPrompt}`;
}
