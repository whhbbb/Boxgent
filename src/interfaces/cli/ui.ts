import type { AgentRunEvent } from "@/core/agent";
import type { AgentModeName } from "@/core/mode";

const appName = "Boxgent";
const appVersion = "0.1.0";
const isTty = Boolean(process.stdout.isTTY);
const frames = ["◐", "◓", "◑", "◒"];

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

const modeColors: Record<AgentModeName | string, string> = {
  work: colors.cyan,
  life: colors.green,
  explore: colors.yellow,
};

const modeAccent: Record<AgentModeName, string> = {
  work: "cyan",
  life: "green",
  explore: "yellow",
};

export interface CliHeroMeta {
  cwd: string;
  modelName: string;
}

export function renderWelcome(currentMode: AgentModeName, meta: CliHeroMeta): void {
  setWindowTitle(currentMode);
  console.info([
    "",
    ...heroLines(currentMode, meta),
    "",
  ].join("\n"));
}

export function renderMode(currentMode: AgentModeName): void {
  setWindowTitle(currentMode);
  console.info(`${color("Current", colors.dim)} ${modeBadge(currentMode)} ${color(modeAccent[currentMode], colors.gray)}\n`);
}

export function renderModeSwitch(currentMode: AgentModeName): void {
  setWindowTitle(currentMode);
  const modeColor = modeColors[currentMode] ?? colors.cyan;
  console.info(`${color("Switched", colors.dim)} ${color("●", modeColor)} ${modeBadge(currentMode)} ${color(modeAccent[currentMode], colors.gray)}\n`);
}

export function promptFor(currentMode: AgentModeName): string {
  setWindowTitle(currentMode);
  const modeColor = modeColors[currentMode] ?? colors.cyan;
  return `\n${ruleLine()}\n${color(currentMode, modeColor)} ${color("›", colors.bold)} `;
}

export function renderPromptClose(): void {
  console.info(ruleLine());
}

export function renderAnswer(mode: string, answer: string): void {
  console.info(`\n${color("╭─", colors.blue)} ${modeBadge(mode)} ${color("answer", colors.dim)}`);
  console.info(answer);
  console.info(`${color("╰─", colors.blue)} ${color("done", colors.dim)}\n`);
}

export class RunStatus {
  private timer?: ReturnType<typeof setInterval>;
  private frameIndex = 0;
  private text = "";
  private active = false;

  start(mode: AgentModeName): void {
    this.active = true;
    this.text = `warming ${mode} context`;
    console.info(`${color("╭─", colors.blue)} ${modeBadge(mode)} ${color("trace", colors.dim)}`);
    this.eventLine("boot", "loading mode prompt and available tools", colors.cyan);
    this.render();
    if (isTty) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % frames.length;
        this.render();
      }, 120);
    }
  }

  handle(event: AgentRunEvent): void {
    if (!this.active) return;

    if (event.type === "model_start") {
      this.text = `thinking through ${event.mode} request · step ${event.step}`;
      this.eventLine("think", `step ${event.step}: analyzing request and context`, colors.magenta);
      this.render();
      return;
    }

    if (event.type === "model_done" && event.toolCount > 0) {
      this.text = `planning ${event.toolCount} tool ${event.toolCount === 1 ? "call" : "calls"}`;
      this.eventLine("plan", `${event.toolCount} tool ${event.toolCount === 1 ? "call" : "calls"} queued`, colors.yellow);
      this.render();
      return;
    }

    if (event.type === "model_done") {
      this.text = "shaping the final response";
      this.eventLine("write", "drafting final answer", colors.green);
      this.render();
      return;
    }

    if (event.type === "tool_start") {
      this.text = `using ${event.toolName}`;
      this.eventLine("tool", event.toolName, colors.cyan);
      this.render();
      return;
    }

    if (event.type === "tool_done") {
      this.eventLine(event.ok ? "ok" : "fail", event.toolName, event.ok ? colors.green : colors.red);
      this.text = "reading the result";
      this.render();
      return;
    }

    if (event.type === "final") {
      this.text = "ready";
      this.render();
    }
  }

  stop(): void {
    if (!this.active) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.active = false;

    if (isTty) {
      process.stdout.write("\r\x1b[2K");
    } else {
      process.stdout.write("\n");
    }
    console.info(`${color("╰─", colors.blue)} ${color("trace complete", colors.dim)}`);
  }

  private render(): void {
    const frame = frames[this.frameIndex]!;
    const line = `${color("│", colors.blue)} ${color(frame, colors.yellow)} ${color(this.text, colors.dim)}`;
    if (isTty) {
      process.stdout.write(`\r\x1b[2K${line}`);
    } else {
      console.info(line);
    }
  }

  private eventLine(label: string, text: string, statusColor: string): void {
    if (isTty) {
      process.stdout.write(`\r\x1b[2K${color("│", colors.blue)} ${color(label.padEnd(5), statusColor)} ${color("·", colors.gray)} ${text}\n`);
    } else {
      console.info(`${color("│", colors.blue)} ${label.padEnd(5)} · ${text}`);
    }
  }
}

function setWindowTitle(mode: AgentModeName): void {
  if (isTty) {
    process.stdout.write(`\x1b]0;${appName} - ${mode}\x07`);
  }
}

function modeBadge(mode: AgentModeName | string): string {
  const modeColor = modeColors[mode] ?? colors.cyan;
  return `${color("⟦", colors.gray)}${color(appName, colors.bold)} ${color(mode, modeColor)}${color("⟧", colors.gray)}`;
}

function color(value: string, code: string): string {
  if (!isTty) return value;
  return `${code}${value}${colors.reset}`;
}

function heroLines(currentMode: AgentModeName, meta: CliHeroMeta): string[] {
  const icon = logoLines();
  const text = [
    `${color(appName, colors.bold + colors.cyan)}  ${color(`v${appVersion}`, colors.gray)}`,
    color(meta.modelName, colors.gray),
    color(meta.cwd, colors.gray),
    `${color("mode", colors.dim)} ${modeBadge(currentMode)}  ${modeLegend()}  ${color("/mode /exit", colors.gray)}`,
  ];

  return icon.map((line, index) => `${line}  ${text[index] ?? ""}`);
}

function modeLegend(): string {
  return [
    color("/work", colors.cyan),
    color("/life", colors.green),
    color("/explore", colors.yellow),
  ].join(" ");
}

function logoLines(): string[] {
  const mark = [
    "    ██      ██    ",
    "    ██  ██  ██    ",
    "  ██████████████  ",
    "  ██  ██  ██  ██  ",
    "████  ██████  ████",
    "  ██████████████  ",
    "    ████  ████    ",
  ];

  return mark.map((line, index) => {
    if (index === 3) {
      return color(line.slice(0, 7), colors.cyan) + color("BX", colors.bold) + color(line.slice(9), colors.cyan);
    }
    return color(line, colors.blue);
  });
}

function ruleLine(): string {
  const width = Math.max(72, process.stdout.columns ?? 96);
  return color("─".repeat(width), colors.gray);
}
