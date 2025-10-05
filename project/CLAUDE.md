# Autonomous Claude System

## System Overview
This is an autonomous Claude system that runs headlessly in Docker, coordinating multiple sub-agents to achieve complex goals through iterative planning, implementation, testing, and self-critique loops.

## Core Architecture
- **Orchestrator**: Headless Node.js service that drives Claude CLI
- **Sub-agents**: Specialized agents for different tasks (planner, researcher, implementer, tester, critic)
- **Hooks**: Quality gates and automated validation
- **MCP Tools**: External integrations (GitHub, databases, browser automation)
- **Checkpoints**: Safe rollback system for long-running autonomous sessions

## Operating Principles
1. **Autonomous Operation**: System can run for extended periods without human intervention
2. **Self-Correction**: Built-in critique loops ensure quality and error correction
3. **Parallel Execution**: Sub-agents can work on different aspects simultaneously
4. **Safety First**: Strict permissions, hooks for validation, and checkpoint rollbacks
5. **Transparency**: All actions are logged and observable

## Current Goal
The system will work on achieving the specified goal through systematic decomposition and iterative improvement.

## Safety Guidelines
- All file operations are restricted to the project directory
- External network access is controlled through MCP permissions
- Dangerous commands are blocked by hooks
- Session state is preserved for recovery and analysis