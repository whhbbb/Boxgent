import type { AgentModeName } from "@/core/mode";

import { isModeName } from "./index";

export interface RoutedInput {
  mode?: AgentModeName;
  text: string;
  switched: boolean;
}

const PREFIXES: Record<string, AgentModeName> = {
  "/work": "work",
  "/工作": "work",
  "/life": "life",
  "/生活": "life",
  "/explore": "explore",
  "/探索": "explore",
};

export function routeInput(input: string): RoutedInput {
  const trimmed = input.trim();
  const [first, ...rest] = trimmed.split(/\s+/);
  const explicit = PREFIXES[first ?? ""];
  if (explicit) {
    return { mode: explicit, text: rest.join(" ").trim(), switched: true };
  }
  return { text: trimmed, switched: false };
}

export function parseMode(value: string | undefined, fallback: AgentModeName = "work"): AgentModeName {
  if (!value) return fallback;
  return isModeName(value) ? value : fallback;
}
