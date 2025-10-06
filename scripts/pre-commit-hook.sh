#!/bin/bash

# Pre-commit hook for code quality checks
# This script runs linting and formatting checks before allowing commits

set -e

echo "🔍 Running pre-commit quality checks..."

# Change to orchestrator directory
cd apps/orchestrator

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found in apps/orchestrator/"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm ci
fi

# Run linting
echo "🔧 Running ESLint..."
if ! npm run lint; then
    echo "❌ ESLint failed. Please fix the issues or run 'npm run lint:fix' to auto-fix."
    exit 1
fi

# Run formatting check
echo "💅 Checking code formatting..."
if ! npm run format:check; then
    echo "❌ Code formatting issues found. Please run 'npm run format' to fix."
    exit 1
fi

# Run TypeScript compilation check
echo "🔨 Checking TypeScript compilation..."
if ! npm run build; then
    echo "❌ TypeScript compilation failed. Please fix the errors."
    exit 1
fi

echo "✅ All quality checks passed!"
echo "🚀 Commit is ready to proceed."