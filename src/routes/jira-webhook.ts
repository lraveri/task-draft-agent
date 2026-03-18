import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import type { JiraIssuePayload } from "../services/jira.ts";
import { getConfig } from "../config.ts";

export async function jiraWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: JiraIssuePayload }>(
    "/webhooks/jira",
    {
      config: {
        rawBody: true,
      },
      schema: {
        tags: ["jira"],
        summary: "Receive Jira webhook for task trigger",
        body: {
          type: "object",
          properties: {
            webhookEvent: { type: "string" },
            issue: {
              type: "object",
              properties: {
                key: { type: "string" },
                fields: {
                  type: "object",
                  properties: {
                    summary: { type: "string" },
                    description: { type: "string" },
                    status: {
                      type: "object",
                      properties: { name: { type: "string" } },
                    },
                  },
                },
              },
            },
            changelog: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string" },
                      fromString: { type: "string" },
                      toString: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              ignored: { type: "boolean" },
              duplicate: { type: "boolean" },
              sessionId: { type: "string" },
              jiraKey: { type: "string" },
            },
          },
          401: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          500: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async function (request, reply) {
      const { jira, opencode, database, slackService } = this;

      // Validate webhook signature if secret is configured
      const config = getConfig();
      const webhookSecret = config.JIRA_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = request.headers["x-hub-signature"] as
          | string
          | undefined;
        if (!signature) {
          return reply.status(401).send({ error: "Missing signature" });
        }

        const body = request.rawBody || JSON.stringify(request.body);
        const expected =
          "sha256=" +
          crypto
            .createHmac("sha256", webhookSecret)
            .update(body)
            .digest("hex");

        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        if (
          sigBuf.length !== expBuf.length ||
          !crypto.timingSafeEqual(sigBuf, expBuf)
        ) {
          return reply.status(401).send({ error: "Invalid signature" });
        }
      }

      const payload = request.body;

      if (!jira.isStatusChangeToTarget(payload)) {
        return reply.status(200).send({ ignored: true });
      }

      const jiraKey = payload.issue.key;

      const existing = database.getTaskByJiraKey(jiraKey);
      if (existing) {
        return reply.status(200).send({ duplicate: true });
      }

      try {
        const issue = jira.parseWebhook(payload);

        const { worktreeService } = this;
        let worktreePath: string | undefined;
        if (worktreeService) {
          worktreePath = await worktreeService.create(jiraKey);
        }

        const sessionId = await opencode.createSession(
          `${jiraKey} — ${issue.summary}`,
          worktreePath,
        );

        const slackChannel = config.SLACK_CHANNEL;
        let mainThreadTs: string | undefined;

        if (slackService) {
          console.log(`[jira] Starting Slack thread for ${jiraKey} in channel ${slackChannel}`);
          mainThreadTs = await slackService.startTaskThread(
            slackChannel,
            jiraKey,
            issue.summary,
          );
          console.log(`[jira] Slack thread created: ts=${mainThreadTs}`);
          database.createSlackThread(mainThreadTs, slackChannel, sessionId);
        }

        database.createTask(jiraKey, sessionId, mainThreadTs, worktreePath);

        const prompt = jira.buildTaskPrompt({
          issue,
          sessionId,
          slackChannel,
          slackThreadTs: mainThreadTs,
        });
        await opencode.sendPrompt(sessionId, prompt);

        return reply.status(200).send({ ok: true, sessionId, jiraKey });
      } catch (error) {
        console.error(`[jira] Failed to start task for ${jiraKey}:`, error);
        return reply.status(500).send({ error: "Failed to start task" });
      }
    },
  );
}
