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
      await replyToMessage(message.message_id, scheduleResponse);
      return Response.json({ ok: true });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await replyToMessage(message.message_id, `自动任务设置失败：${reason}`);
    return Response.json({ ok: true });
  }

  const routed = routeInput(text);
  const mode = routed.mode ?? currentMode;
  chatModes.set(message.chat_id, mode);

  if (routed.switched && !routed.text) {
    await replyToMessage(message.message_id, `已切换到 ${mode} 模式。`);
    return Response.json({ ok: true });
  }

  const result = await runtime.agent.run({
    input: routed.text,
    mode: getMode(mode),
  });

  await replyToMessage(message.message_id, `[${result.mode}]\n${result.answer}`);
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

async function replyToMessage(messageId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();
  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });

  if (!response.ok) {
    console.error("Failed to reply Feishu message:", response.status, await response.text());
  }
}

async function sendMessageToChat(chatId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();
  const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send Feishu message: ${response.status} ${await response.text()}`);
  }
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
