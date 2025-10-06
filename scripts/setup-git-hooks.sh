#!/bin/bash

# Setup script to install git hooks for code quality

set -e

echo "🔧 Setting up git hooks for code quality..."

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Not in a git repository. Please run this from the project root."
    exit 1
fi

# Create git hooks directory if it doesn't exist
mkdir -p .git/hooks

# Copy pre-commit hook
if [ -f "scripts/pre-commit-hook.sh" ]; then
    cp scripts/pre-commit-hook.sh .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✅ Pre-commit hook installed successfully!"
else
    echo "❌ Pre-commit hook script not found at scripts/pre-commit-hook.sh"
    exit 1
fi

echo "🎉 Git hooks setup complete!"
echo ""
echo "Now every commit will automatically:"
echo "  • Run ESLint to check code quality"
echo "  • Check code formatting with Prettier"
echo "  • Verify TypeScript compilation"
echo ""
echo "To bypass hooks (not recommended): git commit --no-verify"