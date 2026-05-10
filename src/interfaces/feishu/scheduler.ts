import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Runtime } from "@/app";
import type { AgentModeName } from "@/core/mode";
import { getMode } from "@/modes";

type ScheduleKind = "once" | "interval" | "daily";
type TaskStatus = "active" | "completed" | "cancelled" | "failed";

interface FeishuScheduledTask {
  id: string;
  chatId: string;
  mode: AgentModeName;
  instruction: string;
  kind: ScheduleKind;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  intervalMs?: number;
  dailyTime?: string;
  lastRunAt?: number;
  lastError?: string;
}

interface SchedulerOptions {
  runtime: Runtime;
  cwd: string;
  sendMessage: (chatId: string, text: string) => Promise<void>;
}

interface CreateScheduleInput {
  chatId: string;
  mode: AgentModeName;
  instruction: string;
  kind: ScheduleKind;
  nextRunAt: number;
  intervalMs?: number;
  dailyTime?: string;
}

const MAX_TIMEOUT_MS = 2_147_483_647;
const MIN_INTERVAL_MS = 60_000;

export class FeishuAutomationScheduler {
  private readonly runtime: Runtime;
  private readonly dataFile: string;
  private readonly sendMessage: (chatId: string, text: string) => Promise<void>;
  private readonly tasks = new Map<string, FeishuScheduledTask>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly chatRuns = new Map<string, Promise<void>>();
  private started = false;

  constructor(options: SchedulerOptions) {
    this.runtime = options.runtime;
    this.sendMessage = options.sendMessage;
    this.dataFile = join(options.cwd, "data", "feishu-schedules.json");
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.load();
    this.started = true;
    for (const task of this.tasks.values()) {
      this.arm(task);
    }
  }

  async create(input: CreateScheduleInput): Promise<FeishuScheduledTask> {
    const now = Date.now();
    const task: FeishuScheduledTask = {
      id: crypto.randomUUID(),
      chatId: input.chatId,
      mode: input.mode,
      instruction: input.instruction,
      kind: input.kind,
      status: "active",
      createdAt: now,
      updatedAt: now,
      nextRunAt: input.nextRunAt,
      intervalMs: input.intervalMs,
      dailyTime: input.dailyTime,
    };

    this.tasks.set(task.id, task);
    await this.save();
    this.arm(task);
    return task;
  }

  list(chatId: string): FeishuScheduledTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.chatId === chatId && task.status === "active")
      .sort((left, right) => left.nextRunAt - right.nextRunAt);
  }

  async cancel(chatId: string, idPrefix: string): Promise<FeishuScheduledTask | undefined> {
    const matches = [...this.tasks.values()].filter(
      (task) => task.chatId === chatId && task.status === "active" && task.id.startsWith(idPrefix),
    );
    if (matches.length !== 1) return undefined;

    const task = matches[0];
    task.status = "cancelled";
    task.updatedAt = Date.now();
    this.clearTimer(task.id);
    await this.save();
    return task;
  }

  private arm(task: FeishuScheduledTask): void {
    if (!this.started || task.status !== "active") return;

    this.clearTimer(task.id);
    const delay = Math.max(0, task.nextRunAt - Date.now());
    const timeout = Math.min(delay, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (delay > MAX_TIMEOUT_MS) {
        this.arm(task);
        return;
      }
      void this.fire(task.id);
    }, timeout);
    this.timers.set(task.id, timer);
  }

  private async fire(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "active") return;

    const previous = this.chatRuns.get(task.chatId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await this.runTask(task);
    });
    this.chatRuns.set(task.chatId, current);

    try {
      await current;
    } finally {
      if (this.chatRuns.get(task.chatId) === current) {
        this.chatRuns.delete(task.chatId);
      }
    }
  }

  private async runTask(task: FeishuScheduledTask): Promise<void> {
    task.lastRunAt = Date.now();
    task.updatedAt = task.lastRunAt;
    await this.save();

    try {
      const result = await this.runtime.agent.run({
        input: task.instruction,
        mode: getMode(task.mode),
      });
      await this.sendMessage(
        task.chatId,
        `任务 ${shortId(task.id)} · ${result.mode}\n\n${result.answer}`,
      );
      this.advance(task);
    } catch (error) {
      task.status = "failed";
      task.lastError = error instanceof Error ? error.message : String(error);
      task.updatedAt = Date.now();
      try {
        await this.sendMessage(task.chatId, `任务 ${shortId(task.id)} 失败\n\n${task.lastError}`);
      } catch (notifyError) {
        console.error("Failed to send Feishu automation failure message:", notifyError);
      }
    }

    await this.save();
    this.arm(task);
  }

  private advance(task: FeishuScheduledTask): void {
    const now = Date.now();
    if (task.kind === "once") {
      task.status = "completed";
      task.updatedAt = now;
      return;
    }

    if (task.kind === "interval" && task.intervalMs) {
      task.nextRunAt = now + task.intervalMs;
      task.updatedAt = now;
      return;
    }

    if (task.kind === "daily" && task.dailyTime) {
      task.nextRunAt = nextDailyTime(task.dailyTime, now);
      task.updatedAt = now;
    }
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) clearTimeout(timer);
    this.timers.delete(taskId);
  }

  private async load(): Promise<void> {
    const file = Bun.file(this.dataFile);
    if (!(await file.exists())) return;

    const raw = await file.text();
    if (!raw.trim()) return;

    const tasks = JSON.parse(raw) as FeishuScheduledTask[];
    for (const task of tasks) {
      if (task.status === "active") {
        this.tasks.set(task.id, task);
      }
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.dataFile), { recursive: true });
    await Bun.write(this.dataFile, `${JSON.stringify([...this.tasks.values()], null, 2)}\n`);
  }
}

