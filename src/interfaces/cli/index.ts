import { createInterface } from "node:readline/promises";

import type { AgentModeName } from "@/core/mode";
import { getMode } from "@/modes";
import { parseMode, routeInput } from "@/modes/router";
import type { Runtime } from "@/app";
import {
  promptFor,
  renderAnswer,
  renderMode,
  renderModeSwitch,
  renderPromptClose,
  renderWelcome,
  RunStatus,
} from "./ui";

export async function startCli(runtime: Runtime, args: string[]): Promise<void> {
  let currentMode = parseMode(args[0], "work");
  const oneShot = args.slice(isModeArg(args[0]) ? 1 : 0).join(" ").trim();

  if (oneShot) {
    renderWelcome(currentMode, { cwd: runtime.cwd, modelName: runtime.modelName });
    await runOnce(runtime, oneShot, currentMode);
    return;
  }

  renderWelcome(currentMode, { cwd: runtime.cwd, modelName: runtime.modelName });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const input = await rl.question(promptFor(currentMode));
      renderPromptClose();
      const trimmed = input.trim();
      if (trimmed === "/exit" || trimmed === "/quit") break;
      if (trimmed === "/mode") {
        renderMode(currentMode);
        continue;
      }
      if (!trimmed) continue;

      const nextMode = await runOnce(runtime, trimmed, currentMode);
      currentMode = nextMode;
    }
  } finally {
    rl.close();
  }
}

async function runOnce(runtime: Runtime, input: string, currentMode: AgentModeName): Promise<AgentModeName> {
  const routed = routeInput(input);
  const mode = routed.mode ?? currentMode;

  if (routed.switched && !routed.text) {
    renderModeSwitch(mode);
    return mode;
  }

  const status = new RunStatus();
  status.start(mode);
  const result = await runtime.agent.run({
    input: routed.text,
    mode: getMode(mode),
    onEvent: (event) => status.handle(event),
  }).finally(() => status.stop());
  renderAnswer(result.mode, result.answer);
  return mode;
}

function isModeArg(value: string | undefined): boolean {
  return value === "work" || value === "life" || value === "explore";
}
