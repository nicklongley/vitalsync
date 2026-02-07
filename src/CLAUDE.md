# Firebase Project

## Project Overview
This is a Firebase project using Cloud Functions, Firestore, and Firebase Hosting.

## Available Subagents

This project has 6 specialized subagents. Use them for their specific expertise:

### 1. architect
**When to use:**
- Before implementing major features (review the plan)
- After completing implementations (code review)
- When designing new data models
- When reviewing PRs or technical designs
- To identify technical debt or architectural issues
- When making significant technical decisions

**Example prompts:**
- "Use architect to review this feature plan before we start"
- "Use architect to review the code structure of the orders module"
- "Use architect to evaluate our database schema for the new feature"
- "Use architect to identify architectural issues in our codebase"

### 2. functions-specialist
**When to use:**
- Creating new Cloud Functions (HTTP, callable, triggers, scheduled)
- Debugging function issues
- Optimizing function performance
- Setting up function configuration

**Example prompts:**
- "Use functions-specialist to create an HTTP endpoint for user registration"
- "Use functions-specialist to add a Firestore trigger when orders are created"

### 3. firestore-specialist
**When to use:**
- Designing data models and schemas
- Writing complex queries
- Optimizing database performance
- Setting up indexes
- Planning data structure for new features

**Example prompts:**
- "Use firestore-specialist to design the data model for a shopping cart"
- "Use firestore-specialist to optimize queries for the orders collection"

### 4. security-rules-specialist
**When to use:**
- Writing or updating Firestore security rules
- Writing or updating Storage security rules
- Reviewing rules for vulnerabilities
- Testing security rules

**Example prompts:**
- "Use security-rules-specialist to write rules for the new messages collection"
- "Use security-rules-specialist to review our current rules for vulnerabilities"

### 5. gdpr-data-protection
**When to use:**
- Implementing user data export (right to access)
- Implementing account deletion (right to erasure)
- Setting up consent management
- Implementing data retention policies
- Reviewing code for GDPR compliance
- Handling personal data

**Example prompts:**
- "Use gdpr-data-protection to implement user data export functionality"
- "Use gdpr-data-protection to review how we handle user consent"
- "Use gdpr-data-protection to add data retention automation"

### 6. security-dos-protection
**When to use:**
- Implementing rate limiting
- Adding brute force protection
- Reviewing code for security vulnerabilities
- Adding input validation and sanitization
- Setting up security monitoring
- Protecting against DoS attacks
- Managing secrets securely

**Example prompts:**
- "Use security-dos-protection to add rate limiting to our API endpoints"
- "Use security-dos-protection to review our authentication flow for vulnerabilities"
- "Use security-dos-protection to implement brute force protection on login"

### 7. qa-e2e-testing
**When to use:**
- After building new functionality (ALWAYS use this before considering feature complete)
- Creating end-to-end tests with Playwright
- Setting up test infrastructure
- Writing API tests
- Creating smoke tests for critical paths
- Adding accessibility tests
- Setting up CI/CD test pipelines

**Example prompts:**
- "Use qa-e2e-testing to create tests for the new checkout flow"
- "Use qa-e2e-testing to add smoke tests for critical user paths"
- "Use qa-e2e-testing to set up Playwright for this project"

### 8. behavioral-science-nudge
**When to use:**
- Reviewing feature plans for behavioral effectiveness
- Auditing existing features for engagement optimization
- Designing for habit formation and retention
- Improving conversion funnels
- Adding gamification elements
- Checking for dark patterns or ethical concerns
- Designing notification strategies

**Example prompts:**
- "Use behavioral-science-nudge to review this onboarding flow"
- "Use behavioral-science-nudge to design a habit loop for daily check-ins"
- "Use behavioral-science-nudge to audit our checkout for friction"
- "Use behavioral-science-nudge to check for dark patterns"