export async function handleScheduleCommand({
  scheduler,
  chatId,
  mode,
  text,
}: {
  scheduler: FeishuAutomationScheduler;
  chatId: string;
  mode: AgentModeName;
  text: string;
}): Promise<string | undefined> {
  const command = parseScheduleCommand(text);
  if (!command) return undefined;

  if (command.type === "help") {
    return scheduleHelp();
  }

  if (command.type === "list") {
    const tasks = scheduler.list(chatId);
    if (tasks.length === 0) return "当前没有活跃的自动任务。";
    return tasks.map(formatTask).join("\n");
  }

  if (command.type === "cancel") {
    const cancelled = await scheduler.cancel(chatId, command.id);
    if (!cancelled) return `没有找到唯一匹配的任务：${command.id}`;
    return `已取消自动任务 ${shortId(cancelled.id)}。`;
  }

  const created = await scheduler.create({
    chatId,
    mode,
    instruction: command.instruction,
    kind: command.kind,
    nextRunAt: command.nextRunAt,
    intervalMs: command.intervalMs,
    dailyTime: command.dailyTime,
  });

  return `已创建自动任务 ${shortId(created.id)}，下次运行：${formatDate(created.nextRunAt)}。`;
}

type ParsedScheduleCommand =
  | { type: "help" }
  | { type: "list" }
  | { type: "cancel"; id: string }
  | {
      type: "create";
      kind: ScheduleKind;
      instruction: string;
      nextRunAt: number;
      intervalMs?: number;
      dailyTime?: string;
    };

function parseScheduleCommand(text: string): ParsedScheduleCommand | undefined {
  const trimmed = text.trim();
  const matched = trimmed.match(/^\/(?:schedule|定时|automation|自动化)(?:\s+|$)(.*)$/i);
  if (!matched) return undefined;

  const rest = matched[1].trim();
  if (!rest || /^(help|帮助)$/i.test(rest)) return { type: "help" };
  if (/^(list|ls|列表)$/i.test(rest)) return { type: "list" };

  const cancel = rest.match(/^(?:cancel|delete|remove|取消|删除)\s+(\S+)$/i);
  if (cancel) return { type: "cancel", id: cancel[1] };

  const daily = rest.match(/^(?:daily|每天)\s+(\d{1,2}:\d{2})\s+(.+)$/i);
  if (daily) {
    const dailyTime = normalizeTime(daily[1]);
    return {
      type: "create",
      kind: "daily",
      instruction: daily[2].trim(),
      dailyTime,
      nextRunAt: nextDailyTime(dailyTime, Date.now()),
    };
  }

  const every = rest.match(/^(?:every|每)\s+(\d+)\s*([smhd]|秒|分钟|分|小时|时|天)\s+(.+)$/i);
  if (every) {
    const intervalMs = durationMs(Number(every[1]), every[2]);
    if (intervalMs < MIN_INTERVAL_MS) {
      throw new Error("自动任务间隔至少需要 1 分钟。");
    }
    return {
      type: "create",
      kind: "interval",
      instruction: every[3].trim(),
      intervalMs,
      nextRunAt: Date.now() + intervalMs,
    };
  }

  const once = rest.match(/^(?:(?:at|在)\s+)?(\d{4}-\d{1,2}-\d{1,2})[ T](\d{1,2}:\d{2})\s+(.+)$/i);
  if (once) {
    const nextRunAt = parseLocalDateTime(once[1], once[2]);
    if (nextRunAt <= Date.now()) {
      throw new Error("自动任务时间必须晚于当前时间。");
    }
    return {
      type: "create",
      kind: "once",
      instruction: once[3].trim(),
      nextRunAt,
    };
  }

  return { type: "help" };
}

function parseLocalDateTime(datePart: string, timePart: string): number {
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = normalizeTime(timePart).split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function normalizeTime(value: string): string {
  const matched = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) throw new Error(`时间格式无效：${value}`);

  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) throw new Error(`时间格式无效：${value}`);
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function durationMs(amount: number, unit: string): number {
  const normalized = unit.toLowerCase();
  if (normalized === "s" || normalized === "秒") return amount * 1_000;
  if (normalized === "m" || normalized === "分" || normalized === "分钟") return amount * 60_000;
  if (normalized === "h" || normalized === "时" || normalized === "小时") return amount * 3_600_000;
  return amount * 86_400_000;
}

function nextDailyTime(time: string, from: number): number {
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function formatTask(task: FeishuScheduledTask): string {
  const schedule =
    task.kind === "interval" && task.intervalMs
      ? `每 ${formatDuration(task.intervalMs)}`
      : task.kind === "daily" && task.dailyTime
        ? `每天 ${task.dailyTime}`
        : "单次";
  return `${shortId(task.id)} | ${schedule} | ${formatDate(task.nextRunAt)} | ${task.instruction}`;
}

function formatDuration(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} 天`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`;
  if (ms % 60_000 === 0) return `${ms / 60_000} 分钟`;
  return `${Math.round(ms / 1_000)} 秒`;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function scheduleHelp(): string {
  return [
    "自动任务用法：",
    "/schedule at 2026-05-10 21:30 总结今天的工作",
    "/schedule every 30m 检查一下项目状态",
    "/schedule daily 09:00 生成今日计划",
    "/schedule list",
    "/schedule cancel <任务ID>",
    "中文别名：/定时、/自动化；时间按服务器本地时区解析。",
  ].join("\n");
}
