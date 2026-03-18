import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.ts";

export class Database {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const raw = dbPath || getConfig().DB_PATH;
    const resolvedPath = raw === ":memory:" ? raw : path.resolve(raw);
    if (resolvedPath !== ":memory:") {
      mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        jira_key TEXT PRIMARY KEY,
        opencode_session_id TEXT NOT NULL,
        main_slack_thread_ts TEXT,
        worktree_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Migration: add worktree_path for existing databases
    try {
      this.db.exec("ALTER TABLE tasks ADD COLUMN worktree_path TEXT");
    } catch {
      // Column already exists — no-op
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS slack_threads (
        slack_thread_ts TEXT PRIMARY KEY,
        slack_channel TEXT NOT NULL,
        opencode_session_id TEXT NOT NULL,
        target_user TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_slack_threads_session
      ON slack_threads(opencode_session_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_session
      ON tasks(opencode_session_id)
    `);
  }

  // --- Task queries ---

  createTask(
    jiraKey: string,
    sessionId: string,
    slackThreadTs?: string,
    worktreePath?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (jira_key, opencode_session_id, main_slack_thread_ts, worktree_path)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(jiraKey, sessionId, slackThreadTs ?? null, worktreePath ?? null);
  }

  getTaskByJiraKey(jiraKey: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE jira_key = ?
    `);
    return stmt.get(jiraKey) as
      | {
          jira_key: string;
          opencode_session_id: string;
          main_slack_thread_ts: string | null;
          worktree_path: string | null;
          created_at: string;
        }
      | undefined;
  }

  getTaskBySessionId(sessionId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE opencode_session_id = ?
    `);
    return stmt.get(sessionId) as
      | {
          jira_key: string;
          opencode_session_id: string;
          main_slack_thread_ts: string | null;
          worktree_path: string | null;
          created_at: string;
        }
      | undefined;
  }

  updateTaskThread(
    jiraKey: string,
    slackThreadTs: string,
  ): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET main_slack_thread_ts = ? WHERE jira_key = ?
    `);
    stmt.run(slackThreadTs, jiraKey);
  }

  // --- Slack thread queries ---

  createSlackThread(
    threadTs: string,
    channel: string,
    sessionId: string,
    targetUser?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO slack_threads (slack_thread_ts, slack_channel, opencode_session_id, target_user)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(threadTs, channel, sessionId, targetUser ?? null);
  }

  getSessionBySlackThread(threadTs: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM slack_threads WHERE slack_thread_ts = ?
    `);
    return stmt.get(threadTs) as
      | {
          slack_thread_ts: string;
          slack_channel: string;
          opencode_session_id: string;
          target_user: string | null;
          created_at: string;
        }
      | undefined;
  }

  getThreadsBySession(sessionId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM slack_threads WHERE opencode_session_id = ?
    `);
    return stmt.all(sessionId) as Array<{
      slack_thread_ts: string;
      slack_channel: string;
      opencode_session_id: string;
      target_user: string | null;
      created_at: string;
    }>;
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let instance: Database | undefined;

export function getDatabase(dbPath?: string): Database {
  if (!instance) {
    instance = new Database(dbPath);
  }
  return instance;
}
