# 📦 Autonomous Claude System - Template Repository

This repository is now a **reusable template** for starting new autonomous Claude projects.

## ✅ What's Committed (Template Files)

### Core System
- ✅ `apps/orchestrator/` - Complete orchestrator service
  - Dockerfile
  - package.json & package-lock.json
  - src/index.ts (850 lines of orchestration logic)
  - tsconfig.json
- ✅ `docker-compose.yml` - Production configuration
- ✅ `docker-compose.test.yml` - Test environment
- ✅ `.gitignore` - Excludes project-specific files
- ✅ `.env.example` - Environment variable template

### Documentation
- ✅ `README.md` - Full system documentation
- ✅ `QUICKSTART.md` - Quick setup guide
- ✅ `SESSION_PERSISTENCE.md` - Session management docs

### Project Templates
- ✅ `project/CLAUDE.md` - System context for Claude
- ✅ `project/.mcp.json` - MCP server configuration
- ✅ `project/GOAL.md.template` - Goal template
- ✅ `project/.claude/.gitkeep` - Ensures directory exists

## ❌ What's Excluded (Project-Specific)

These files are in `.gitignore` and won't be committed:

### Your Work
- ❌ `project/idle-tycoon/` - Your actual project implementation
- ❌ `project/models/` - Project-specific models
- ❌ `project/research/` - Research files
- ❌ `project/docs/` - Project documentation
- ❌ `project/GOAL.md` - Your actual goal (use template instead)

### Generated Files
- ❌ `project/.claude/*.json` - Session state (regenerated)
- ❌ `project/.claude/*.log` - Logs (regenerated)
- ❌ `.env` - Your API keys (sensitive)
- ❌ `node_modules/` - Dependencies (reinstalled)
- ❌ `.DS_Store` - OS files

### Temporary Files
- ❌ `*.sh` scripts (except core ones)
- ❌ Draft documentation
- ❌ Build outputs

## 🚀 Using This Template

### For a New Project:

```bash
# 1. Clone the template
git clone <your-repo-url> my-new-project
cd my-new-project

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Set your goal
cp project/GOAL.md.template project/GOAL.md
# Edit project/GOAL.md with your project goal

# 4. Start building
docker compose up --build -d

# 5. Monitor
docker compose logs -f orchestrator
```

### For Continuing This Project:

Your Idle Tycoon project files are still in the working directory, just not committed to the template. To continue working on it:

```bash
# Your files are still here
ls project/idle-tycoon/
ls project/models/

# Just start the system
docker compose up -d
```

## 📊 Repository Stats

**Committed:**
- 16 files
- 2,384 lines of code
- 2 commits

**Features:**
- ✅ Autonomous planning, implementation, testing, critique
- ✅ Session persistence & resume
- ✅ Rate limit handling (120 msg/5hr)
- ✅ Error recovery (3 retries)
- ✅ MCP integrations (GitHub, Filesystem, Puppeteer, Exa)
- ✅ Configurable concurrency & timeouts
- ✅ Comprehensive logging

## 🔄 Workflow

### Starting a New Project
1. Clone template → 2. Configure `.env` → 3. Set `GOAL.md` → 4. Run → 5. Monitor

### Updating the Template
```bash
# Make improvements to the orchestrator
vim apps/orchestrator/src/index.ts

# Commit template changes
git add apps/orchestrator/
git commit -m "Improve error handling"

# Your project files stay local (not committed)
```

## 📝 Key Files to Edit

When starting a new project, you only need to edit:

1. **`.env`** - Your API keys
2. **`project/GOAL.md`** - Your project goal
3. **`project/.mcp.json`** (optional) - Add/remove MCP servers

Everything else works out of the box!

## 🎯 Next Steps

1. **Share the template**: Push to GitHub for reuse
2. **Start new projects**: Clone and customize
3. **Improve the system**: Commit enhancements back to template
4. **Keep projects separate**: Each project clones fresh

## 📚 Documentation

- **Setup**: `QUICKSTART.md`
- **Full docs**: `README.md`
- **Sessions**: `SESSION_PERSISTENCE.md`
- **This file**: Template overview

---

**Your autonomous Claude system is now a reusable template!** 🎉

Clone it for every new project and let Claude build whatever you need.
