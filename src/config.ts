import { z } from "zod";
import path from "node:path";

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DB_PATH: z.string().default(path.join(process.cwd(), "data", "routing.db")),
  OPENCODE_URL: z.string().default("http://localhost:4096"),
  SLACK_BOT_TOKEN: z.string(),
  SLACK_SIGNING_SECRET: z.string(),
  SLACK_CHANNEL: z.string(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  JIRA_TRIGGER_STATUS: z.string().default("ready for investigation"),
  JIRA_BASE_URL: z.string(),
  JIRA_USER_EMAIL: z.string(),
  JIRA_API_TOKEN: z.string(),
  // Git worktree isolation: set GIT_REPO_PATH to enable per-task worktrees
  GIT_REPO_PATH: z.string().optional(),
  WORKTREE_BASE_DIR: z.string().default(path.join(process.cwd(), "data", "worktrees")),
  WORKTREE_SETUP_CMD: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

let config: Config | undefined;

export function getConfig(): Config {
  if (!config) {
    config = configSchema.parse(process.env);
  }
  return config;
}

export function resetConfig(): void {
  config = undefined;
}
