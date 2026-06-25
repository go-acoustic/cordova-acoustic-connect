#!/bin/bash
# PR creation helper for Acoustic Connect Cordova plugin JIRA ticket implementation
# Usage: ./create-pr.sh CA-XXXXXX "Brief description of changes"

TICKET=$1
DESCRIPTION=$2

if [ -z "$TICKET" ] || [ -z "$DESCRIPTION" ]; then
    echo "Usage: ./create-pr.sh CA-XXXXXX 'Brief description'"
    echo ""
    echo "Example:"
    echo "  ./create-pr.sh CA-131254 'Fix crash on empty push token'"
    echo ""
    exit 1
fi

# Validate ticket format
if ! [[ $TICKET =~ ^CA-[0-9]+$ ]]; then
    echo "❌ Error: Invalid ticket format. Expected CA-XXXXXX (e.g., CA-131254)"
    exit 1
fi

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $BRANCH"

# Verify branch follows feature/CA-XXXXXX or bugfix/CA-XXXXXX convention
if ! [[ $BRANCH == feature/$TICKET* ]] && ! [[ $BRANCH == bugfix/$TICKET* ]]; then
    echo "⚠️  Warning: Branch '$BRANCH' does not follow 'feature/$TICKET' or 'bugfix/$TICKET' convention"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "=== Pushing branch to remote ==="
git push -u origin "$BRANCH"

echo ""
echo "=== Creating Pull Request ==="

PR_BODY="## Summary
- [Add detailed changes here]

## JIRA
[$TICKET](https://acoustic-jiraconf.atlassian.net/browse/$TICKET)

## Test plan
- [ ] TypeScript type check passes (\`npx tsc --noEmit\`)
- [ ] ESLint passes (\`npx eslint src --ext .ts\`)
- [ ] Unit tests pass with no regressions (\`npm test\`)
- [ ] New TypeScript code follows project conventions (optional chaining, no \`!\` assertions)
- [ ] Unit tests written or updated (Jest, \`beforeEach\`/\`afterEach\` lifecycle)
- [ ] For bug fixes: failing test written before fix, passes after
- [ ] Demo app builds successfully (\`cordova build android\`)
- [ ] Manual smoke test on device or emulator
- [ ] CI checks passing (build, tests, SonarQube)

## Notes
[Add any API changes, plugin.xml updates, migration notes, or reviewer callouts]"

PR_TITLE="$TICKET: $DESCRIPTION"
gh pr create --base develop \
    --draft \
    --title "$PR_TITLE" \
    --body "$PR_BODY"

echo ""
echo "✅ Draft pull request created!"
echo ""
echo "Next steps:"
echo "1. Monitor CI — resolve any SonarQube critical/blocker issues"
echo "2. Mark PR ready for review when all checks pass"
echo "3. Add PR link to JIRA ticket $TICKET"
echo "4. Move JIRA ticket to 'In Review' status"