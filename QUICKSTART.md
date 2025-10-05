# 🚀 Quick Start Guide

Use this autonomous Claude system as a template for new projects.

## Setup New Project

### 1. Clone or Copy This Repository

```bash
# Option A: Clone from your repo
git clone <your-repo-url> my-new-project
cd my-new-project

# Option B: Copy the directory
cp -r docker_claude my-new-project
cd my-new-project
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your API keys
nano .env
```

Required:
- `ZAI_API_KEY` - Your Z.AI API key

Optional:
- `GITHUB_TOKEN` - For GitHub MCP integration
- `PG_URL` - For PostgreSQL MCP integration
- `DISCORD_BOT_TOKEN` - For Discord feedback/status updates

### 3. Set Your Goal

```bash
# Copy goal template
cp project/GOAL.md.template project/GOAL.md

# Edit with your project goal
nano project/GOAL.md
```

Be specific! Include:
- Vision and objectives
- Technical requirements
- Success criteria
- Any constraints or preferences

### 4. Start the System

```bash
# Build and start
docker compose up --build -d

# Monitor logs
docker compose logs -f orchestrator
```

### 5. Monitor Progress

```bash
# View logs
docker compose logs -f orchestrator

# Check session state
docker compose exec orchestrator cat /project/.claude/session.json

# View checkpoints
docker compose exec orchestrator ls -la /project/.claude/checkpoint_*.json
```

## System Phases

The orchestrator runs through these phases automatically:

1. **Planning** - Reads your goal and creates a detailed plan
2. **Implementation** - Executes the plan, writes code
3. **Testing** - Runs tests and validates implementation
4. **Critique** - Analyzes results and identifies improvements
5. **Repeat** - Continues until goal is achieved or max iterations reached

## Key Features

### Session Persistence
- System automatically saves state
- Survives container restarts
- Resume from where it left off

### Rate Limit Handling
- Detects Z.AI rate limits (120 messages per 5 hours)
- Automatically waits and retries
- No manual intervention needed

### Error Recovery
- Automatic recovery from timeouts and errors
- Up to 3 retry attempts per error
- Saves checkpoints for rollback

### Concurrency Control
- Limits parallel tool calls to prevent API errors
- Configurable via `CLAUDE_CODE_MAX_PARALLEL_TOOL_CALLS`

## Configuration

### Adjust Iterations

Edit `.env`:
```bash
MAX_ITERATIONS=20  # Default: 12
```

### Adjust Timeouts

Edit `.env`:
```bash
DEFAULT_TIMEOUT=900000  # 15 minutes (default: 10 minutes)
```

### Change Log Level

Edit `.env`:
```bash
LOG_LEVEL=info  # Options: debug, info, warn, error
```

### Modify MCP Integrations

Edit `project/.mcp.json` to add/remove MCP servers:
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Stopping the System

```bash
# Graceful shutdown
docker compose down

# Force stop
docker compose down --remove-orphans

# Stop and remove volumes (fresh start)
docker compose down -v
```

## Fresh Start

To start completely fresh:

```bash
# Stop containers
docker compose down

# Clear session data
rm -rf project/.claude/*.json
rm -rf project/.claude/*.log

# Remove Docker volume
docker volume rm docker_claude_claude_home

# Clear your project files (keep templates)
rm -rf project/idle-tycoon  # or whatever your project is

# Start fresh
docker compose up --build -d
```

## Troubleshooting

### Container Keeps Restarting

Check logs:
```bash
docker compose logs orchestrator --tail 50
```

Common issues:
- Invalid API key
- Missing environment variables
- Rate limit hit

### Claude Not Responding

1. Check if rate limit was hit (logs will show)
2. Verify API key is valid
3. Check timeout settings (may need to increase)

### Session Corrupted

Clear session and restart:
```bash
docker compose down
rm -rf project/.claude/*.json
docker compose up -d
```

## Advanced Usage

### Resume Specific Session

The system automatically resumes the last session. To start fresh:
```bash
rm project/.claude/session.json
```

### View Detailed Logs

```bash
# Inside container
docker compose exec orchestrator cat /project/.claude/orchestrator.log | tail -100

# Follow in real-time
docker compose exec orchestrator tail -f /project/.claude/orchestrator.log
```

### Inspect Checkpoints

```bash
docker compose exec orchestrator ls -la /project/.claude/checkpoint_*.json
docker compose exec orchestrator cat /project/.claude/checkpoint_<timestamp>_success.json
```

## Project Structure

```
my-new-project/
├── .env                      # Your API keys (not committed)
├── .env.example              # Template
├── .gitignore                # Excludes project-specific files
├── docker-compose.yml        # Main configuration
├── README.md                 # Full documentation
├── QUICKSTART.md            # This file
├── SESSION_PERSISTENCE.md   # Session management docs
├── apps/
│   └── orchestrator/        # Orchestrator service
│       ├── Dockerfile
│       ├── package.json
│       ├── src/
│       │   └── index.ts     # Main orchestrator logic
│       └── tsconfig.json
└── project/                 # Your workspace
    ├── .claude/             # Session data (auto-generated)
    ├── .mcp.json           # MCP server configuration
    ├── CLAUDE.md           # System context
    ├── GOAL.md             # Your project goal
    └── GOAL.md.template    # Template for new projects
```

## Next Steps

1. ✅ Set up environment (`.env`)
2. ✅ Define your goal (`project/GOAL.md`)
3. ✅ Start the system (`docker compose up -d`)
4. 📊 Monitor progress (`docker compose logs -f`)
5. 🎉 Let Claude build your project!

## Getting Help

- Check logs: `docker compose logs orchestrator`
- View session state: `cat project/.claude/session.json`
- Read full docs: `README.md`
- Session persistence: `SESSION_PERSISTENCE.md`

---

**Happy building!** 🚀 Your autonomous Claude system is ready to work on any project you define.
