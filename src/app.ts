import { BoxgentAgent } from "@/core/agent";
import { OpenAICompatibleModel } from "@/core/model";
import { ensureMemory } from "@/memory/bootstrap";

export interface Runtime {
  cwd: string;
  modelName: string;
  agent: BoxgentAgent;
}

export async function createRuntime(cwd: string): Promise<Runtime> {
  await ensureMemory(cwd);

  const baseURL = Bun.env.MODEL_BASE_URL;
  const apiKey = Bun.env.MODEL_API_KEY;
  const modelName = Bun.env.MODEL_NAME;

  if (!baseURL || !apiKey || !modelName) {
    throw new Error("Missing MODEL_BASE_URL, MODEL_API_KEY, or MODEL_NAME.");
  }

  const model = new OpenAICompatibleModel({
    baseURL,
    apiKey,
    model: modelName,
  });

  return {
    cwd,
    modelName,
    agent: new BoxgentAgent({ model, cwd }),
  };
}
