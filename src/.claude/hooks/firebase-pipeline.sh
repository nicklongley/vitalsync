#!/usr/bin/env bash
set -euo pipefail

# Firebase Pipeline Orchestrator
# Runs after subagents complete to suggest next actions

# Check if there's a queued action
if [[ -f .claude/test-queue ]]; then
    # Read the queued action
    if grep -q "NEXT_ACTION=" .claude/test-queue 2>/dev/null; then
        action=$(grep "NEXT_ACTION=" .claude/test-queue | tail -1 | cut -d'=' -f2)
        layer=$(grep "LAYER=" .claude/test-queue | tail -1 | cut -d'=' -f2 || echo "unknown")
        
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🔥 Firebase Pipeline"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📁 Layer: $layer"
        
        case "$action" in
            "functions-specialist")
                echo "🎯 Recommended: Use functions-specialist to review/test"
                echo "   Or run: cd functions && npm test"
                ;;
            "security-rules-specialist")
                echo "🎯 Recommended: Use security-rules-specialist to review"
                echo "   Or run: npm run test:rules"
                echo "   ⚠️  ALWAYS test rules before deploying!"
                ;;
            "firestore-specialist")
                echo "🎯 Recommended: Use firestore-specialist to review"
                ;;
            "run-tests")
                echo "🎯 Recommended: Run tests"
                echo "   cd functions && npm test"
                ;;
            *)
                echo "🎯 Suggested: Use the $action subagent"
                ;;
        esac
        
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
    fi
    
    # Clear the queue for next run
    > .claude/test-queue
fi

# Check for common Firebase issues
echo "🔍 Quick Firebase checks..."

# Check if emulators should be running
if [[ -f "firebase.json" ]]; then
    if ! pgrep -f "firebase.*emulators" > /dev/null 2>&1; then
        echo "💡 Tip: Start emulators with: firebase emulators:start"
    fi
fi

# Check for uncommitted security rules changes
if [[ -f "firestore.rules" ]]; then
    if git diff --name-only 2>/dev/null | grep -q "firestore.rules"; then
        echo "⚠️  Uncommitted changes to firestore.rules"
    fi
fi

if [[ -f "storage.rules" ]]; then
    if git diff --name-only 2>/dev/null | grep -q "storage.rules"; then
        echo "⚠️  Uncommitted changes to storage.rules"
    fi
fi

exit 0
