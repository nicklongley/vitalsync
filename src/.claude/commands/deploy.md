# Firebase Deploy Command

## Usage
`/project:deploy [target]`

## Arguments
- `target` (optional): functions, rules, hosting, or all

## Description
Safely deploy Firebase resources with pre-deployment checks.

## Process

1. **Pre-deployment Checks**:
   - Run linting: `cd functions && npm run lint`
   - Run tests: `cd functions && npm test`
   - Build functions: `cd functions && npm run build`
   - Verify no console.log in production code

2. **Target-specific Deployment**:

   **Functions**:
   ```bash
   firebase deploy --only functions
   # Or specific function:
   firebase deploy --only functions:functionName
   ```

   **Security Rules**:
   ```bash
   # Test rules first!
   npm run test:rules
   # Then deploy
   firebase deploy --only firestore:rules
   firebase deploy --only storage:rules
   ```

   **Hosting**:
   ```bash
   cd hosting && npm run build
   firebase deploy --only hosting
   ```

   **All**:
   ```bash
   firebase deploy
   ```

3. **Post-deployment**:
   - Verify deployment in Firebase Console
   - Check function logs: `firebase functions:log`
   - Test critical endpoints

## Safety Checklist
- [ ] Tests passing
- [ ] Security rules tested
- [ ] Deploying to correct project
- [ ] No sensitive data in logs
- [ ] Environment variables set

## Example Usage
```
/project:deploy functions
/project:deploy rules
/project:deploy all
```
