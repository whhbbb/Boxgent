import { getMode } from "@/modes";
import { routeInput } from "@/modes/router";
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

  const result = await runtime.agent.run({
    input: routed.text,
    mode: getMode(mode),
    visibleProcess: true,
  });
  const visible = parseVisibleProcess(result.answer);

  await sendCardToChat(message.chat_id, {
    title: "Boxgent",
    mode: result.mode,
    text: visible.answer,
    trace: visible.process,
    template: modeTemplate(result.mode),
  });
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

async function sendMessageToChat(chatId: string, text: string): Promise<void> {
  await sendCardToChat(chatId, {
    title: "Boxgent 自动任务",
    text,
    template: "turquoise",
  });
}

async function sendCardToChat(chatId: string, options: FeishuCardOptions): Promise<void> {
  await sendPayloadToChat(chatId, buildCardPayload(options));
}

async function sendPayloadToChat(chatId: string, payload: FeishuMessagePayload): Promise<void> {
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

function escapeLarkMd(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseVisibleProcess(text: string): { process: string[]; answer: string } {
  const process = extractTag(text, "process");
  const answer = extractTag(text, "answer");
  if (!process && !answer) {
    return { process: [], answer: text };
  }

  return {
    process: process ? normalizeProcess(process) : [],
    answer: answer?.trim() || text.replace(/<\/?(?:process|answer)>/g, "").trim(),
  };
}

function extractTag(text: string, tag: "process" | "answer"): string | undefined {
  const matched = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i"));
  return matched?.[1]?.trim();
}

function normalizeProcess(process: string): string[] {
  return process
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
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
