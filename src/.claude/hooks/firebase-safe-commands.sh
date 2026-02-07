#!/usr/bin/env bash
set -euo pipefail

# Firebase Safe Commands Validator
# Warns or blocks potentially dangerous Firebase commands

# Get the command from Claude's tool input
command=$(echo "$CLAUDE_TOOL_INPUT" 2>/dev/null | jq -r '.command // ""' 2>/dev/null || echo "")

# Exit silently if no command
if [[ -z "$command" ]]; then
    exit 0
fi

# Block dangerous commands
dangerous_patterns=(
    "firebase deploy --only firestore:rules --force"
    "firebase firestore:delete --all-collections"
    "rm -rf node_modules"
    "rm -rf functions/node_modules"
)

for pattern in "${dangerous_patterns[@]}"; do
    if [[ "$command" == *"$pattern"* ]]; then
        echo "🚫 BLOCKED: Potentially dangerous command" >&2
        echo "   Command: $command" >&2
        echo "   Please run this manually if needed." >&2
        exit 2
    fi
done

# Warn about production deployments
if [[ "$command" == *"firebase deploy"* ]]; then
    # Check if deploying to production (not emulator)
    if [[ "$command" != *"--project"*"staging"* ]] && [[ "$command" != *"--project"*"dev"* ]]; then
        echo "⚠️  WARNING: Deploying to default project (might be production)" >&2
        echo "   Consider using: firebase deploy --project <staging-project>" >&2
        # Not blocking, just warning
    fi
    
    # Warn about rules deployment
    if [[ "$command" == *"firestore:rules"* ]] || [[ "$command" == *"--only rules"* ]]; then
        echo "⚠️  WARNING: Deploying security rules" >&2
        echo "   Make sure you've tested the rules first!" >&2
    fi
fi

# Warn about deleting Firestore data
if [[ "$command" == *"firebase firestore:delete"* ]]; then
    echo "⚠️  WARNING: Deleting Firestore data" >&2
    echo "   This action cannot be undone!" >&2
fi

# Warn about accessing .env files
if [[ "$command" == *"cat"*".env"* ]] || [[ "$command" == *"less"*".env"* ]]; then
    echo "⚠️  WARNING: Accessing environment file with secrets" >&2
fi

# Check for service account key access
if [[ "$command" == *"serviceAccount"* ]] || [[ "$command" == *"service-account"* ]]; then
    echo "⚠️  WARNING: Accessing service account credentials" >&2
    echo "   Never commit these to version control!" >&2
fi

exit 0