### 9. design-ui-ux
**When to use:**
- Designing new screens or interfaces
- Reviewing layouts and visual hierarchy
- Creating or auditing design systems
- Ensuring mobile-first responsive design
- Checking accessibility compliance
- Implementing micro-interactions and animations
- Following iOS HIG or Material Design guidelines

**Example prompts:**
- "Use design-ui-ux to review this screen layout"
- "Use design-ui-ux to create a color system for the app"
- "Use design-ui-ux to design the onboarding flow"
- "Use design-ui-ux to check accessibility of our forms"

### 10. code-review
**When to use:**
- Reviewing pull requests before merge
- Auditing existing code for issues
- Checking implementation quality
- Finding bugs, security issues, performance problems
- Ensuring code meets production standards

**Example prompts:**
- "Use code-review to review this pull request"
- "Use code-review to audit the order service for issues"
- "Use code-review to check this function for edge cases"
- "Use code-review to find security vulnerabilities in auth code"

### 11. devops-cicd
**When to use:**
- Setting up GitHub Actions workflows
- Configuring Firebase deployments
- Managing environments (dev/staging/prod)
- Implementing feature flags
- Planning release and rollback strategies

**Example prompts:**
- "Use devops-cicd to set up CI/CD for this project"
- "Use devops-cicd to create a preview deployment workflow"
- "Use devops-cicd to implement feature flags with Remote Config"
- "Use devops-cicd to create a rollback procedure"

### 12. performance
**When to use:**
- Optimizing Core Web Vitals
- Reducing bundle sizes
- Implementing caching strategies
- Improving load times
- Diagnosing performance issues

**Example prompts:**
- "Use performance to audit our Core Web Vitals"
- "Use performance to reduce our JavaScript bundle size"
- "Use performance to implement service worker caching"
- "Use performance to optimize our Firestore queries"

### 13. observability
**When to use:**
- Setting up logging strategies
- Configuring error tracking
- Creating monitoring dashboards
- Implementing alerting
- Debugging production issues

**Example prompts:**
- "Use observability to set up structured logging"
- "Use observability to integrate Sentry error tracking"
- "Use observability to create alerting policies"
- "Use observability to build a debugging runbook"

## Development Workflow with Agents

### For New Features (Recommended Flow)
1. **Plan Review**: Use `architect` to review requirements and propose data model
2. **UX/UI Design**: Use `design-ui-ux` to design screens and interfaces
3. **Behavioral Review**: Use `behavioral-science-nudge` to optimize for engagement
4. **Data Model**: Use `architect` + `firestore-specialist` to design schema for insights
5. **Security Design**: Use `security-rules-specialist` to plan rules
6. **Implementation**: Use `functions-specialist` to build Cloud Functions
7. **Code Review**: Use `code-review` to review implementation quality
8. **Security Hardening**: Use `security-dos-protection` to add protection
9. **Privacy Check**: Use `gdpr-data-protection` if handling personal data
10. **Performance**: Use `performance` to optimize load times and bundle size
11. **Architecture Review**: Use `architect` to review final implementation
12. **Testing**: Use `qa-e2e-testing` to create comprehensive tests
13. **CI/CD**: Use `devops-cicd` to set up deployment pipeline
14. **Observability**: Use `observability` to add logging and monitoring
15. **Deploy**: Use `/project:deploy` command

### For Data Model Design
1. **Start with Questions**: What insights do we need? What queries will we run?
2. **Use `architect`**: Design relationships, think about analytics needs
3. **Use `firestore-specialist`**: Optimize for Firestore-specific patterns
4. **Use `architect` again**: Validate the design enables future insights

### For Security Audits
1. Use `security-dos-protection` for application security review
2. Use `security-rules-specialist` for Firebase rules review
3. Use `gdpr-data-protection` for privacy compliance review
4. Use `architect` to review overall security architecture

