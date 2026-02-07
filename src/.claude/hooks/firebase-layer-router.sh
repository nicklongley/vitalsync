#!/usr/bin/env bash
set -euo pipefail

# Firebase Layer Router
# Routes code changes to appropriate specialist based on file type

# Get the modified file path from Claude's tool input
file_path=$(echo "$CLAUDE_TOOL_INPUT" 2>/dev/null | jq -r '.file_path // .path // ""' 2>/dev/null || echo "")

# Exit silently if no file path
if [[ -z "$file_path" ]]; then
    exit 0
fi

# Create queue directory if it doesn't exist
mkdir -p .claude

# Route to appropriate specialist based on Firebase project structure
if [[ "$file_path" =~ functions/.*\.(ts|js)$ ]]; then
    echo "⚡ Cloud Function modified"
    echo "NEXT_ACTION=functions-specialist" >> .claude/test-queue
    echo "LAYER=Functions" >> .claude/test-queue
    
elif [[ "$file_path" =~ firestore\.rules$ ]]; then
    echo "🔒 Firestore security rules modified"
    echo "NEXT_ACTION=security-rules-specialist" >> .claude/test-queue
    echo "LAYER=Security" >> .claude/test-queue
    echo "⚠️  Remember to test rules before deploying!"
    
elif [[ "$file_path" =~ storage\.rules$ ]]; then
    echo "🔒 Storage security rules modified"
    echo "NEXT_ACTION=security-rules-specialist" >> .claude/test-queue
    echo "LAYER=Security" >> .claude/test-queue
    echo "⚠️  Remember to test rules before deploying!"
    
elif [[ "$file_path" =~ firestore\.indexes\.json$ ]]; then
    echo "📇 Firestore indexes modified"
    echo "NEXT_ACTION=firestore-specialist" >> .claude/test-queue
    echo "LAYER=Database" >> .claude/test-queue
    
elif [[ "$file_path" =~ (models?|types?|interfaces?)/.*\.(ts|js)$ ]]; then
    echo "📦 Data model modified"
    echo "NEXT_ACTION=firestore-specialist" >> .claude/test-queue
    echo "LAYER=Models" >> .claude/test-queue
    
elif [[ "$file_path" =~ (hosting|public)/.*\.(ts|tsx|js|jsx)$ ]]; then
    echo "🌐 Frontend code modified"
    echo "LAYER=Frontend" >> .claude/test-queue
    
elif [[ "$file_path" =~ tests?/.*\.(ts|js)$ ]]; then
    echo "✅ Test file modified"
    echo "NEXT_ACTION=run-tests" >> .claude/test-queue
    echo "LAYER=Tests" >> .claude/test-queue
fi

exit 0
