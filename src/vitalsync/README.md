# VitalSync — Firebase Build Guide

## Quick Start

### Prerequisites
- Node.js 20+ and npm
- Python 3.12+
- Firebase CLI: `npm install -g firebase-tools`
- A Google account

---

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. **Add project** → name it `vitalsync-prod`
3. Disable Google Analytics (not needed for MVP)

### Enable Services

In the Firebase Console, enable these:

**Authentication** (Build → Authentication → Get Started)
- Sign-in providers → Enable **Google**
- Add your domain to Authorized domains (localhost is added by default)

**Firestore** (Build → Firestore → Create database)
- Location: **europe-west2 (London)**
- Start in **production mode** (our rules file handles security)

**Functions** (Build → Functions → Get Started)
- Requires Blaze (pay-as-you-go) billing plan
- Python functions need this — you won't be charged meaningfully for personal use

### Register Web App

1. Project Settings → General → Your apps → **Add app** → Web
2. Register as "VitalSync Web"
3. Copy the `firebaseConfig` object — you'll need it in Step 3

---

## Step 2: Clone & Install

```bash
cd vitalsync

# Install frontend dependencies
npm install

# Set up Python functions
cd functions/python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ../..
```

---

## Step 3: Configure Environment

```bash
# Copy the env template
cp .env.example .env.local
```

Edit `.env.local` with your Firebase config values from Step 1:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=vitalsync-prod.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=vitalsync-prod
VITE_FIREBASE_STORAGE_BUCKET=vitalsync-prod.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

Also update `src/lib/firebase.js` — replace the placeholder config values with yours, or rely on the env vars.

---

## Step 4: Set Up Secrets for Cloud Functions

The Garmin encryption key must be stored in Google Cloud Secret Manager:

```bash
# Login to Firebase
firebase login

# Select your project
firebase use vitalsync-prod

# Generate a 256-bit (32-byte) encryption key
python3 -c "import os; print(os.urandom(32).hex())"
# Copy the output

# Set the secret
firebase functions:secrets:set GARMIN_ENCRYPTION_KEY
# Paste the hex key when prompted
```

---

## Step 5: Deploy

### Deploy Firestore rules & indexes
```bash
firebase deploy --only firestore
```

### Deploy Cloud Functions (Python)
```bash
firebase deploy --only functions
```

### Build & Deploy Frontend
```bash
npm run build
firebase deploy --only hosting
```

### Or deploy everything at once
```bash
npm run deploy
```

---

## Step 6: Local Development

### Run with emulators (recommended for development)

```bash
# Set emulator mode
# In .env.local, set:
# VITE_USE_EMULATORS=true

# Start Firebase emulators
firebase emulators:start

# In a separate terminal, start Vite dev server
npm run dev
```

The app will be at `http://localhost:5173` with emulators at `http://localhost:4000`.

**Note:** The Garmin login Cloud Function won't work in the emulator because it needs real network access to Garmin's SSO servers. For local development you can either:
- Deploy just the functions to production: `firebase deploy --only functions`
- Or test with the hosted version

### Run frontend only (against production Firebase)

```bash
# In .env.local, set:
# VITE_USE_EMULATORS=false

npm run dev
```

---

## Project Structure

```
vitalsync/
├── firebase.json              # Firebase project config
├── .firebaserc                # Project alias
├── firestore.rules            # Security rules (multi-tenant isolation)
├── firestore.indexes.json     # Composite indexes
│
├── index.html                 # Entry HTML
├── vite.config.js             # Vite + PWA config
├── tailwind.config.js         # Design tokens (VitalSync brand)
├── package.json               # Frontend dependencies
│
├── src/
│   ├── main.jsx               # React entry
│   ├── App.jsx                # Router + auth wrapper
│   │
│   ├── lib/
│   │   └── firebase.js        # Firebase SDK init + emulator config
│   │
│   ├── contexts/
│   │   └── AuthContext.jsx     # Google Sign-In + user settings
│   │
│   ├── hooks/
│   │   └── useGarminData.js   # Real-time Firestore listeners
│   │
│   ├── components/
│   │   ├── AppShell.jsx       # Layout + bottom tab bar
│   │   ├── GarminSyncProgress.jsx
│   │   └── tabs/
│   │       ├── DashboardTab.jsx    # Today's metrics
│   │       ├── HealthLogTab.jsx    # Manual entries
│   │       ├── TrainingTab.jsx     # AI plans + history
│   │       ├── InsightsTab.jsx     # Trends + interventions
│   │       └── SettingsTab.jsx     # Garmin + goals + availability
│   │
│   ├── pages/
│   │   └── LoginPage.jsx      # Google Sign-In
│   │
│   └── styles/
│       └── globals.css         # Tailwind + glassmorphism + brand
│
├── functions/
│   └── python/
│       ├── main.py            # All Cloud Functions
│       └── requirements.txt   # Python dependencies
│
└── public/                    # Static assets (icons, favicon)
```

---

## What's Wired Up (Ready to Build)

| Feature | Status | Files |
|---|---|---|
| Firebase project config | ✅ Ready | `firebase.json`, `.firebaserc` |
| Firestore security rules | ✅ Ready to deploy | `firestore.rules` |
| Firestore indexes | ✅ Ready to deploy | `firestore.indexes.json` |
| Google Sign-In auth | ✅ Working | `AuthContext.jsx`, `LoginPage.jsx` |
| User settings creation | ✅ Auto-creates on first sign-in | `AuthContext.jsx` |
| Garmin login (Garth) | ✅ Working | `functions/python/main.py` |
| Garmin disconnect | ✅ Working | `functions/python/main.py` |
| Scheduled sync (15 min) | ✅ Working | `functions/python/main.py` |
| On-demand sync | ✅ Working | `functions/python/main.py` |
| History backfill | ✅ Working (chunked) | `functions/python/main.py` |
| Token encryption (AES-256) | ✅ Working | `functions/python/main.py` |
| GDPR data deletion | ✅ Working | `functions/python/main.py` |
| Dashboard with live data | ✅ Wired to Firestore | `DashboardTab.jsx` |
| Garmin sync progress bar | ✅ Working | `GarminSyncProgress.jsx` |
| Settings + Garmin connect UI | ✅ Working | `SettingsTab.jsx` |
| PWA manifest + service worker | ✅ Configured | `vite.config.js` |
| Design system (glassmorphism) | ✅ Ready | `globals.css`, `tailwind.config.js` |
| Tab navigation | ✅ Working | `AppShell.jsx` |

## What to Build Next

These tabs have placeholder content — reference `vitalsync-architecture.md` for the full specs:

1. **Health Log forms** — Weight, BP, Mood, Glucose, Cholesterol (with DateEntryPicker)
2. **Training Plans** — AI-generated weekly plans from Claude API
3. **Insights & Trends** — Chart-based views using Recharts
4. **Settings: Goals & Availability** — The full training goals, weekly schedule, sport priorities UI
5. **Action Prompts** — Contextual nudge cards on Dashboard
6. **Cycling Power Analytics** — FTP tracking, Coggan profile, PMC chart

---

## Architecture Reference

The full architecture document is at `vitalsync-architecture.md` and covers:
- Complete Firestore data model (Section 3)
- Claude AI integration prompts (Section 4)
- Cycling power analytics & demographic comparison (Section 4A)
- Frontend screen map (Section 5)
- Brand identity & design system (Section 8)
- Multi-tenant auth architecture (Section 9)
- Full history backfill strategy (Section 10)
