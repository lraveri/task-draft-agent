import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { getConfig } from "../config.ts";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export class OpencodeService {
  private client: OpencodeClient;

  constructor(baseUrl?: string) {
    this.client = createOpencodeClient({
      baseUrl: baseUrl || getConfig().OPENCODE_URL,
    });
  }

  async createSession(title: string, directory?: string): Promise<string> {
    const response = await this.client.session.create({
      body: { title },
      query: directory ? { directory } : undefined,
    });
    return response.data!.id;
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text }],
      },
    });
  }

  async isSessionIdle(sessionId: string): Promise<boolean> {
    const response = await this.client.session.status();
    const statuses = response.data!;
    const status = statuses[sessionId];
    if (!status) return true;
    return status.type === "idle";
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.client.session.abort({
      path: { id: sessionId },
    });
  }

  async waitForIdle(
    sessionId: string,
    timeoutMs: number = 30000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isSessionIdle(sessionId)) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Session ${sessionId} did not become idle within ${timeoutMs}ms`,
    );
  }

  async resumeSessionWithReply(
    sessionId: string,
    senderName: string,
    message: string,
  ): Promise<void> {
    const idle = await this.isSessionIdle(sessionId);

    if (!idle) {
      await this.abortSession(sessionId);
      await this.waitForIdle(sessionId);
    }

    const prompt = `Human reply from ${senderName}:\n\n${message}\n\nContinue your work based on this reply. You have full context from your previous work.`;
    await this.sendPrompt(sessionId, prompt);
  }
}
