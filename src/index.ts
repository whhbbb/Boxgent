import { createRuntime } from "@/app";
import { startCli } from "@/interfaces/cli";
import { startFeishuServer } from "@/interfaces/feishu";

const command = process.argv[2] ?? "cli";
const runtime = await createRuntime(process.cwd());

if (command === "cli") {
  await startCli(runtime, process.argv.slice(3));
} else if (command === "feishu") {
  await startFeishuServer(runtime);
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: bun run src/index.ts cli [mode] [message]");
  console.error("       bun run src/index.ts feishu");
  process.exit(1);
}
