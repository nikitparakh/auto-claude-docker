FROM node:20-bullseye

# OS deps commonly needed by hooks/tests/browsers
RUN apt-get update && apt-get install -y git python3 python3-pip jq ripgrep curl sudo \
  && rm -rf /var/lib/apt/lists/*

# Create a non-root user for Claude Code (required for --dangerously-skip-permissions)
RUN useradd -m -s /bin/bash -u 1001 claude \
  && echo "claude ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Install Z.AI Claude Code as root
RUN curl -L -o claude_code_prod_zai.sh "http://bigmodel-us3-prod-marketplace.cn-wlcb.ufileos.com/1753683755292-30b3431f487b4cc1863e57a81d78e289.sh?ufileattname=claude_code_prod_zai.sh" \
  && chmod +x claude_code_prod_zai.sh \
  && yes "" | ./claude_code_prod_zai.sh || true

# Set up application directory
WORKDIR /app
COPY apps/orchestrator/package*.json ./
RUN npm ci
COPY apps/orchestrator/ ./
RUN npm run build

# Create .claude directory for session state and set permissions
RUN mkdir -p /project/.claude \
  && chown -R claude:claude /project \
  && chown -R claude:claude /app

# Switch to non-root user
USER claude

# Configure Claude Code for Z.AI GLM with auto-approve all tools
# The ZAI_API_KEY will be passed as ANTHROPIC_AUTH_TOKEN at runtime
RUN mkdir -p ~/.claude \
  && echo '{"hasCompletedOnboarding": true, "autoApprove": true}' > ~/.claude.json \
  && echo '{}' > ~/.claude/settings.json

# Default to a long-lived loop that resumes last session if present
CMD ["node", "dist/index.js"]