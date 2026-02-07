#!/bin/bash
# install-global-agents.sh
# Installs Firebase agents globally for Claude Code

set -e

echo "🔥 Installing Firebase Claude Code Agents Globally..."
echo ""

# Create global directories
mkdir -p ~/.claude/agents
mkdir -p ~/.claude/commands

# Check if we're running from the extracted zip or need to find agents
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -d "$SCRIPT_DIR/.claude/agents" ]; then
    AGENTS_SOURCE="$SCRIPT_DIR/.claude/agents"
elif [ -d "./.claude/agents" ]; then
    AGENTS_SOURCE="./.claude/agents"
else
    echo "❌ Error: Cannot find agents directory."
    echo "   Run this script from the extracted firebase-claude-code-setup folder."
    exit 1
fi

# Copy agents
echo "📦 Installing agents to ~/.claude/agents/..."
cp -v "$AGENTS_SOURCE"/*.md ~/.claude/agents/

# Copy commands (optional)
if [ -d "$SCRIPT_DIR/.claude/commands" ]; then
    COMMANDS_SOURCE="$SCRIPT_DIR/.claude/commands"
elif [ -d "./.claude/commands" ]; then
    COMMANDS_SOURCE="./.claude/commands"
fi

if [ -n "$COMMANDS_SOURCE" ]; then
    echo ""
    echo "📦 Installing commands to ~/.claude/commands/..."
    cp -v "$COMMANDS_SOURCE"/*.md ~/.claude/commands/
fi

# Create or append to global CLAUDE.md
echo ""
echo "📝 Setting up global CLAUDE.md..."

GLOBAL_CLAUDE_MD=~/.claude/CLAUDE.md

# Check if file exists and has Firebase section already
if [ -f "$GLOBAL_CLAUDE_MD" ] && grep -q "Firebase Agents" "$GLOBAL_CLAUDE_MD"; then
    echo "   Global CLAUDE.md already has Firebase agents section. Skipping."
else
    cat >> "$GLOBAL_CLAUDE_MD" << 'CLAUDEMD'

## Firebase Agents

The following specialized agents are available globally for Firebase development:

### 1. architect
**Use when:** Reviewing plans, code structure, database designs, ensuring architectural consistency
**Invoke:** "Use architect to review this feature plan"

### 2. functions-specialist  
**Use when:** Creating Cloud Functions (HTTP, callable, triggers, scheduled)
**Invoke:** "Use functions-specialist to create an API endpoint"

### 3. firestore-specialist
**Use when:** Designing data models, writing queries, optimizing database performance
**Invoke:** "Use firestore-specialist to design the schema"

### 4. security-rules-specialist
**Use when:** Writing Firestore/Storage security rules, testing rules
**Invoke:** "Use security-rules-specialist to write rules for this collection"

### 5. gdpr-data-protection
**Use when:** User data export, deletion, consent management, privacy compliance
**Invoke:** "Use gdpr-data-protection to implement data export"

### 6. security-dos-protection
**Use when:** Rate limiting, brute force protection, security hardening
**Invoke:** "Use security-dos-protection to add rate limiting"

### 7. qa-e2e-testing
**Use when:** After building features, creating E2E tests, smoke tests
**Invoke:** "Use qa-e2e-testing to create tests for this feature"

### 8. behavioral-science-nudge
**Use when:** Reviewing features for engagement, habit formation, conversion optimization
**Invoke:** "Use behavioral-science-nudge to review this onboarding flow"

### 9. design-ui-ux
**Use when:** Designing screens, reviewing layouts, creating design systems, accessibility
**Invoke:** "Use design-ui-ux to review this screen layout"

### 10. code-review
**Use when:** Reviewing PRs, auditing code quality, finding bugs and security issues
**Invoke:** "Use code-review to review this pull request"

### 11. devops-cicd
**Use when:** Setting up CI/CD, deployments, environments, feature flags
**Invoke:** "Use devops-cicd to set up GitHub Actions for this project"

### 12. performance
**Use when:** Optimizing Core Web Vitals, bundle size, caching, load times
**Invoke:** "Use performance to audit and optimize our app"

### 13. observability
**Use when:** Setting up logging, error tracking, monitoring, alerting
**Invoke:** "Use observability to set up logging and error tracking"

CLAUDEMD
    echo "   Added Firebase agents section to $GLOBAL_CLAUDE_MD"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Installed agents:"
ls -1 ~/.claude/agents/*.md 2>/dev/null | xargs -I {} basename {} | sed 's/^/   • /'
echo ""
echo "Installed commands:"
ls -1 ~/.claude/commands/*.md 2>/dev/null | xargs -I {} basename {} | sed 's/^/   • /' || echo "   (none)"
echo ""
echo "🎉 Your agents are now available in ALL projects!"
echo "   Just run 'claude' in any directory to use them."
echo ""
echo "Example usage:"
echo "   claude> Use architect to review our data model"
echo "   claude> Use qa-e2e-testing to create tests for login"
