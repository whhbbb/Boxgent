import type { AgentModeName, ModeConfig } from "@/core/mode";

import { exploreMode } from "./explore";
import { lifeMode } from "./life";
import { workMode } from "./work";

export const modes = {
  work: workMode,
  life: lifeMode,
  explore: exploreMode,
} satisfies Record<AgentModeName, ModeConfig>;

export function getMode(name: AgentModeName): ModeConfig {
  return modes[name];
}

export function isModeName(value: string): value is AgentModeName {
  return value === "work" || value === "life" || value === "explore";
}
