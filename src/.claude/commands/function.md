# Create Firebase Function Command

## Usage
`/project:function $ARGUMENTS`

## Arguments
- Description of the function to create

## Description
Create a new Cloud Function with proper structure, types, and tests.

## Process

1. **Determine Function Type**:
   - HTTP endpoint (`onRequest`)
   - Callable function (`onCall`)
   - Firestore trigger (`onDocumentCreated`, etc.)
   - Auth trigger (`onUserCreated`, etc.)
   - Scheduled function (`onSchedule`)

2. **Create Function File**:
   - Place in appropriate directory under `functions/src/`
   - Use TypeScript with proper types
   - Follow naming conventions

3. **Function Structure**:
   ```typescript
   // functions/src/api/users.ts
   import { onRequest } from "firebase-functions/v2/https";
   import { logger } from "firebase-functions";
   
   export const api_users = onRequest(
     { region: "us-central1" },
     async (req, res) => {
       try {
         // Implementation
       } catch (error) {
         logger.error("Error:", error);
         res.status(500).json({ error: "Internal error" });
       }
     }
   );
   ```

4. **Export from index.ts**:
   ```typescript
   // functions/src/index.ts
   export { api_users } from "./api/users";
   ```

5. **Create Test File**:
   ```typescript
   // functions/tests/api/users.test.ts
   import { describe, it, expect } from "vitest";
   
   describe("api_users", () => {
     it("should handle GET request", async () => {
       // Test implementation
     });
   });
   ```

6. **Validate**:
   - Build: `cd functions && npm run build`
   - Test: `cd functions && npm test`
   - Test locally: `firebase emulators:start`

## Function Types

**HTTP Endpoint**:
```
/project:function Create GET /api/users endpoint to list users
```

**Callable Function**:
```
/project:function Create callable function to send welcome email
```

**Firestore Trigger**:
```
/project:function When order created, update inventory counts
```

**Scheduled Function**:
```
/project:function Run daily at midnight to clean up expired tokens
```

## Output
- Function file with implementation
- Export statement for index.ts
- Test file with basic tests
- Usage instructions
