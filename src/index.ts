import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { App } from "@slack/bolt";
import { apiRoutes } from "./routes/api.ts";
import { jiraWebhookRoutes } from "./routes/jira-webhook.ts";
import { JiraService } from "./services/jira.ts";
import { OpencodeService } from "./services/opencode.ts";
import { getDatabase, type Database } from "./db/database.ts";
import { SlackService } from "./services/slack.ts";
import { WorktreeService, isWorktreeEnabled } from "./services/worktree.ts";
import { slackEventsRoutes } from "./routes/slack-events.ts";
import { contactRoutes } from "./routes/contact.ts";
import { getConfig } from "./config.ts";

declare module "fastify" {
  interface FastifyInstance {
    jira: JiraService;
    opencode: OpencodeService;
    database: Database;
    slackService?: SlackService;
    worktreeService?: WorktreeService;
  }
}

export interface AppDependencies {
  jira?: JiraService;
  opencode?: OpencodeService;
  database?: Database;
  slackService?: SlackService;
  worktreeService?: WorktreeService;
}

export async function buildApp(deps?: AppDependencies) {
  const config = getConfig();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  app.decorate("jira", deps?.jira ?? new JiraService());
  app.decorate("opencode", deps?.opencode ?? new OpencodeService());
  app.decorate("database", deps?.database ?? getDatabase());
  const worktreeService = deps?.worktreeService ?? (isWorktreeEnabled() ? new WorktreeService() : undefined);
  app.decorate("worktreeService", worktreeService);
  let slackService = deps?.slackService;
  if (!slackService) {
    const slackApp = new App({
      token: config.SLACK_BOT_TOKEN,
      signingSecret: config.SLACK_SIGNING_SECRET,
    });
    slackService = new SlackService(slackApp, app.database, app.opencode);
    console.log("[slack] SlackService initialized");
  }
  app.decorate("slackService", slackService);

  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Implement Task Pipeline",
        description: "A pipeline that takes a Jira issue, creates a task in OpenCode, and manages the investigation process with Slack integration.",
        version: "1.0.0",
      },
    },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  await app.register(apiRoutes);
  await app.register(jiraWebhookRoutes);
  await app.register(slackEventsRoutes);
  await app.register(contactRoutes);

  return app;
}

// Start server when run directly
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  // Validate config eagerly at startup — explodes if any required env var is missing
  const { PORT: port, HOST: host } = getConfig();

  const dataDir = path.resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  console.log("[db] SQLite database initialized");

  const app = await buildApp();

  const shutdown = async () => {
    console.log("[server] Shutting down...");
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await app.listen({ port, host });
  console.log(`[server] Management server running on http://${host}:${port}`);
  console.log(`[server] Endpoints:`);
  console.log(`  POST /webhooks/jira      — Jira webhook receiver`);
  console.log(`  GET  /api/team-members   — Team members list`);
  console.log(`  POST /api/contact        — Send Slack message`);
  console.log(`  POST /slack/events       — Slack event receiver`);
  console.log(`  GET  /health             — Health check`);
}
