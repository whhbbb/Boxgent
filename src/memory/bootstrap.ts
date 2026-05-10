import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const INITIAL_FILES: Record<string, string> = {
  "work/projects.md": "# Work Projects\n\n",
  "work/communication.md": "# Communication Preferences\n\n",
  "work/inbox.md": "# Work Inbox\n\n",
  "life/routines.md": "# Life Routines\n\n",
  "life/preferences.md": "# Life Preferences\n\n",
  "life/inbox.md": "# Life Inbox\n\n",
  "explore/interests.md": "# Interests\n\n",
  "explore/questions.md": "# Open Questions\n\n",
  "explore/inbox.md": "# Explore Inbox\n\n",
};

export async function ensureMemory(cwd: string): Promise<void> {
  for (const [path, content] of Object.entries(INITIAL_FILES)) {
    const fullPath = join(cwd, "memory", path);
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      await mkdir(dirname(fullPath), { recursive: true });
      await Bun.write(fullPath, content);
    }
  }
}
