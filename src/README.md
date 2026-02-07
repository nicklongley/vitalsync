# Claude Code Firebase Setup

Complete configuration for using Claude Code with Firebase projects, including 7 specialized agents.

## Installation Options

### Option 1: Global Installation (Recommended)
Install agents globally so they're available in **ALL your projects**:

```bash
# Extract the zip
unzip firebase-claude-code-setup.zip -d firebase-setup
cd firebase-setup

# Run the global installer
chmod +x install-global-agents.sh
./install-global-agents.sh
```

This installs to:
- `~/.claude/agents/` - Your 7 specialized agents (available everywhere)
- `~/.claude/commands/` - Custom slash commands
- `~/.claude/CLAUDE.md` - Global instructions (appended)

Now run `claude` in **any directory** and your agents are ready!

### Option 2: Project-Specific Installation
Install only for a specific Firebase project:

```bash
# From your Firebase project root
unzip firebase-claude-code-setup.zip
cp -r firebase-setup/.claude .
cp firebase-setup/CLAUDE.md .
chmod +x .claude/hooks/*.sh
rm -rf firebase-setup
```

## What's Included

### Subagents (`.claude/agents/` or `~/.claude/agents/`)

| Agent | Size | Purpose |
|-------|------|---------|
| `design-ui-ux.md` | 46 KB | **Mobile, web, interfaces, accessibility, password reset UX** |
| `security-dos-protection.md` | 35 KB | **Rate limiting, security hardening, password reset security** |
| `architect.md` | 33 KB | Architecture review, data design for insights |
| `observability.md` | 31 KB | Logging, monitoring, error tracking, alerting |
| `performance.md` | 26 KB | Core Web Vitals, caching, bundle optimization |
| `behavioral-science-nudge.md` | 28 KB | Behavioral science, nudges, habit formation |
| `code-review.md` | 27 KB | Code quality, bugs, security, performance |
| `devops-cicd.md` | 24 KB | CI/CD, deployments, environments, feature flags |
| `qa-e2e-testing.md` | 24 KB | End-to-end testing with Playwright |
| `gdpr-data-protection.md` | 9 KB | GDPR compliance, data rights |
| `firestore-specialist.md` | 4 KB | Data modeling & queries |
| `security-rules-specialist.md` | 4 KB | Firestore & Storage rules |
| `functions-specialist.md` | 3 KB | Cloud Functions development |

### Hooks (`.claude/hooks/`)

| Script | Purpose |
|--------|---------|
| `firebase-layer-router.sh` | Routes changes to specialists |
| `firebase-pipeline.sh` | Orchestrates testing pipeline |
| `firebase-safe-commands.sh` | Blocks dangerous commands |

### Custom Commands (`.claude/commands/`)

| Command | Usage |
|---------|-------|
| `/project:deploy [target]` | Safe deployment with checks |
| `/project:function [desc]` | Create new Cloud Function |
| `/project:rules [action]` | Manage security rules |

## Using the Agents

### Architect (Use first for new features!)
```
Use architect to review this feature plan
Use architect to design a data model that enables cohort analysis
Use architect to identify architectural issues in our codebase
```

### Functions Specialist
```
Use functions-specialist to create an HTTP endpoint for payments
Use functions-specialist to add a Firestore trigger for orders
```

### Firestore Specialist
```
Use firestore-specialist to design the schema for user profiles
Use firestore-specialist to optimize queries for the orders collection
```

### Security Rules Specialist
```
Use security-rules-specialist to write rules for the messages collection
Use security-rules-specialist to review our rules for vulnerabilities
```

### GDPR Data Protection
```
Use gdpr-data-protection to implement user data export
Use gdpr-data-protection to add consent management
```

### Security & DoS Protection
```
Use security-dos-protection to add rate limiting to our APIs
Use security-dos-protection to implement brute force protection
```

### QA E2E Testing (Use after building features!)
```
Use qa-e2e-testing to create tests for the checkout flow
Use qa-e2e-testing to add smoke tests for critical paths
```

