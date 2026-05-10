import { getMode } from "@/modes";
import { routeInput } from "@/modes/router";
import type { AgentRunEvent } from "@/core/agent";
import type { AgentModeName } from "@/core/mode";
import type { Runtime } from "@/app";
import { FeishuAutomationScheduler, handleScheduleCommand } from "./scheduler";

interface FeishuEventBody {
  type?: string;
  challenge?: string;
  token?: string;
  header?: {
    event_id?: string;
    event_type?: string;
  };
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
    };
  };
}

const chatModes = new Map<string, AgentModeName>();
const processedFeishuEvents = new Map<string, number>();
const EVENT_DEDUPE_TTL_MS = 10 * 60_000;

interface FeishuCardOptions {
  title: string;
  subtitle?: string;
  mode?: AgentModeName | string;
  text: string;
  trace?: string[];
  template?: "blue" | "green" | "turquoise" | "yellow" | "orange" | "red" | "purple" | "grey";
}

type FeishuMessagePayload =
  | { msg_type: "text"; content: string }
  | { msg_type: "interactive"; content: string };

export async function startFeishuServer(runtime: Runtime): Promise<void> {
  const port = Number(Bun.env.FEISHU_PORT ?? 3000);
  const scheduler = new FeishuAutomationScheduler({
    runtime,
    cwd: runtime.cwd,
    sendMessage: sendMessageToChat,
  });
  await scheduler.start();

  Bun.serve({
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true });
      }
      if (url.pathname === "/feishu/events" && request.method === "POST") {
        return handleFeishuEvent(runtime, scheduler, request);
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  console.info(`Feishu server listening on http://localhost:${port}/feishu/events`);
}

async function handleFeishuEvent(
  runtime: Runtime,
  scheduler: FeishuAutomationScheduler,
  request: Request,
): Promise<Response> {
  const body = await request.json() as FeishuEventBody;

  if (body.type === "url_verification") {
    if (Bun.env.FEISHU_VERIFICATION_TOKEN && body.token !== Bun.env.FEISHU_VERIFICATION_TOKEN) {
      return Response.json({ error: "invalid token" }, { status: 401 });
    }
    return Response.json({ challenge: body.challenge });
  }

  const message = body.event?.message;
  if (!message?.message_id || !message.chat_id || message.message_type !== "text") {
    return Response.json({ ok: true });
  }
  if (shouldSkipDuplicateEvent(body, message.message_id)) {
    console.info(`Skipped duplicate Feishu event: ${body.header?.event_id ?? message.message_id}`);
    return Response.json({ ok: true });
  }

  const text = parseFeishuText(message.content);
  if (!text) return Response.json({ ok: true });

  const currentMode = chatModes.get(message.chat_id) ?? "work";
  try {
    const scheduleResponse = await handleScheduleCommand({
      scheduler,
      chatId: message.chat_id,
      mode: currentMode,
      text,
    });
    if (scheduleResponse) {
      await sendCardToChat(message.chat_id, {
        title: "Boxgent 自动任务",
        mode: currentMode,
        text: scheduleResponse,
        template: "turquoise",
      });
      return Response.json({ ok: true });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await sendCardToChat(message.chat_id, {
      title: "自动任务设置失败",
      mode: currentMode,
      text: reason,
      template: "red",
    });
    return Response.json({ ok: true });
  }

  const routed = routeInput(text);
  const mode = routed.mode ?? currentMode;
  chatModes.set(message.chat_id, mode);

  if (routed.switched && !routed.text) {
    await sendCardToChat(message.chat_id, {
      title: "Boxgent 已切换模式",
      mode,
      text: `当前模式：${mode}`,
      template: modeTemplate(mode),
    });
    return Response.json({ ok: true });
  }

  const progress = await FeishuProgressReporter.start(message.chat_id, mode);
  try {
    const result = await runtime.agent.run({
      input: routed.text,
      mode: getMode(mode),
      onEvent: (event) => progress.handle(event),
    });
    await progress.complete();

    await sendCardToChat(message.chat_id, {
      title: "Boxgent",
      mode: result.mode,
      text: result.answer,
      template: modeTemplate(result.mode),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await progress.fail(reason);
    await sendCardToChat(message.chat_id, {
      title: "Boxgent 处理失败",
      mode,
      text: reason,
      template: "red",
    });
  }
  return Response.json({ ok: true });
}

function parseFeishuText(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim() ?? "";
  } catch {
    return content.trim();
  }
}

function shouldSkipDuplicateEvent(body: FeishuEventBody, messageId: string): boolean {
  const key = body.header?.event_id ? `event:${body.header.event_id}` : `message:${messageId}`;
  const now = Date.now();
  pruneProcessedFeishuEvents(now);

  const expiresAt = processedFeishuEvents.get(key);
  if (expiresAt && expiresAt > now) {
    return true;
  }

  processedFeishuEvents.set(key, now + EVENT_DEDUPE_TTL_MS);
  return false;
}

function pruneProcessedFeishuEvents(now: number): void {
  for (const [key, expiresAt] of processedFeishuEvents) {
    if (expiresAt <= now) {
      processedFeishuEvents.delete(key);
    }
  }
}

async function sendMessageToChat(chatId: string, text: string): Promise<void> {
  await sendCardToChat(chatId, {
    title: "Boxgent 自动任务",
    text,
    template: "turquoise",
  });
}

async function sendCardToChat(chatId: string, options: FeishuCardOptions): Promise<string | undefined> {
  return sendPayloadToChat(chatId, buildCardPayload(options));
}

async function sendPayloadToChat(chatId: string, payload: FeishuMessagePayload): Promise<string | undefined> {
  const token = await getTenantAccessToken();
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: payload.msg_type,
      content: payload.content,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send Feishu message: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as { data?: { message_id?: string } };
  return body.data?.message_id;
}

async function updateCardMessage(messageId: string, options: FeishuCardOptions): Promise<void> {
  const token = await getTenantAccessToken();
  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      content: buildCardPayload(options).content,
    }),
  });

  if (!response.ok) {
    console.error("Failed to update Feishu message:", response.status, await response.text());
  }
}

