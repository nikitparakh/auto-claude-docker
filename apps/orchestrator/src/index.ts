import { spawn, spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createWriteStream, WriteStream } from 'node:fs';
import { DiscordManager } from './discord.js';
import { feedbackStore } from './feedback.js';

interface SessionState {
  sessionId?: string;
  goal: string;
  phase: 'planning' | 'implementation' | 'testing' | 'critique' | 'completion' | 'error';
  iteration: number;
  maxIterations: number;
  lastCheckpoint?: string;
  agentContext?: unknown;
  startTime: string;
  errors: Array<{
    timestamp: string;
    phase: string;
    error: string;
    recovered: boolean;
  }>;
  metrics: {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    totalTokensUsed?: number;
    totalCost?: number;
  };
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  phase: string;
  iteration: number;
  message: string;
  metadata?: unknown;
}

class Logger {
  private logFile: WriteStream;
  private logLevel: string = process.env.LOG_LEVEL || 'info';

  constructor(projectDir: string) {
    const logPath = join(projectDir, '.claude', 'orchestrator.log');
    this.logFile = createWriteStream(logPath, { flags: 'a' });
  }

  private shouldLog(level: string): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level as keyof typeof levels] >= levels[this.logLevel as keyof typeof levels];
  }

  log(entry: LogEntry) {
    if (this.shouldLog(entry.level)) {
      const logLine = JSON.stringify(entry) + '\n';
      this.logFile.write(logLine);

      // Also output to console with appropriate formatting
      const timestamp = new Date(entry.timestamp).toISOString();
      const prefix = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.phase}:${entry.iteration}]`;

      switch (entry.level) {
        case 'error':
          console.error(`🔴 ${prefix} ${entry.message}`);
          break;
        case 'warn':
          console.warn(`🟡 ${prefix} ${entry.message}`);
          break;
        case 'info':
          console.log(`🟢 ${prefix} ${entry.message}`);
          break;
        case 'debug':
          if (this.shouldLog('debug')) {
            console.log(`⚪ ${prefix} ${entry.message}`);
          }
          break;
      }
    }
  }

  close() {
    this.logFile.end();
  }
}

class ResourceManager {
  private activeOperations = new Set<string>();
  private maxConcurrentOps = parseInt(process.env.MAX_CONCURRENT_OPS || '5');

  async executeOperation<T>(
    operationId: string,
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    if (this.activeOperations.size >= this.maxConcurrentOps) {
      throw new Error(`Maximum concurrent operations (${this.maxConcurrentOps}) reached`);
    }

    this.activeOperations.add(operationId);

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Operation ${operationId} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      });

      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  getActiveOperations(): string[] {
    return Array.from(this.activeOperations);
  }

  async cleanup() {
    // Wait for all active operations to complete or timeout
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.activeOperations.size > 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (this.activeOperations.size > 0) {
      console.warn(`⚠️  ${this.activeOperations.size} operations still active during cleanup`);
    }
  }
}

interface ClaudeTurn {
  type: string;
  result?: string;
  session_id?: string;
  is_error?: boolean;
  content?: unknown;
}

function promptWithFeedback(originalPrompt: string): string {
  const pending = feedbackStore.dequeueAll();
  if (pending.length === 0) {
    return originalPrompt;
  }

  const feedbackBlock = pending
    .map(
      f =>
        `- From ${f.authorTag} at ${f.timestamp}: ${f.content}${
          f.attachments.length > 0
            ? `\n  Attachments:\n${f.attachments.map(a => `    - ${a.name}: ${a.url}`).join('\n')}`
            : ''
        }`
    )
    .join('\n');

  return `${originalPrompt}

