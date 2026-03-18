import { exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../config.ts";

const execAsync = promisify(exec);

export class WorktreeService {
  private baseDir: string;
  private repoPath: string;
  private setupCmd: string | undefined;

  constructor() {
    const config = getConfig();
    this.baseDir = config.WORKTREE_BASE_DIR;
    this.repoPath = config.GIT_REPO_PATH!;
    this.setupCmd = config.WORKTREE_SETUP_CMD;
  }

  worktreePath(jiraKey: string): string {
    const sanitized = jiraKey.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    return path.join(this.baseDir, sanitized);
  }

  branchName(jiraKey: string): string {
    const sanitized = jiraKey.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
    return `task/${sanitized}`;
  }

  async create(jiraKey: string): Promise<string> {
    const worktreePath = this.worktreePath(jiraKey);
    const branch = this.branchName(jiraKey);

    mkdirSync(this.baseDir, { recursive: true });

    await execAsync(
      `git worktree add "${worktreePath}" -b "${branch}"`,
      { cwd: this.repoPath },
    );
    console.log(`[worktree] Created at ${worktreePath} on branch ${branch}`);

    if (this.setupCmd) {
      console.log(`[worktree] Running setup: ${this.setupCmd}`);
      const { stdout, stderr } = await execAsync(this.setupCmd, { cwd: worktreePath });
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      console.log(`[worktree] Setup complete`);
    }

    return worktreePath;
  }

  async remove(jiraKey: string): Promise<void> {
    const worktreePath = this.worktreePath(jiraKey);
    await execAsync(
      `git worktree remove "${worktreePath}" --force`,
      { cwd: this.repoPath },
    );
    console.log(`[worktree] Removed ${worktreePath}`);
  }
}

export function isWorktreeEnabled(): boolean {
  return !!getConfig().GIT_REPO_PATH;
}