### Behavioral Science & Nudge (Use for engagement optimization!)
```
Use behavioral-science-nudge to review this onboarding flow
Use behavioral-science-nudge to design a habit loop for daily engagement
Use behavioral-science-nudge to audit our signup funnel for friction
Use behavioral-science-nudge to check for dark patterns
```

### Design UI/UX (Use for beautiful interfaces!)
```
Use design-ui-ux to review this screen layout for mobile
Use design-ui-ux to create a typography and color system
Use design-ui-ux to design the dashboard with cards and charts
Use design-ui-ux to check accessibility of our forms
Use design-ui-ux to add micro-interactions to buttons
```

### Code Review (Use before merging code!)
```
Use code-review to review this pull request
Use code-review to audit the order service for bugs
Use code-review to check this function for edge cases
Use code-review to find performance issues in the query
Use code-review to verify error handling is complete
```

### DevOps CI/CD (Use for deployment automation!)
```
Use devops-cicd to set up GitHub Actions CI/CD
Use devops-cicd to create preview deployments for PRs
Use devops-cicd to implement feature flags
Use devops-cicd to create a rollback procedure
```

### Performance (Use for speed optimization!)
```
Use performance to audit Core Web Vitals
Use performance to reduce bundle size
Use performance to implement caching strategy
Use performance to optimize Firestore queries
```

### Observability (Use for production monitoring!)
```
Use observability to set up structured logging
Use observability to integrate error tracking
Use observability to create alerting policies
Use observability to build an operations dashboard
```

## Recommended Workflow

### For New Features
1. `architect` - Review plan, design data model for insights
2. `design-ui-ux` - Design screens and visual interface
3. `behavioral-science-nudge` - Optimize for engagement & conversion
4. `firestore-specialist` - Refine Firestore schema
5. `functions-specialist` - Build Cloud Functions
6. `code-review` - Review code quality before continuing
7. `security-rules-specialist` - Add security rules
8. `security-dos-protection` - Harden security
9. `gdpr-data-protection` - Check privacy compliance
10. `performance` - Optimize load times and bundle size
11. `architect` - Review implementation
12. `qa-e2e-testing` - Create tests
13. `devops-cicd` - Set up CI/CD pipeline
14. `observability` - Add logging and monitoring
15. `/project:deploy` - Deploy safely

### For Security Audits
1. `security-dos-protection` - Application security
2. `security-rules-specialist` - Firebase rules
3. `gdpr-data-protection` - Privacy compliance
4. `architect` - Overall security architecture

## File Locations

### Global Installation
```
~/.claude/
├── CLAUDE.md              # Global instructions
├── agents/                # Available in all projects
│   ├── architect.md
│   ├── design-ui-ux.md
│   ├── behavioral-science-nudge.md
│   ├── code-review.md
│   ├── devops-cicd.md
│   ├── performance.md
│   ├── observability.md
│   ├── functions-specialist.md
│   ├── firestore-specialist.md
│   ├── security-rules-specialist.md
│   ├── gdpr-data-protection.md
│   ├── security-dos-protection.md
│   └── qa-e2e-testing.md
└── commands/              # Global commands
    ├── deploy.md
    ├── function.md
    └── rules.md
```

### Project Installation
```
your-firebase-project/
├── CLAUDE.md              # Project-specific config
├── .claude/
│   ├── settings.json      # Hooks config
│   ├── agents/            # Project agents
│   ├── hooks/             # Automation scripts
│   └── commands/          # Slash commands
├── functions/
├── firestore.rules
└── ...
```

## Troubleshooting

### Agents not found
```bash
# Check global agents
ls ~/.claude/agents/

# Check project agents
ls .claude/agents/
```

### Hooks not running
```bash
chmod +x .claude/hooks/*.sh
```

### Commands not available
```bash
ls ~/.claude/commands/   # Global
ls .claude/commands/      # Project
```

## Learn More

- [Firebase Documentation](https://firebase.google.com/docs)
- [Claude Code Settings](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