Additionally, incorporate the following HIGH-PRIORITY external feedback before proceeding. Treat this feedback as top priority requirements and constraints. If it contradicts previous plans, adapt accordingly:
${feedbackBlock}`;
}

function slugifyCategoryName(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  // Discord category name limit is 100 chars; keep it shorter
  return base.slice(0, 80) || 'project';
}

class Orchestrator {
  private projectDir = '/project';
  private projectName = process.env.CLAUDE_PROJECT_NAME || 'claude-project';
  private maxRetries = parseInt(process.env.MAX_RETRIES || '3');
  private timeoutMs = parseInt(process.env.DEFAULT_TIMEOUT || '300000'); // 5 minutes
  private sessionState: SessionState;
  private logger: Logger;
  private resourceManager: ResourceManager;
  private isShuttingDown = false;
  private discord?: DiscordManager;
  private statusChannelId?: string;
  private feedbackChannelId?: string;
  private statusInterval?: ReturnType<typeof setInterval>;
  private shouldInterruptForFeedback = false;
  private currentClaudeProcess?: ReturnType<typeof spawn>;

  constructor(goalFallback?: string) {
    this.ensureProjectWorkspace();

    this.logger = new Logger(this.projectDir);
    this.resourceManager = new ResourceManager();

    // Initialize sessionState early to avoid race conditions
    this.sessionState = {
      goal: '',
      phase: 'planning',
      iteration: 0,
      maxIterations: parseInt(process.env.MAX_ITERATIONS || '12'),
      startTime: new Date().toISOString(),
      errors: [],
      metrics: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
      },
    };

    // Load goal from file or use fallback
    this.goal = this.loadGoal() || goalFallback || 'Build a complete MVP application';

    // Validate environment
    this.validateEnvironment();

    // Load or update session state
    this.sessionState = this.loadSessionState();
    this.setupGracefulShutdown();

    // Initialize Discord if configured
    if (process.env.DISCORD_BOT_TOKEN) {
      const categoryName = process.env.DISCORD_CATEGORY_NAME || slugifyCategoryName(this.goal);
      this.discord = new DiscordManager({ categoryName });
    }
  }

  private goal: string;

  private ensureProjectWorkspace() {
    try {
      if (!existsSync(this.projectDir)) {
        mkdirSync(this.projectDir, { recursive: true });
      }

      this.ensureTemplateFiles();

      const gitDir = join(this.projectDir, '.git');
      if (!existsSync(gitDir)) {
        const result = spawnSync('git', ['init'], { cwd: this.projectDir });
        if (result.status !== 0) {
          throw new Error(result.stderr?.toString() || 'git init failed');
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to prepare project workspace: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private ensureTemplateFiles() {
    const templateDir = process.env.CLAUDE_PROJECT_TEMPLATE_DIR || '/app/project-template';
    if (!existsSync(templateDir)) {
      return;
    }

    const templateMcpPath = join(templateDir, '.mcp.json');
    const templateReadmePath = join(templateDir, 'README.md');
    const templateGoalPath = join(templateDir, 'GOAL.md');
    const templateClaudePath = join(templateDir, 'CLAUDE.md');

    // Copy .mcp.json
    const targetMcpPath = join(this.projectDir, '.mcp.json');
    if (!existsSync(targetMcpPath)) {
      if (existsSync(templateMcpPath)) {
        copyFileSync(templateMcpPath, targetMcpPath);
      } else {
        const defaultMcpConfig = {
          mcpServers: {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', this.projectDir],
            },
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: {
                GITHUB_TOKEN: '${GITHUB_TOKEN}',
              },
            },
            postgres: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-postgres', '--url', '${PG_URL}'],
            },
            exa: {
              type: 'http',
              url: 'https://mcp.exa.ai/mcp',
              headers: {},
            },
            puppeteer: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-puppeteer'],
            },
          },
        } as const;
        writeFileSync(targetMcpPath, JSON.stringify(defaultMcpConfig, null, 2));
      }
    }

    // Copy README.md
    const targetReadmePath = join(this.projectDir, 'README.md');
    if (!existsSync(targetReadmePath)) {
      if (existsSync(templateReadmePath)) {
        copyFileSync(templateReadmePath, targetReadmePath);
      } else {
        writeFileSync(
          targetReadmePath,
          `# ${this.projectName}