class FeishuProgressReporter {
  private readonly mode: AgentModeName;
  private messageId?: string;
  private readonly steps: string[] = [];
  private updateQueue = Promise.resolve();

  private constructor({ mode, messageId }: { mode: AgentModeName; messageId?: string }) {
    this.mode = mode;
    this.messageId = messageId;
  }

  static async start(chatId: string, mode: AgentModeName): Promise<FeishuProgressReporter> {
    const reporter = new FeishuProgressReporter({ mode });
    reporter.addStep("已接收请求，正在启动 Boxgent");
    reporter.messageId = await sendCardToChat(chatId, reporter.card("Boxgent 正在处理", "处理中，状态会在这里实时刷新。"));
    return reporter;
  }

  handle(event: AgentRunEvent): void {
    const step = formatLiveProcessEvent(event);
    if (!step) return;
    this.addStep(step);
    this.queueUpdate("Boxgent 正在处理", "处理中，状态会在这里实时刷新。");
  }

  async complete(): Promise<void> {
    this.addStep("处理完成，正在发送正式回答");
    await this.queueUpdate("Boxgent 已完成", "正式回答已生成。");
  }

  async fail(reason: string): Promise<void> {
    this.addStep(`处理失败：${reason}`);
    await this.queueUpdate("Boxgent 处理失败", "请查看下方错误信息。", "red");
  }

  private addStep(step: string): void {
    if (this.steps[this.steps.length - 1] === step) return;
    this.steps.push(step);
  }

  private async queueUpdate(
    title: string,
    text: string,
    template: FeishuCardOptions["template"] = modeTemplate(this.mode),
  ): Promise<void> {
    if (!this.messageId) return;

    this.updateQueue = this.updateQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await updateCardMessage(this.messageId!, this.card(title, text, template));
        } catch (error) {
          console.error("Failed to queue Feishu progress update:", error);
        }
      });

    await this.updateQueue;
  }

  private card(
    title: string,
    text: string,
    template: FeishuCardOptions["template"] = modeTemplate(this.mode),
  ): FeishuCardOptions {
    return {
      title,
      mode: this.mode,
      text,
      trace: this.steps,
      template,
    };
  }
}

function buildCardPayload(options: FeishuCardOptions): FeishuMessagePayload {
  const mode = options.mode ? ` · ${options.mode}` : "";
  const subtitle = options.subtitle ? `\n<font color="grey">${escapeLarkMd(options.subtitle)}</font>` : "";
  const trace = options.trace?.length
    ? [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: [
              "**处理过程**",
              ...options.trace.map((item) => `- ${escapeLarkMd(item)}`),
            ].join("\n"),
          },
        },
        {
          tag: "hr",
        },
      ]
    : [];
  const content = {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: options.template ?? "blue",
      title: {
        tag: "plain_text",
        content: `${options.title}${mode}`,
      },
    },
    elements: [
      ...trace,
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `${subtitle}\n${escapeLarkMd(options.text)}`.trim(),
        },
      },
    ],
  };

  return {
    msg_type: "interactive",
    content: JSON.stringify(content),
  };
}

function modeTemplate(mode: string): FeishuCardOptions["template"] {
  if (mode === "life") return "green";
  if (mode === "explore") return "yellow";
  return "blue";
}

function formatLiveProcessEvent(event: AgentRunEvent): string | undefined {
  if (event.type === "model_start") {
    return `第 ${event.step} 步：分析请求与上下文`;
  }
  if (event.type === "model_done" && event.toolCount > 0) {
    return `规划 ${event.toolCount} 个工具调用`;
  }
  if (event.type === "tool_start") {
    return `调用工具：${event.toolName}`;
  }
  if (event.type === "tool_done") {
    return `${event.ok ? "完成" : "失败"}：${event.toolName}`;
  }
  if (event.type === "model_done") {
    return "整理正式回答";
  }
  return undefined;
}

function escapeLarkMd(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function getTenantAccessToken(): Promise<string> {
  const appId = Bun.env.FEISHU_APP_ID;
  const appSecret = Bun.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Missing FEISHU_APP_ID or FEISHU_APP_SECRET.");
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Feishu token: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as { tenant_access_token?: string; msg?: string };
  if (!payload.tenant_access_token) {
    throw new Error(`Failed to get Feishu token: ${payload.msg ?? "unknown error"}`);
  }
  return payload.tenant_access_token;
}
