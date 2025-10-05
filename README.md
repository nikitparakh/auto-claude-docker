# Autonomous Claude System

A Docker-first autonomous Claude system that coordinates multiple sub-agents with hooks, MCP tools, self-critique loops, and persistent overnight runs.

## 🏗️ Architecture

- **Orchestrator**: Headless Node.js service using Claude Agent SDK
- **Sub-agents**: Specialized agents (planner, researcher, implementer, tester, critic, security-auditor)
- **Hooks**: Quality gates and automated validation
- **MCP Tools**: External integrations (GitHub, Postgres, Exa Search, Puppeteer)
- **Checkpoints**: Safe rollback system for long-running sessions

## 🚀 Quick Start

### Prerequisites

1. Docker and Docker Compose
2. Z.AI API key (pre-configured)

### Setup

1. **Clone and configure**:
   ```bash
   git clone <this-repo>
   cd autonomous-claude
   cp .env.example .env
   # Edit .env with your goal and optional API keys
   ```

2. **Build and start**:
   ```bash
   docker compose up --build -d
   ```

3. **Set your goal**:
   ```bash
   # Edit project/GOAL.md with your detailed goal
   # The file can handle large, complex prompts
   nano project/GOAL.md
   ```

4. **Start the autonomous system**:
   ```bash
   docker compose up orchestrator
   ```

5. **Monitor progress**:
   ```bash
   docker compose logs -f orchestrator
   ```

## 📁 Project Structure

```
autonomous-claude/
├── apps/
│   └── orchestrator/           # Node.js orchestrator service
│       ├── src/index.ts       # Main orchestrator logic
│       ├── package.json
│       └── Dockerfile
├── project/                   # Your working project
│   ├── .claude/
│   │   ├── agents/           # Sub-agent configurations
│   │   ├── hooks/            # Quality gate scripts
│   │   ├── settings.json     # Project permissions
│   │   └── .mcp.json        # MCP tool integrations
│   ├── GOAL.md              # 📝 Your detailed goal (large prompts here!)
│   └── CLAUDE.md            # System context and guidelines
├── docker-compose.yml
├── .env.example
└── README.md
```

## 🤖 Sub-agents

- **project-planner**: Strategic planning and task decomposition
- **researcher**: Information gathering and analysis using Exa search
- **implementer**: Code implementation and development
- **qa-tester**: Comprehensive testing and validation
- **security-auditor**: Security analysis and vulnerability assessment
- **critic**: Quality assessment and constructive feedback

## 🔧 MCP Integrations

- **Filesystem**: Project file operations
- **GitHub**: Repository management and operations
- **Postgres**: Database interactions
- **Exa Search**: Real-time web search and research
- **Puppeteer**: Browser automation and testing

## 🪝 Quality Gates

### Pre-Tool Use Hook
- Blocks dangerous commands (rm -rf, curl to external sites, etc.)
- Warns on sensitive file access
- Validates network access patterns

### Post-Tool Use Hook
- Runs automated tests (Node.js, Python, Rust, Go)
- Executes linting and security scans
- Validates code quality

### Session Summary Hook
- Generates comprehensive session reports
- Analyzes changes and metrics
- Provides recommendations for improvement

## 🔄 Autonomous Loop

The system follows this iterative process:

1. **Planning**: Decompose goals into actionable tasks
2. **Implementation**: Execute development tasks
3. **Testing**: Run comprehensive test suites
4. **Critique**: Analyze results and identify improvements
5. **Recovery**: Handle errors and resume work

Each phase includes automatic checkpoints for safe recovery.

## 📊 Monitoring

- **Session state**: Persisted in `.claude/session.json`
- **Checkpoints**: Automatic rollback points stored in `.claude/checkpoints_*.json`
- **Logs**: Real-time progress via Docker logs
- **Summaries**: End-of-session analytics and recommendations

## 🛡️ Safety Features

- **Strict permissions**: Allow-list of safe operations
- **Hook validation**: Multi-layer quality gates
- **Checkpoints**: Safe rollback capabilities
- **Timeouts**: Prevent infinite loops
- **Resource limits**: Controlled resource usage

## 🔧 Configuration

### Goal Configuration

**Primary Method: GOAL.md file**
- Edit `project/GOAL.md` with your detailed goal
- Supports large, complex prompts with full markdown formatting
- Can include requirements, technical details, constraints, success criteria
- Automatically loaded by the orchestrator

**Alternative: Environment Variable**
- `GOAL`: Optional fallback goal for simple use cases

### Environment Variables

- `ZAI_API_KEY`: Required - Your Z.AI API key (pre-configured)
- `GITHUB_TOKEN`: Optional - For GitHub integrations
- `PG_URL`: Optional - For database operations
- `ANTHROPIC_BASE_URL`: Z.AI API endpoint (pre-configured)
- `API_TIMEOUT_MS`: API timeout (pre-configured)

### Customization

- **Add agents**: Create `.claude/agents/your-agent.md`
- **Modify hooks**: Edit scripts in `.claude/hooks/`
- **Configure MCP**: Update `.claude/.mcp.json`
- **Adjust permissions**: Modify `.claude/settings.json`

## 🐛 Troubleshooting

### Common Issues

1. **API Key Errors**: Ensure `ANTHROPIC_API_KEY` is set correctly
2. **Permission Denied**: Check file permissions in `.claude/hooks/`
3. **MCP Server Issues**: Verify API keys for external services
4. **Docker Build Failures**: Check Node.js and npm installation

### Logs and Debugging

```bash
# View orchestrator logs
docker compose logs -f orchestrator

# Check session state
docker compose exec orchestrator cat /project/.claude/session.json

# View checkpoints
docker compose exec orchestrator ls -la /project/.claude/checkpoint_*.json
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test your changes thoroughly
4. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🔗 Related Resources

- [Claude Agent SDK Documentation](https://docs.claude.com/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Claude Code Templates](https://aitmpl.com/)