This repository was initialized automatically by the Claude orchestrator.
`
        );
      }
    }

    // Copy GOAL.md
    const targetGoalPath = join(this.projectDir, 'GOAL.md');
    if (!existsSync(targetGoalPath) && existsSync(templateGoalPath)) {
      copyFileSync(templateGoalPath, targetGoalPath);
    }

    // Copy CLAUDE.md
    const targetClaudePath = join(this.projectDir, 'CLAUDE.md');
    if (!existsSync(targetClaudePath) && existsSync(templateClaudePath)) {
      copyFileSync(templateClaudePath, targetClaudePath);
    }
  }

  private validateEnvironment() {
    const required = ['ZAI_API_KEY'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (!this.goal || this.goal.trim().length === 0) {
      throw new Error(
        'Goal cannot be empty. Please create a GOAL.md file in the project directory or set GOAL environment variable.'
      );
    }
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        return;
      }
      this.isShuttingDown = true;

      this.logger.log({
        timestamp: new Date().toISOString(),
        level: 'info',
        phase: this.sessionState.phase,
        iteration: this.sessionState.iteration,
        message: `Received ${signal}, initiating graceful shutdown`,
        metadata: { activeOperations: this.resourceManager.getActiveOperations() },
      });

      await this.resourceManager.cleanup();
      this.saveSessionState();
      this.createCheckpoint('shutdown');
      this.logger.close();

      console.log(`\n✅ Graceful shutdown completed`);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.log({
        timestamp: new Date().toISOString(),
        level: 'error',
        phase: this.sessionState.phase,
        iteration: this.sessionState.iteration,
        message: `Unhandled rejection at ${promise}`,
        metadata: { reason },
      });
    });
    process.on('uncaughtException', error => {
      this.logger.log({
        timestamp: new Date().toISOString(),
        level: 'error',
        phase: this.sessionState.phase,
        iteration: this.sessionState.iteration,
        message: `Uncaught exception: ${error.message}`,
        metadata: { stack: error.stack },
      });
      shutdown('uncaughtException');
    });
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, metadata?: unknown) {
    this.logger.log({
      timestamp: new Date().toISOString(),
      level,
      phase: this.sessionState.phase,
      iteration: this.sessionState.iteration,
      message,
      metadata,
    });
  }

  private loadGoal(): string {
    const goalFile = join(this.projectDir, 'GOAL.md');

    if (existsSync(goalFile)) {
      try {
        const goalContent = readFileSync(goalFile, 'utf-8');
        this.log('info', 'Loaded goal from GOAL.md');
        return goalContent.trim();
      } catch (error) {
        this.log('error', `Failed to read GOAL.md: ${error}`);
      }
    }

    // Fallback to environment variable or default
    const fallbackGoal = process.env.GOAL || 'Build a complete MVP application';
    this.log('warn', 'Using fallback goal from environment variable');
    return fallbackGoal;
  }

  private loadSessionState(): SessionState {
    const claudeDir = join(this.projectDir, '.claude');
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    const stateFile = join(claudeDir, 'session.json');

    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        this.log(
          'info',
          `Resuming session ${state.sessionId}, phase: ${state.phase}, iteration: ${state.iteration}`
        );
        return {
          ...state,
          goal: this.goal,
          errors: state.errors || [],
          metrics: state.metrics || {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
          },
        };
      } catch (error) {
        this.log('warn', `Could not load session state: ${error}`);
      }
    }

    const initialState: SessionState = {
      goal: this.goal,
      phase: 'planning',
      iteration: 0,
      maxIterations: parseInt(process.env.MAX_ITERATIONS || '12'),
      startTime: new Date().toISOString(),
      errors: [],
      metrics: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
      },
    };

    this.log('info', 'Starting fresh session');
    return initialState;
  }

  private saveSessionState() {
    try {
      const stateFile = join(this.projectDir, '.claude', 'session.json');
      writeFileSync(stateFile, JSON.stringify(this.sessionState, null, 2));
    } catch (error) {
      this.log('error', `Failed to save session state: ${error}`);
    }
  }

  private cleanupOldCheckpoints() {
    try {
      const claudeDir = join(this.projectDir, '.claude');
      const files = readdirSync(claudeDir)
        .filter((file: string) => file.startsWith('checkpoint_'))
        .map((file: string) => ({
          name: file,
          path: join(claudeDir, file),
          time: statSync(join(claudeDir, file)).mtime,
        }))
        .sort((a, b) => b.time.getTime() - a.time.getTime());

      // Keep only the latest 10 checkpoints
      if (files.length > 10) {
        files.slice(10).forEach(file => {
          try {
            unlinkSync(file.path);
            this.log('debug', `Deleted old checkpoint: ${file.name}`);
          } catch (error) {
            this.log('warn', `Failed to delete checkpoint ${file.name}: ${error}`);
          }
        });
      }
    } catch (error) {
      this.log('warn', `Failed to cleanup checkpoints: ${error}`);
    }
  }

  private createCheckpoint(status: string) {
    try {
      const checkpointFile = join(
        this.projectDir,
        '.claude',
        `checkpoint_${Date.now()}_${status}.json`
      );
      const checkpoint = {
        ...this.sessionState,
        timestamp: new Date().toISOString(),
        status,
        uptime: Date.now() - new Date(this.sessionState.startTime).getTime(),
      };

      writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
      this.cleanupOldCheckpoints();
      this.log('debug', `Created checkpoint: ${status}`);
    } catch (error) {
      this.log('error', `Failed to create checkpoint: ${error}`);
    }
  }

  private async runClaude(args: string[], input?: string): Promise<ClaudeTurn[]> {
    return new Promise((resolve, reject) => {
      // Set environment variables for Z.AI GLM (as per Z.AI script)
      const env = {
        ...process.env,
        ANTHROPIC_AUTH_TOKEN: process.env.ZAI_API_KEY || '',
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        API_TIMEOUT_MS: process.env.API_TIMEOUT_MS || '3000000',
        HOME: process.env.HOME || '/home/claude',
        CLAUDE_PROJECT_DIR: this.projectDir,
      };

      const claudeArgs = [
        '-p',
        '--verbose',
        '--dangerously-skip-permissions', // Skip all permission checks - safe in Docker
        '--output-format',
        'stream-json',
        '--mcp-config',
        join(this.projectDir, '.mcp.json'),
        ...args,
      ];

      this.log('info', `Running Claude with args: ${claudeArgs.join(' ')}`);
      this.log('info', `Sending prompt to Claude: ${input?.substring(0, 200)}...`);

      const p = spawn('claude', claudeArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.projectDir,
        env,
      });

      // Track the current process so it can be interrupted for feedback
      this.currentClaudeProcess = p;

      if (input) {
        p.stdin.write(input);
        p.stdin.end();
      }

      let stdout = '';
      let stderr = '';
      let lastLogTime = Date.now();

      p.stdout.on('data', data => {
        const chunk = data.toString();
        stdout += chunk;

        // Log streaming output with activity details
        const now = Date.now();
        if (now - lastLogTime > 2000 || chunk.length > 500) {
          this.log('info', `Claude streaming response (${stdout.length} bytes received)...`);
          // Try to parse and log recent JSON lines
          const lines = stdout.trim().split('\n');
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            try {
              const parsed = JSON.parse(lastLine);
              if (parsed.type === 'assistant' || parsed.type === 'tool_use') {
                this.log(
                  'info',
                  `Claude activity: ${parsed.type} - ${JSON.stringify(parsed).substring(0, 300)}`
                );
              }
            } catch (e) {
              // Not valid JSON yet, continue
            }
          }
          lastLogTime = now;
        }
      });

      p.stderr.on('data', data => {
        const chunk = data.toString();
        stderr += chunk;
        this.log('warn', `Claude stderr: ${chunk.substring(0, 500)}`);
      });

      const timeout = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new Error(`Claude process timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      p.on('close', code => {
        clearTimeout(timeout);
        this.currentClaudeProcess = undefined;

        // If interrupted for feedback, immediately restart the same phase with feedback
        if (this.shouldInterruptForFeedback) {
          this.shouldInterruptForFeedback = false;
          this.log(
            'info',
            'Process interrupted for feedback - restarting immediately with feedback'
          );

          // Restart the same operation with feedback included
          this.runClaude(args, input || '')
            .then(result => resolve(result))
            .catch(err => reject(err));
          return;
        }

        this.log(
          'info',
          `Claude process exited with code ${code}, received ${stdout.length} bytes`
        );

        if (code !== 0) {
          const errorMsg = stderr || stdout || 'No error output available';
          this.log('error', `Claude error output: ${errorMsg.substring(0, 1000)}`);

          // Check for rate limit error (600 messages per 5 hours)
          if (
            errorMsg.includes('rate limit') ||
            errorMsg.includes('Rate limit') ||
            errorMsg.includes('too many requests')
          ) {
            this.log(
              'warn',
              'Rate limit hit (600 messages per 5 hours). Will retry after waiting...'
            );
            reject(new Error(`RATE_LIMIT: ${errorMsg}`));
            return;
          }

          reject(new Error(`Claude exited with code ${code}: ${errorMsg}`));
          return;
        }

        try {
          const lines = stdout
            .trim()
            .split('\n')
            .filter(line => line.trim());
          if (lines.length === 0) {
            reject(new Error('Claude produced no output'));
            return;
          }

          const turns = lines.map(line => JSON.parse(line) as ClaudeTurn);

          // Log summary of what Claude did
          const toolUses = turns.filter(
            t => t.type === 'tool_use' || (t.content && Array.isArray(t.content))
          );
          const assistantMessages = turns.filter(t => t.type === 'assistant');

          this.log(
            'info',
            `Claude completed: ${turns.length} turns, ${assistantMessages.length} messages, ${toolUses.length} tool uses`
          );

          // Log assistant messages in detail
          assistantMessages.forEach((turn, idx) => {
            if (turn.result) {
              this.log('info', `Assistant message ${idx + 1}: ${turn.result.substring(0, 500)}`);
            }
          });

          resolve(turns);
        } catch (error) {
          this.log('error', `Failed to parse Claude output: ${error}`);
          this.log('debug', `Raw output sample: ${stdout.substring(0, 1000)}`);
          reject(
            new Error(
              `Failed to parse Claude output: ${error}. Output: ${stdout.substring(0, 500)}`
            )
          );
        }
      });
    });
  }

  private async executePhase<T>(
    phaseName: string,
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const operationId = `${phaseName}_${Date.now()}`;
    this.sessionState.metrics.totalOperations++;

    this.log('info', `Starting ${phaseName} phase`, { timeoutMs, operationId });

    try {
      const result = await this.resourceManager.executeOperation(
        operationId,
        operation,
        timeoutMs || this.timeoutMs
      );

      this.sessionState.metrics.successfulOperations++;
      this.log('info', `Completed ${phaseName} phase successfully`);
      return result;
    } catch (error) {
      this.sessionState.metrics.failedOperations++;
      this.sessionState.errors.push({
        timestamp: new Date().toISOString(),
        phase: this.sessionState.phase,
        error: error instanceof Error ? error.message : String(error),
        recovered: false,
      });

      this.log('error', `Failed ${phaseName} phase: ${error}`, {
        error: error instanceof Error ? error.stack : error,
      });
      throw error;
    }
  }

  async run() {
    this.log('info', `Starting autonomous Claude system`, {
      goalLength: this.goal.length,
      maxIterations: this.sessionState.maxIterations,
      timeoutMs: this.timeoutMs,
    });

    try {
      await this.setupDiscordIfEnabled();
      await this.executeAutonomousLoop();
    } catch (error) {
      this.log('error', `Autonomous run failed: ${error}`, {
        error: error instanceof Error ? error.stack : error,
      });
      this.createCheckpoint('error');
      throw error;
    } finally {
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
      }
      this.log('info', 'Orchestrator run completed', {
        finalMetrics: this.sessionState.metrics,
        totalErrors: this.sessionState.errors.length,
        uptime: Date.now() - new Date(this.sessionState.startTime).getTime(),
      });
    }
  }

  private async setupDiscordIfEnabled() {
    if (!this.discord) {
      return;
    }
    try {
      await this.discord.login();
      const { statusChannel, feedbackChannel } = await this.discord.ensureGuildAndChannels();
      this.statusChannelId = statusChannel.id;
      this.feedbackChannelId = feedbackChannel.id;

      // Feedback ingestion
      this.discord.onFeedbackMessage(
        async (content, authorTag, attachments) => {
          feedbackStore.enqueue({ authorTag, content, attachments });
          this.log('info', 'Received Discord feedback - interrupting current cycle', {
            authorTag,
            contentPreview: content.substring(0, 120),
            attachments: attachments.length,
          });

          // Send immediate acknowledgment back to feedback channel
          if (this.feedbackChannelId && this.discord) {
            const ack = [
              `✅ **Feedback received from ${authorTag}**`,
              ``,
              `📝 **Your message:**`,
              `> ${content.substring(0, 300)}${content.length > 300 ? '...' : ''}`,
              attachments.length > 0 ? `📎 **Attachments:** ${attachments.length}` : '',
              ``,
              `⚡ **Status:** Interrupting current cycle to process your feedback immediately...`,
              `⏱️ **Current phase:** ${this.sessionState.phase} (iteration ${this.sessionState.iteration}/${this.sessionState.maxIterations})`,
            ]
              .filter(Boolean)
              .join('\n');

            await this.discord.sendMessage(this.feedbackChannelId, ack).catch(err => {
              this.log('warn', `Failed to send feedback acknowledgment: ${err}`);
            });
          }

          // Interrupt the current Claude process to process feedback immediately
          this.shouldInterruptForFeedback = true;
          if (this.currentClaudeProcess) {
            this.log('info', 'Killing current Claude process to handle feedback immediately');
            this.currentClaudeProcess.kill('SIGTERM');
          }
        },
        { channelId: this.feedbackChannelId }
      );

      // Periodic status updates (default every 30 minutes)
      const minutes = parseInt(process.env.STATUS_UPDATE_INTERVAL_MINUTES || '30');
      const intervalMs = Math.max(1, minutes) * 60 * 1000;
      await this.sendStatusUpdate(); // initial message
      this.statusInterval = setInterval(() => {
        this.sendStatusUpdate().catch(err => {
          this.log('warn', `Failed to send status update: ${err}`);
        });
      }, intervalMs);
    } catch (error) {
      this.log('warn', `Discord setup skipped or failed: ${error}`);
    }
  }

  private async sendStatusUpdate() {
    if (!this.discord || !this.statusChannelId) {
      return;
    }
    try {
      const summary = this.buildStatusSummary();
      await this.discord.sendMessage(this.statusChannelId, summary);
    } catch (e) {
      this.log('warn', `Error during status update: ${e}`);
    }
  }

  private buildStatusSummary(): string {
    const uptimeMs = Date.now() - new Date(this.sessionState.startTime).getTime();
    const mins = Math.floor(uptimeMs / 60000);
    const secs = Math.floor((uptimeMs % 60000) / 1000);
    const metrics = this.sessionState.metrics;
    return [
      `Project: ${this.goal}`,
      `Phase: ${this.sessionState.phase}`,
      `Iteration: ${this.sessionState.iteration}/${this.sessionState.maxIterations}`,
      `Uptime: ${mins}m ${secs}s`,
      `Ops: total=${metrics.totalOperations}, ok=${metrics.successfulOperations}, fail=${metrics.failedOperations}`,
      feedbackStore.hasPending() ? `Pending feedback: ${feedbackStore.size()}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async executeAutonomousLoop() {
    while (this.sessionState.iteration < this.sessionState.maxIterations && !this.isShuttingDown) {
      this.log(
        'info',
        `Starting iteration ${this.sessionState.iteration + 1}/${this.sessionState.maxIterations}`,
        {
          phase: this.sessionState.phase,
          metricsSoFar: this.sessionState.metrics,
        }
      );

      try {
        switch (this.sessionState.phase) {
          case 'planning':
            await this.executePhase('planning', () => this.executePlanningPhase());
            break;
          case 'implementation':
            await this.executePhase(
              'implementation',
              () => this.executeImplementationPhase(),
              this.timeoutMs * 2
            );
            break;
          case 'testing':
            await this.executePhase(
              'testing',
              () => this.executeTestingPhase(),
              this.timeoutMs * 1.5
            );
            break;
          case 'critique':
            await this.executePhase('critique', () => this.executeCritiquePhase());
            break;
          case 'completion':
            await this.executePhase('completion', () => this.executeCompletionPhase());
            return;
          case 'error':
            this.log('error', 'System in error state, attempting recovery');
            if (!(await this.recoverFromError(new Error('System in error state')))) {
              throw new Error('Failed to recover from error state');
            }
            break;
        }

        this.sessionState.iteration++;
        this.saveSessionState();
        this.createCheckpoint('success');
      } catch (error) {
        this.log('error', `Error in ${this.sessionState.phase} phase: ${error}`);
        this.createCheckpoint('error');

        if (!(await this.recoverFromError(error))) {
          this.log('error', 'Recovery failed, aborting run');
          throw error;
        }
      }
    }

    if (this.sessionState.iteration >= this.sessionState.maxIterations) {
      this.log('info', 'Max iterations reached, finalizing...');
      this.sessionState.phase = 'completion';
      await this.executePhase('completion', () => this.executeCompletionPhase());
    }
  }

  private async executePlanningPhase() {
    this.log('info', 'Planning phase...');

    const prompt = `Read CLAUDE.md to understand the system context and goal.
Then create a detailed plan to achieve: ${this.sessionState.goal}

Break down the goal into specific, actionable tasks. Consider:
- What sub-agents should be involved (planner, researcher, implementer, tester, critic, security-auditor)
- What tools and MCP integrations are needed (Exa search for research, GitHub for code management, etc.)
- What testing and validation steps are required
- Potential risks and mitigation strategies

Output a structured plan with clear phases and dependencies.
Use the project-planner agent for this task.`;

    const args = this.sessionState.sessionId ? ['--resume', this.sessionState.sessionId] : [];

    const turns = await this.runClaude(args, promptWithFeedback(prompt));

    // Extract session ID if present
    const sessionTurn = turns.find(t => t.session_id);
    if (sessionTurn) {
      this.sessionState.sessionId = sessionTurn.session_id;
    }

    this.sessionState.phase = 'implementation';
    this.log('info', 'Planning completed', { sessionId: this.sessionState.sessionId });
  }

  private async executeImplementationPhase() {
    this.log('info', 'Implementation phase...');

    const prompt = `Based on the previous planning, implement the next set of tasks for: ${this.sessionState.goal}

Use appropriate sub-agents and tools. Focus on:
- Writing high-quality, testable code
- Following best practices and security guidelines
- Creating proper documentation
- Implementing validation and error handling
- Using Exa search for research when needed
- Using GitHub for version control operations

Work systematically through the planned tasks.
Use the implementer agent for development tasks and researcher agent for investigating solutions.`;

    const args = this.sessionState.sessionId ? ['--resume', this.sessionState.sessionId] : [];

    await this.runClaude(args, promptWithFeedback(prompt));

    this.sessionState.phase = 'testing';
    this.log('info', 'Implementation completed');
  }

  private async executeTestingPhase() {
    this.log('info', 'Testing phase...');

    const prompt = `Run comprehensive tests for the implemented work on: ${this.sessionState.goal}

Execute:
- Unit tests for individual components
- Integration tests for system interactions
- Security validations
- Performance benchmarks
- User acceptance testing

Report any failures with specific details and severity levels.
Use the qa-tester agent for this comprehensive testing.`;

    const args = this.sessionState.sessionId ? ['--resume', this.sessionState.sessionId] : [];

    const turns = await this.runClaude(args, promptWithFeedback(prompt));

    // Check if tests failed based on the response
    const response = turns
      .map(t => t.result)
      .join(' ')
      .toLowerCase();
    const hasFailures =
      response.includes('fail') || response.includes('error') || response.includes('critical');

    if (hasFailures) {
      this.log('warn', 'Tests failed, entering critique phase');
      this.sessionState.phase = 'critique';
    } else {
      this.log('info', 'All tests passed');
      this.sessionState.phase = 'completion';
    }
  }

  private async executeCritiquePhase() {
    this.log('info', 'Critique phase...');

    const prompt = `Critique the current implementation and test failures for: ${this.sessionState.goal}

Analyze:
- Root causes of test failures
- Code quality issues
- Security vulnerabilities
- Performance bottlenecks
- Architectural problems

Provide a prioritized list of issues with specific fixes needed.
Rate each issue by severity (Critical/High/Medium/Low).
Use the critic agent for this comprehensive review, and the security-auditor for security-specific issues.`;

    const args = this.sessionState.sessionId ? ['--resume', this.sessionState.sessionId] : [];

    await this.runClaude(args, promptWithFeedback(prompt));

    this.sessionState.phase = 'implementation';
    this.log('info', 'Critique completed, returning to implementation');
  }

  private async executeCompletionPhase() {
    this.log('info', 'Completion phase...');

    const prompt = `Finalize the work on: ${this.sessionState.goal}

Complete:
- Code refactoring and optimization
- Documentation updates
- Changelog generation
- Deployment preparation
- Final validation

Ensure everything is production-ready and well-documented.`;

    const args = this.sessionState.sessionId ? ['--resume', this.sessionState.sessionId] : [];

    await this.runClaude(args, promptWithFeedback(prompt));

    this.log('info', 'Autonomous run completed successfully!');
  }

  private async recoverFromError(error: unknown): Promise<boolean> {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check if this is a rate limit error (600 messages per 5 hours)
    if (
      errorMsg.includes('RATE_LIMIT') ||
      errorMsg.includes('rate limit') ||
      errorMsg.includes('too many requests')
    ) {
      this.log(
        'warn',
        '⏳ Rate limit hit (600 messages per 5 hours). Waiting 30 minutes before retrying...'
      );

      // Wait 30 minutes (rate limit resets after 5 hours, but we'll try sooner)
      const waitMinutes = 30;
      const waitMs = waitMinutes * 60 * 1000;

      this.log(
        'info',
        `Sleeping for ${waitMinutes} minutes until ${new Date(Date.now() + waitMs).toISOString()}`
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));

      this.log('info', 'Wait complete, resuming operations...');
      return true; // Return true to indicate we should retry
    }

    this.log('info', 'Attempting error recovery', {
      error: errorMsg,
    });

    let retries = 0;
    const maxRetries = this.maxRetries;

    while (retries < maxRetries) {
      try {
        const recoveryPrompt = `The system encountered an error: ${errorMsg}

Recovery attempt ${retries + 1}/${maxRetries}:
1. Analyze what went wrong
2. Implement fixes
3. Resume the workflow

Focus on getting back on track with: ${this.sessionState.goal}`;

        const args = this.sessionState.sessionId ? ['--resume', this.sessionState.sessionId] : [];

        await this.resourceManager.executeOperation(
          `recovery_${retries}`,
          () => this.runClaude(args, promptWithFeedback(recoveryPrompt)),
          this.timeoutMs / 2 // Shorter timeout for recovery
        );

        // Mark the error as recovered
        if (this.sessionState.errors.length > 0) {
          this.sessionState.errors[this.sessionState.errors.length - 1].recovered = true;
        }

        this.log('info', `Error recovery successful on attempt ${retries + 1}`);
        return true;
      } catch (recoveryError) {
        retries++;
        const recoveryErrorMsg =
          recoveryError instanceof Error ? recoveryError.message : String(recoveryError);

        // Check if recovery also hit rate limit
        if (recoveryErrorMsg.includes('RATE_LIMIT') || recoveryErrorMsg.includes('rate limit')) {
          this.log('warn', '⏳ Rate limit hit during recovery. Waiting 30 minutes...');
          await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
          continue; // Don't count this as a retry
        }

        this.log('warn', `Recovery attempt ${retries} failed`, {
          error: recoveryErrorMsg,
        });

        if (retries < maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
        }
      }
    }

    this.log('error', 'Error recovery failed after all attempts');
    return false;
  }
}

// Main execution
async function main() {
  try {
    const orchestrator = new Orchestrator();
    await orchestrator.run();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Handle top-level errors
main().catch(error => {
  console.error('💥 Fatal error in main:', error);
  process.exit(1);
});