### For Bug Fixes
1. Use appropriate specialist based on the area (functions, firestore, etc.)
2. Use `qa-e2e-testing` to add regression tests for the fix
3. Use `architect` if the fix reveals architectural issues

### For Major Refactoring
1. Use `architect` to assess current state and propose improvements
2. Create Architecture Decision Record (ADR) for significant changes
3. Use appropriate specialists for implementation
4. Use `architect` for final review before merge

## Architecture
- **Cloud Functions**: Backend logic and API endpoints
- **Firestore**: NoSQL database with security rules
- **Firebase Hosting**: Static web app hosting
- **Firebase Storage**: File storage with security rules
- **Firebase Auth**: User authentication

## Folder Structure
```
├── functions/              # Cloud Functions
│   ├── src/
│   │   ├── index.ts       # Main exports
│   │   ├── api/           # HTTP endpoints
│   │   ├── triggers/      # Firestore/Auth triggers
│   │   ├── scheduled/     # Scheduled functions
│   │   ├── services/      # Business logic
│   │   ├── models/        # TypeScript interfaces
│   │   └── utils/         # Helpers
│   ├── tests/
│   └── package.json
├── hosting/                # Web app (or public/)
│   ├── src/
│   └── dist/
├── firestore.rules         # Firestore security rules
├── firestore.indexes.json  # Composite indexes
├── storage.rules           # Storage security rules
├── firebase.json           # Firebase config
└── .firebaserc            # Project aliases
```

## Common Commands
```bash
# Start emulators (Functions, Firestore, Auth, Storage)
firebase emulators:start

# Start emulators with data import
firebase emulators:start --import=./emulator-data

# Export emulator data
firebase emulators:export ./emulator-data

# Deploy everything
firebase deploy

# Deploy specific services
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only hosting

# Deploy specific function
firebase deploy --only functions:functionName

# Run function tests
cd functions && npm test

# Build functions
cd functions && npm run build

# View logs
firebase functions:log
```

## Code Conventions

### Cloud Functions
- Use TypeScript for all functions
- Export functions from `src/index.ts`
- Use v2 functions API (firebase-functions/v2)
- Group related functions in separate files
- Use `onRequest` for HTTP, `onCall` for callable functions

### Function Naming
- HTTP endpoints: `api_resourceName` (e.g., `api_users`)
- Firestore triggers: `on{Collection}{Event}` (e.g., `onUserCreate`)
- Scheduled: `scheduled_{task}` (e.g., `scheduled_cleanup`)
- Callable: `{action}{Resource}` (e.g., `createOrder`)

### TypeScript
- Define interfaces for all Firestore documents
- Use strict mode
- Prefer async/await over promises
- Type function parameters and returns

### Firestore
- Use subcollections for related data
- Keep documents under 1MB
- Use batch writes for multiple operations
- Always validate data in security rules

### Security Rules
- Default deny all access
- Validate data types and required fields
- Check auth state before allowing access
- Use functions for reusable logic

## Testing Strategy

### Unit Tests
- Test business logic in services/
- Mock Firestore and other Firebase services
- Use firebase-functions-test

### Integration Tests
- Test against emulators
- Test security rules with @firebase/rules-unit-testing
- Test callable functions end-to-end

### Test Commands
```bash
# Run all tests
cd functions && npm test

# Run with coverage
cd functions && npm run test:coverage

# Test security rules
npm run test:rules
```

## Environment Variables
```bash
# Set function config
firebase functions:config:set service.key="value"

# Get function config
firebase functions:config:get

# Use .env for local development
# functions/.env
```

## Deployment Workflow
1. Run tests locally
2. Test with emulators
3. Deploy to staging project
4. Verify in staging
5. Deploy to production

## Error Handling
- Use HttpsError for callable function errors
- Log errors with functions.logger
- Return appropriate HTTP status codes
- Include error codes for client handling

## Notes
- Always test security rules before deploying
- Use emulators for local development
- Check function cold start times
- Monitor function execution time and memory
