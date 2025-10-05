# Session Persistence - "Pick Up Where You Left Off"

## Overview

This system has **two layers of session persistence** that work together to enable resuming work after crashes or restarts:

### 1. **Claude Code Native Sessions** (Lower Level)
- **Location**: `/home/claude/.claude/` (mounted from Docker volume `claude_home`)
- **Contains**: 
  - Authentication tokens
  - Conversation history
  - Shell snapshots
  - Todo lists
- **Persistence**: Survives container restarts via Docker volume
- **How it works**: Claude Code CLI natively manages sessions with `--resume <session_id>`

### 2. **Orchestrator State** (Higher Level)
- **Location**: `./project/.claude/session.json`
- **Contains**:
  - Current phase (planning/implementation/testing/critique)
  - Iteration count
  - Session ID reference to Claude Code session
  - Metrics and error history
- **Persistence**: Stored in mounted project directory
- **How it works**: TypeScript orchestrator saves/loads state between runs

## How Resume Works

### Automatic Resume (Default Behavior)

**When the container restarts**, the orchestrator automatically:

1. Checks for `./project/.claude/session.json`
2. If found, loads:
   - `sessionState.sessionId` - Claude Code session to resume
   - `sessionState.phase` - Where you left off (e.g., "implementation")
   - `sessionState.iteration` - Current iteration number
3. Passes `--resume <session_id>` to Claude Code CLI
4. Continues from where it left off!

**Example Log Output:**
```
🟢 [INFO] Resuming session sess_abc123, phase: implementation, iteration: 3
```

### Fresh Start (When Needed)

If `session.json` doesn't exist:
```
🟢 [INFO] Starting fresh session
```

The system creates a new session and begins from iteration 0.

## Commands

### Resume After Crash/Stop
```bash
# Just restart the container - it will auto-resume
docker compose up -d
docker compose logs orchestrator --follow
```

### Force Fresh Start
```bash
# Remove session state
docker compose down
rm -f project/.claude/session.json
rm -f project/.claude/checkpoint_*.json
docker compose up -d
```

### View Current Session State
```bash
cat project/.claude/session.json
```

### View Session Checkpoints
```bash
ls -la project/.claude/checkpoint_*.json
```

## Architecture Inspiration

This implementation combines:
- **[claude-docker](https://github.com/VishalJ99/claude-docker)**: Volume-based persistence strategy
- **Custom orchestrator**: Multi-phase workflow with checkpoints

## Key Differences vs claude-docker

| Feature | Our System | claude-docker |
|---------|------------|---------------|
| **Session Management** | Two-layer (orchestrator + Claude Code) | Single-layer (Claude Code native) |
| **Workflow** | Phased (planning→implementation→testing→critique) | Single conversation continuation |
| **Checkpoints** | Automatic at phase transitions | Not applicable |
| **State Tracking** | Custom metrics, errors, iteration counts | Native Claude Code only |
| **Volume Mount** | `/home/claude/.claude` (non-root user) | `~/.claude-docker/claude-home/` |

## Volume Configuration

```yaml
# docker-compose.yml
volumes:
  - ./project:/project                    # Project files (includes session.json)
  - claude_home:/home/claude/.claude      # Claude Code persistent data
```

**Important**: The volume mount path must match your container's user home directory:
- Root user: `/root/.claude`
- Non-root user (ours): `/home/claude/.claude`

## Troubleshooting

### Session Not Resuming

**Check 1**: Does session.json exist?
```bash
docker compose exec orchestrator cat /project/.claude/session.json
```

**Check 2**: Is the session ID valid?
```bash
docker compose exec orchestrator ls -la /home/claude/.claude/
# Should show session-related files
```

**Check 3**: Check orchestrator logs
```bash
docker compose logs orchestrator | grep -i "resuming\|session"
```

### Corrupted Session

If sessions are corrupted or stuck:
```bash
# Clear ONLY orchestrator state (keeps Claude Code auth)
rm -f project/.claude/session.json project/.claude/checkpoint_*.json

# OR clear everything including Claude Code state
docker compose down -v  # -v removes volumes
docker compose up -d
```

## Session Lifecycle

```
Start Container
     ↓
Check for session.json
     ↓
┌────────────────┬──────────────────┐
│ Found?         │  Not Found?      │
│ Load state     │  Create new      │
│ Resume session │  Fresh start     │
└────────────────┴──────────────────┘
     ↓
Execute phase (planning/implementation/testing)
     ↓
Save session.json after each phase
     ↓
Create checkpoint on success/error
     ↓
Continue or complete
```

## Code References

- **Session Loading**: `apps/orchestrator/src/index.ts:272-315` (loadSessionState)
- **Session Saving**: `apps/orchestrator/src/index.ts:317-324` (saveSessionState)
- **Resume Args**: `apps/orchestrator/src/index.ts:620-622` (--resume flag)
- **Checkpoint Creation**: `apps/orchestrator/src/index.ts:354-369` (createCheckpoint)

