# Security Rules Command

## Usage
`/project:rules [action] [collection]`

## Arguments
- `action`: review, create, test
- `collection` (optional): specific collection to focus on

## Description
Create, review, or test Firebase security rules.

## Actions

### Review Rules
```
/project:rules review
/project:rules review users
```

Analyzes existing rules for:
- Security vulnerabilities
- Missing validations
- Overly permissive access
- Best practice violations

### Create Rules
```
/project:rules create orders
```

Generates rules for a collection including:
- Authentication checks
- Data validation
- Field-level access control
- Helper functions

### Test Rules
```
/project:rules test
```

Creates or runs rule tests:
- Positive test cases (allowed access)
- Negative test cases (denied access)
- Edge cases

## Security Rules Template

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // ============================================
    // Helper Functions
    // ============================================
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return request.auth.uid == userId;
    }
    
    function isAdmin() {
      return isAuthenticated() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "admin";
    }
    
    function isValidString(field, minLen, maxLen) {
      return field is string && 
        field.size() >= minLen && 
        field.size() <= maxLen;
    }
    
    // ============================================
    // Collection Rules
    // ============================================
    
    // Users collection
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create: if isOwner(userId) && isValidUserData();
      allow update: if isOwner(userId) && isValidUserData() && unchangedFields(['createdAt', 'role']);
      allow delete: if false;
      
      function isValidUserData() {
        let data = request.resource.data;
        return data.keys().hasAll(['email', 'displayName']) &&
          isValidString(data.email, 5, 255) &&
          isValidString(data.displayName, 1, 100);
      }
      
      function unchangedFields(fields) {
        return !request.resource.data.diff(resource.data).affectedKeys().hasAny(fields);
      }
    }
    
    // Default deny
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Testing Rules

```typescript
// tests/firestore.rules.test.ts
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

describe("Firestore Rules", () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "test-project",
      firestore: { rules: fs.readFileSync("firestore.rules", "utf8") }
    });
  });

  afterAll(() => testEnv.cleanup());

  describe("users collection", () => {
    it("allows authenticated user to read", async () => {
      const db = testEnv.authenticatedContext("user1").firestore();
      await assertSucceeds(db.doc("users/user1").get());
    });

    it("denies unauthenticated read", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc("users/user1").get());
    });
  });
});
```

## Security Checklist
- [ ] Default deny all access
- [ ] Validate authentication
- [ ] Validate data types
- [ ] Validate required fields
- [ ] Protect sensitive fields from modification
- [ ] Test all rules
