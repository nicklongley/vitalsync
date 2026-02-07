# VitalSync — Architecture & Agent Workflow Document

## Product Vision

VitalSync is a Firebase-based personal health and fitness intelligence platform that ingests data from Garmin wearables via the **Garth library** (the same OAuth2 flow used by the official Garmin Connect mobile app), combines it with manually entered health metrics (weight, blood pressure, cholesterol, etc.), and uses Claude AI to generate personalised daily, weekly, and monthly health interventions and training plans.

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VitalSync PWA                               │
│  React + Tailwind + Recharts                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │Dashboard │ │ Health   │ │Training │ │Insights  │ │ Settings │ │
│  │ Today    │ │ Log      │ │ Plans   │ │ & Trends │ │ & Garmin │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                    Firebase SDK (Auth, Firestore, Functions)
                              │
┌─────────────────────────────┼───────────────────────────────────────┐
│                       Firebase Backend                               │
│                              │                                       │
│  ┌───────────────────────────┼────────────────────────────────┐     │
│  │              Cloud Functions                                │     │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────────────┐ │     │
│  │  │ Garmin Sync │ │ AI Engine    │ │ Scheduled Jobs      │ │     │
│  │  │ - OAuth     │ │ - Claude API │ │ - Daily digest      │ │     │
│  │  │ - Webhooks  │ │ - Analysis   │ │ - Weekly plan gen   │ │     │
│  │  │ - Pull/Push │ │ - Plan gen   │ │ - Monthly review    │ │     │
│  │  └──────┬──────┘ └──────┬───────┘ └──────────┬──────────┘ │     │
│  └─────────┼───────────────┼────────────────────┼────────────┘     │
│            │               │                    │                    │
│  ┌─────────┴───────────────┴────────────────────┴────────────┐     │
│  │                    Firestore                                │     │
│  │  users/{uid}/                                               │     │
│  │    ├── garminData/{date}      (synced metrics)              │     │
│  │    ├── healthLog/{entryId}    (manual entries)              │     │
│  │    ├── activities/{actId}     (Garmin activities)            │     │
│  │    ├── interventions/{id}     (AI recommendations)          │     │
│  │    ├── trainingPlans/{planId} (weekly plans)                │     │
│  │    ├── goals/{goalId}         (user goals)                  │     │
│  │    └── settings               (preferences, Garmin tokens)  │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│  Garmin Connect  │          │  Anthropic API   │
│  (via Garth)     │          │  Claude Sonnet   │
│  - OAuth 2.0     │          │  - /v1/messages  │
│  - REST pull     │          │  - Structured    │
│  - 105+ methods  │          │    JSON output   │
└──────────────────┘          └──────────────────┘
```

---

## 2. Garmin Connect Integration Architecture

### 2.1 Integration Approach — Garth Library (Pull Architecture)

VitalSync uses the **Garth** library — the same OAuth 2.0 authentication flow used by the official Garmin Connect mobile app — to pull data from the Garmin Connect API. This approach was chosen over the alternatives after careful evaluation:

| Approach | Cost | Approval | Data Access | Architecture | VitalSync Fit |
|---|---|---|---|---|---|
| **Garmin Connect Developer Program** (Official API) | Free (eval), licence fee for commercial Health API metrics | Enterprise-only, business application, 2+ day review, small devs often ghosted | Full (Health, Activity, Training, Courses APIs), webhooks | Push (webhooks) + Pull (backfill) | ❌ Enterprise gate, personal project |
| **Terra API** (Aggregator) | $399–499/month minimum | Instant (paid) | Normalised multi-device data via webhooks | Push (webhooks) | ❌ Cost prohibitive for personal use |
| **Garth / python-garminconnect** (Unofficial) | Free, open source | None — uses your own Garmin Connect credentials | 105+ API endpoints, all health + activity data, FIT files | Pull (scheduled + on-demand) | ✅ **Best fit** |

**Why Garth wins for VitalSync:**
- **Zero cost, zero approval** — works immediately with any Garmin Connect account
- **Complete data access** — HR, sleep, stress, HRV, SpO2, body comp, activities, FIT files, training status, VO2 max, training readiness, power data
- **Actively maintained** — uses the same OAuth2 flow as the Garmin Connect Android app (via the `garth` auth library)
- **Risks are acceptable** — Garmin could break the unofficial API, but the library is well-maintained and VitalSync is personal-scale. If it breaks temporarily, manual health logging still works.

### 2.2 Authentication Flow (Garth OAuth 2.0)

Garth authenticates using the same SSO flow as the Garmin Connect mobile app:

```
User enters Garmin credentials in Settings
         │
         ▼
Cloud Function: garminLogin()
  → Garth SSO: POST sso.garmin.com/sso/embed (same as mobile app)
  → Receives OAuth2 tokens (access_token + refresh_token)
  → Encrypts and stores tokens in Firestore (AES-256-GCM)
  → Triggers initial data sync
         │
         ▼
Scheduled Cloud Function: garminSync() — runs every 15 minutes
  → Refreshes OAuth2 token via Garth (auto-refresh if expired)
  → Pulls latest data for each data type (dailies, sleep, HR, etc.)
  → Writes to Firestore
  → Triggers AI analysis if significant changes detected
```

**Key difference from official API:** No webhooks/push — VitalSync uses a **scheduled pull** every 15 minutes plus **on-demand pull** when user opens the app. This is more than sufficient since Garmin devices only sync to Garmin Connect when the user opens the Garmin Connect app or syncs via Bluetooth anyway.

### 2.3 Data Ingestion Strategy

**Primary: Scheduled Pull (Cloud Scheduler)**
A Cloud Function runs every 15 minutes to sync the latest data:

```python
# Cloud Function: garminSync (Python — Garth is a Python library)
# Deployed as a Firebase Cloud Function (2nd gen, Python runtime)

import garth
from garminconnect import Garmin
from firebase_admin import firestore
from datetime import date, timedelta

def garmin_sync(uid: str) -> dict:
    """Pull latest Garmin data for a user."""
    
    # Load encrypted tokens from Firestore
    tokens = load_garmin_tokens(uid)
    
    # Restore Garth session from stored tokens
    garth.resume(tokens['garth_session'])
    client = Garmin()
    client.garth = garth.client
    
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    
    # Pull all available data types
    data = {}
    
    # ── DAILY HEALTH DATA ──
    data['stats'] = client.get_stats(today)                    # Steps, calories, distance, floors
    data['heart_rates'] = client.get_heart_rates(today)        # Resting HR, HR zones, time-in-zone
    data['sleep'] = client.get_sleep_data(today)               # Sleep stages, duration, score
    data['stress'] = client.get_stress_data(today)             # Stress level, body battery
    data['body_comp'] = client.get_body_composition(today)     # Weight, body fat %, BMI
    data['hrv'] = client.get_hrv_data(today)                   # HRV status, weekly average
    data['spo2'] = client.get_spo2_data(today)                 # Blood oxygen saturation
    data['respiration'] = client.get_respiration_data(today)   # Breathing rate
    data['hydration'] = client.get_hydration_data(today)       # Daily water intake
    data['training_readiness'] = client.get_training_readiness(today)  # Recovery score
    data['training_status'] = client.get_training_status(today)        # VO2 max, load, status
    
    # ── RECENT ACTIVITIES ──
    data['activities'] = client.get_activities(0, 10)          # Last 10 activities
    
    # ── USER METRICS ──
    data['user_metrics'] = client.get_max_metrics(today)       # VO2 max, fitness age
    
    # Save refreshed tokens back (Garth auto-refreshes OAuth2 tokens)
    save_garmin_tokens(uid, garth.client.dumps())
    
    # Write to Firestore
    write_garmin_data(uid, today, data)
    
    return {'status': 'ok', 'date': today, 'data_types': list(data.keys())}
```

**Secondary: On-Demand Pull (User Opens App)**
When the user opens VitalSync, the client calls a Cloud Function to check if data is stale (>15 min) and pulls fresh data if needed:

```typescript
// Client-side: Check freshness on app open
useEffect(() => {
  const settings = userSettings;
  if (settings?.garmin?.connected) {
    const lastSync = settings.garmin.lastSyncAt?.toDate();
    const staleMinutes = 15;
    if (!lastSync || (Date.now() - lastSync.getTime()) > staleMinutes * 60 * 1000) {
      // Trigger on-demand sync
      const syncGarmin = httpsCallable(functions, 'garminSyncOnDemand');
      syncGarmin();
    }
  }
}, [userSettings]);
```

### 2.4 Activity Detail & FIT File Download

For detailed activity data (power, cadence, GPS, lap splits), VitalSync downloads the FIT file:

```python
# Download FIT file for a specific activity
def get_activity_details(client: Garmin, activity_id: str) -> dict:
    # Get activity summary (metadata, averages, totals)
    summary = client.get_activity(activity_id)
    
    # Get detailed splits/laps
    splits = client.get_activity_splits(activity_id)
    
    # Get HR zones for this activity
    hr_zones = client.get_activity_hr_in_timezones(activity_id)
    
    # Download FIT file for full granular data (power, cadence, GPS track)
    fit_data = client.download_activity(activity_id, dl_fmt='FIT')
    
    # Parse FIT file for cycling power data
    if summary.get('activityType', {}).get('typeKey') == 'cycling':
        power_data = parse_fit_power_data(fit_data)
        # Extract: avg power, NP, max power, L/R balance, power zones,
        #          pedal smoothness, torque effectiveness, power phases
    
    return {
        'summary': summary,
        'splits': splits,
        'hrZones': hr_zones,
        'powerData': power_data if 'power_data' in dir() else None,
    }
```

### 2.5 Available Garmin Data Types (via Garth/garminconnect)

| Summary Type | Key Metrics | Garth Method | Frequency |
|---|---|---|---|
| **Daily Summary** | Steps, distance, calories, active minutes, floors, intensity minutes | `get_stats(date)` | Daily |
| **Heart Rate** | Resting HR, max HR, min HR, HR zones (time in each zone) | `get_heart_rates(date)` | Daily |
| **Sleep** | Duration, deep/light/REM/awake stages, sleep score, respiration | `get_sleep_data(date)` | Per sleep event |
| **Stress** | Stress level (1-100), body battery, stress duration by category | `get_stress_data(date)` | Daily (3-min intervals) |
| **Body Composition** | Weight, BMI, body fat %, muscle mass, bone mass, body water % | `get_body_composition(date)` | Per weigh-in |
| **Pulse Ox (SpO2)** | Blood oxygen saturation, sleep SpO2 averages | `get_spo2_data(date)` | Daily / overnight |
| **HRV** | HRV status, weekly average, balance/stress indicators | `get_hrv_data(date)` | Nightly |
| **Respiration** | Average breathing rate, waking/sleeping rates | `get_respiration_data(date)` | Daily |
| **Activities** | Type, duration, distance, pace, HR zones, VO2 max, training effect | `get_activities(start, limit)` | Per activity |
| **Activity Detail** | Full FIT file: GPS, power, cadence, lap splits, HR stream | `download_activity(id, 'FIT')` | Per activity |
| **Training Readiness** | Readiness score, HRV, sleep, recovery, training load | `get_training_readiness(date)` | Daily |
| **Training Status** | VO2 max, training load, recovery time, fitness trend | `get_training_status(date)` | Per activity |
| **User Metrics** | VO2 max (run/cycle), fitness age, performance condition | `get_max_metrics(date)` | Updated per activity |
| **Hydration** | Daily water intake (ml) | `get_hydration_data(date)` | Daily |
| **Personal Records** | All-time bests by activity type | `get_personal_record()` | On demand |
| **Cycling Power** | Avg power, max power, normalized power (NP), FTP, W/kg, power zones, L/R balance | Parsed from FIT file | Per ride |
| **Cycling Advanced** | TSS, IF (Intensity Factor), kJ (work), cadence, pedal smoothness, torque effectiveness | Parsed from FIT file | Per ride |
| **Power Phases** | Power phase L/R angles, peak power phase angles, platform centre offset | Parsed from FIT file | Per ride (dual-sided PM) |

---

## 3. Firestore Data Model

### 3.1 Core Collections

```
users/{uid}
│
├── settings (document)
│   ├── displayName: string
│   ├── dateOfBirth: timestamp
│   ├── gender: 'male' | 'female' | 'other'
│   ├── heightCm: number
│   ├── garmin: {
│   │     connected: boolean
│   │     garthSession: string (encrypted)       // Garth OAuth2 session blob
│   │     garminEmail: string (encrypted)         // For re-auth if token expires
│   │     lastSyncAt: timestamp
│   │     syncFrequencyMinutes: number            // Default 15
│   │     backfillStatus: 'idle' | 'syncing' | 'complete'
│   │     backfillProgress: number                // 0-100
│   │   }
│   ├── goals: {
│   │     // ── PRIMARY & SECONDARY GOALS ──
│   │     primaryGoal: 'build_ftp' | 'run_race' | 'lose_weight' |
│   │                  'general_fitness' | 'improve_endurance'
│   │     secondaryGoals: string[]     // e.g. ['improve_sleep', 'body_comp', 'run_faster']
│   │     
│   │     // ── NUMERIC TARGETS ──
│   │     ftpTarget: number            // e.g. 290W
│   │     wkgTarget: number            // e.g. 3.6 W/kg
│   │     targetWeight: number         // e.g. 78 kg
│   │     weeklyRunningKm: number      // e.g. 40
│   │     weeklyCyclingTSS: number     // e.g. 300
│   │     sleepHoursTarget: number     // e.g. 7.5
│   │     targetRestingHR: number
│   │     stepsTarget: number
│   │   }
│   ├── availability: {
│   │     // ── WEEKLY TRAINING BUDGET ──
│   │     totalHoursPerWeek: number    // e.g. 9 — hard cap for AI planning
│   │     maxSingleSessionHours: number // e.g. 3 — longest acceptable session
│   │     preferredRestDaysPerWeek: number  // e.g. 1
│   │     
│   │     // ── DAY-BY-DAY SCHEDULE ──
│   │     // Each day: time slot preference + duration budget
│   │     schedule: {
│   │       mon: { slot: 'morning'|'lunch'|'evening'|'rest', durationHours: number }
│   │       tue: { slot: ..., durationHours: ... }
│   │       wed: { slot: ..., durationHours: ... }
│   │       thu: { slot: ..., durationHours: ... }
│   │       fri: { slot: ..., durationHours: ... }
│   │       sat: { slot: ..., durationHours: ... }
│   │       sun: { slot: ..., durationHours: ... }
│   │     }
│   │     
│   │     // ── SPORT PRIORITIES (ranked) ──
│   │     // Order = priority. AI allocates proportionally.
│   │     sportPriorities: [
│   │       { sport: 'cycling', weeklyHours: number, percentage: number }
│   │       { sport: 'running', weeklyHours: number, percentage: number }
│   │       { sport: 'strength', weeklyHours: number, percentage: number }
│   │     ]
│   │   }
│   ├── healthContext: {
│   │     conditions: string[]         // e.g. ['hypertension', 'pre-diabetic']
│   │     medications: string[]
│   │     allergies: string[]
│   │     fitnessLevel: 'beginner' | 'intermediate' | 'advanced'
│   │     preferredActivities: string[] // e.g. ['running', 'cycling', 'swimming']
│   │     injuries: string[]
│   │     doctorNotes: string
│   │   }
│   ├── preferences: {
│   │     units: 'metric' | 'imperial'
│   │     timezone: string
│   │     notificationsEnabled: boolean
│   │     interventionFrequency: 'daily' | 'weekly'
│   │     aiPersonality: 'coach' | 'clinical' | 'supportive'
│   │   }
│   └── updatedAt: timestamp
│
├── garminData/{YYYY-MM-DD} (daily snapshot)
│   ├── daily: {
│   │     steps: number
│   │     distance: number
│   │     calories: { total, active, bmr }
│   │     floorsClimbed: number
│   │     intensityMinutes: { moderate, vigorous }
│   │     activeMinutes: number
│   │   }
│   ├── heartRate: {
│   │     resting: number
│   │     max: number
│   │     min: number
│   │     average: number
│   │     zones: { zone1Min, zone2Min, zone3Min, zone4Min, zone5Min }
│   │   }
│   ├── sleep: {
│   │     durationSeconds: number
│   │     deepSleepSeconds: number
│   │     lightSleepSeconds: number
│   │     remSleepSeconds: number
│   │     awakeSleepSeconds: number
│   │     sleepScore: number
│   │     sleepStartTime: timestamp
│   │     sleepEndTime: timestamp
│   │   }
│   ├── stress: {
│   │     averageLevel: number
│   │     maxLevel: number
│   │     bodyBatteryHigh: number
│   │     bodyBatteryLow: number
│   │     restStressDuration: number
│   │     activityStressDuration: number
│   │     highStressDuration: number
│   │     mediumStressDuration: number
│   │     lowStressDuration: number
│   │   }
│   ├── hrv: {
│   │     weeklyAverage: number
│   │     lastNightAverage: number
│   │     lastNight5MinHigh: number
│   │     status: 'balanced' | 'unbalanced' | 'low'
│   │   }
│   ├── spo2: {
│   │     averageSpo2: number
│   │     lowestSpo2: number
│   │     sleepAverageSpo2: number
│   │   }
│   ├── respiration: {
│   │     avgWakingRate: number
│   │     avgSleepingRate: number
│   │     highestRate: number
│   │     lowestRate: number
│   │   }
│   ├── trainingReadiness: {
│   │     score: number
│   │     level: string
│   │     hrvStatus: string
│   │     sleepHistory: string
│   │     recoveryTime: number
│   │     trainingLoadBalance: string
│   │   }
│   ├── syncedAt: timestamp
│   └── source: 'garmin_push' | 'garmin_pull' | 'manual'
│
├── healthLog/{entryId} (manually entered data)
│   ├── date: timestamp                // User-selectable, defaults to today.
│   │                                   // Cannot be set to a future date.
│   │                                   // Supports backdating for missed entries.
│   ├── enteredAt: timestamp           // When the entry was actually created (always now)
│   ├── type: 'weight' | 'blood_pressure' | 'cholesterol' |
│   │         'blood_glucose' | 'body_measurements' | 'mood' |
│   │         'energy' | 'nutrition' | 'hydration' | 'medication' |
│   │         'symptom' | 'lab_result' | 'custom'
│   ├── data: {
│   │     // Weight
│   │     weightKg?: number
│   │     bodyFatPercent?: number
│   │     
│   │     // Blood Pressure
│   │     systolic?: number
│   │     diastolic?: number
│   │     pulse?: number
│   │     
│   │     // Cholesterol (from lab results)
│   │     totalCholesterol?: number
│   │     ldl?: number
│   │     hdl?: number
│   │     triglycerides?: number
│   │     
│   │     // Blood Glucose
│   │     glucoseLevel?: number
│   │     measurementContext?: 'fasting' | 'post_meal' | 'random'
│   │     
│   │     // Body Measurements
│   │     waistCm?: number
│   │     hipCm?: number
│   │     chestCm?: number
│   │     
│   │     // Mood & Energy (1-10 scale)
│   │     moodScore?: number
│   │     energyScore?: number
│   │     stressPerception?: number
│   │     
│   │     // Nutrition
│   │     caloriesConsumed?: number
│   │     proteinG?: number
│   │     carbsG?: number
│   │     fatG?: number
│   │     fibreG?: number
│   │     alcoholUnits?: number
│   │     
│   │     // Hydration
│   │     waterMl?: number
│   │     
│   │     // Symptoms
│   │     symptoms?: string[]
│   │     severity?: number  // 1-10
│   │     
│   │     // Lab Results
│   │     testName?: string
│   │     value?: number
│   │     unit?: string
│   │     referenceRange?: string
│   │     
│   │     // Custom
│   │     label?: string
│   │     value?: number | string
│   │     unit?: string
│   │   }
│   ├── notes?: string
│   ├── attachments?: string[]  // Storage refs for lab result photos
│   ├── createdAt: timestamp
│   └── updatedAt: timestamp
│
├── activities/{activityId} (from Garmin or manual)
│   ├── date: timestamp
│   ├── source: 'garmin' | 'manual'
│   ├── garminActivityId?: string
│   ├── type: string           // 'running', 'cycling', 'swimming', etc.
│   ├── name: string
│   ├── durationSeconds: number
│   ├── distanceMeters: number
│   ├── calories: number
│   ├── averageHR: number
│   ├── maxHR: number
│   ├── averagePace?: number   // sec/km
│   ├── elevationGain?: number
│   ├── trainingEffect: { aerobic, anaerobic }
│   ├── vo2Max?: number
│   ├── performanceCondition?: number
│   ├── laps?: [{
│   │     lapNumber, duration, distance, averageHR, averagePace,
│   │     avgPower?, normalizedPower?, maxPower?  // cycling laps
│   │   }]
│   ├── hrZones?: { zone1-5 seconds }
│   │
│   │   // ── CYCLING-SPECIFIC POWER DATA ──
│   ├── cycling?: {
│   │     // Core Power Metrics
│   │     avgPower: number              // Average power (watts)
│   │     maxPower: number              // Peak power (watts)
│   │     normalizedPower: number       // NP™ (watts) - smoothed avg accounting for variability
│   │     weightedAvgPower?: number     // Same as NP for most purposes
│   │     
│   │     // FTP & Relative Power
│   │     ftp: number                   // Current FTP at time of ride (watts)
│   │     wattsPerKg: number            // Avg power / weight
│   │     npWattsPerKg: number          // NP / weight
│   │     ftpWattsPerKg: number         // FTP / weight (from user profile)
│   │     
│   │     // Training Metrics (Coggan)
│   │     intensityFactor: number       // IF = NP / FTP (0.0 - 1.5+)
│   │     trainingStressScore: number   // TSS = (duration × NP × IF) / (FTP × 3600) × 100
│   │     variabilityIndex: number      // VI = NP / avg power (1.0 = perfectly steady)
│   │     efficiencyFactor?: number     // EF = NP / avg HR (aerobic efficiency)
│   │     work: number                  // Total work in kJ
│   │     
│   │     // Power Zones (time in each zone, seconds)
│   │     powerZones: {
│   │       zone1: number    // Active Recovery: < 55% FTP
│   │       zone2: number    // Endurance: 56-75% FTP
│   │       zone3: number    // Tempo: 76-90% FTP
│   │       zone4: number    // Threshold: 91-105% FTP
│   │       zone5: number    // VO2 Max: 106-120% FTP
│   │       zone6: number    // Anaerobic: 121-150% FTP
│   │       zone7: number    // Neuromuscular: > 150% FTP
│   │     }
│   │     
│   │     // Cadence
│   │     avgCadence: number            // rpm
│   │     maxCadence: number
│   │     
│   │     // Pedaling Dynamics (dual-sided power meter only)
│   │     leftRightBalance?: {
│   │       left: number                // percentage (e.g. 51.2)
│   │       right: number               // percentage (e.g. 48.8)
│   │     }
│   │     pedalSmoothness?: { left, right }
│   │     torqueEffectiveness?: { left, right }
│   │     
│   │     // Power Duration Bests (for power profile)
│   │     bestEfforts?: {
│   │       peak5s: number              // Best 5-sec power (neuromuscular)
│   │       peak30s: number
│   │       peak1min: number            // Best 1-min power (anaerobic capacity)
│   │       peak5min: number            // Best 5-min power (VO2 max)
│   │       peak10min: number
│   │       peak20min: number           // 95% = FTP estimate
│   │       peak30min: number
│   │       peak60min: number           // True FTP if available
│   │     }
│   │   }
│   │
│   └── syncedAt: timestamp
│
├── cyclingProfile/{uid} (singleton - user's cycling power profile)
│   ├── currentFTP: number              // Latest FTP in watts
│   ├── ftpHistory: [{                  // FTP progression over time
│   │     date: timestamp
│   │     ftp: number
│   │     wattsPerKg: number
│   │     source: 'garmin_auto' | 'manual_test' | '20min_test' | 'ramp_test'
│   │     testDetails?: string
│   │   }]
│   ├── currentWeight: number           // For W/kg calculations
│   ├── currentWattsPerKg: number       // FTP / weight
│   │
│   │   // Coggan Power Profile (best all-time W/kg at key durations)
│   ├── powerProfile: {
│   │     peak5s: { watts, wattsPerKg, date, category }    // Neuromuscular
│   │     peak1min: { watts, wattsPerKg, date, category }  // Anaerobic
│   │     peak5min: { watts, wattsPerKg, date, category }  // VO2 Max
│   │     peak20min: { watts, wattsPerKg, date, category } // FTP
│   │   }
│   │
│   │   // Demographic Comparison (computed by AI/Cloud Function)
│   ├── demographic: {
│   │     ageGroup: string              // e.g. '35-39'
│   │     gender: string
│   │     
│   │     // Coggan Category Classification
│   │     ftpCategory: string           // 'Untrained' | 'Fair' | 'Moderate' |
│   │                                   // 'Good' | 'Very Good' | 'Excellent' |
│   │                                   // 'Exceptional' | 'World Class'
│   │     
│   │     // Percentile rankings (based on Cycling Analytics / population data)
│   │     percentiles: {
│   │       ftp: number                 // e.g. 72 means top 28%
│   │       ftpWkg: number
│   │       peak5s: number
│   │       peak1min: number
│   │       peak5min: number
│   │     }
│   │     
│   │     // Age-adjusted performance
│   │     ageAdjustedFTP: number        // FTP adjusted for age decline (~5-8%/decade from 35)
│   │     agePerformanceIndex: number   // How you compare vs age group average
│   │     
│   │     // Training Level Reference (Coggan Male W/kg Table)
│   │     // Stored for quick UI rendering without re-computation
│   │     referenceTable: {
│   │       untrained: { min: number, max: number }     // 2.00 - 2.49
│   │       fair: { min: number, max: number }           // 2.50 - 3.04
│   │       moderate: { min: number, max: number }       // 3.05 - 3.54
│   │       good: { min: number, max: number }           // 3.55 - 4.12
│   │       veryGood: { min: number, max: number }       // 4.13 - 4.70
│   │       excellent: { min: number, max: number }      // 4.71 - 5.27
│   │       exceptional: { min: number, max: number }    // 5.28 - 5.82
│   │       worldClass: { min: number, max: number }     // 5.83 - 6.40
│   │     }
│   │   }
│   │
│   │   // Chronic Training Load (CTL/ATL/TSB)
│   ├── trainingLoad: {
│   │     ctl: number                   // Chronic Training Load (42-day rolling avg TSS)
│   │     atl: number                   // Acute Training Load (7-day rolling avg TSS)
│   │     tsb: number                   // Training Stress Balance = CTL - ATL
│   │     rampRate: number              // CTL change per week
│   │     lastComputed: timestamp
│   │     history: [{                   // For PMC chart
│   │       date, ctl, atl, tsb
│   │     }]
│   │   }
│   │
│   └── updatedAt: timestamp
│
├── interventions/{interventionId} (AI-generated)
│   ├── date: timestamp
│   ├── period: 'daily' | 'weekly' | 'monthly'
│   ├── category: 'training' | 'recovery' | 'nutrition' | 'sleep' |
│   │             'stress' | 'health_alert' | 'lifestyle'
│   ├── priority: 'high' | 'medium' | 'low'
│   ├── title: string
│   ├── summary: string
│   ├── detail: string
│   ├── reasoning: string        // Why this was recommended
│   ├── dataPoints: [{           // What data drove this
│   │     metric: string
│   │     value: number
│   │     trend: 'improving' | 'stable' | 'declining'
│   │     concern: boolean
│   │   }]
│   ├── actions: [{              // Specific actionable steps
│   │     description: string
│   │     completed: boolean
│   │     completedAt?: timestamp
│   │   }]
│   ├── status: 'active' | 'completed' | 'dismissed' | 'superseded'
│   ├── userFeedback?: {
│   │     helpful: boolean
│   │     notes?: string
│   │   }
│   ├── generatedBy: string     // Claude model version
│   ├── createdAt: timestamp
│   └── expiresAt: timestamp
│
├── trainingPlans/{planId}
│   ├── weekStartDate: timestamp
│   ├── weekEndDate: timestamp
│   ├── status: 'active' | 'completed' | 'skipped'
│   ├── focusAreas: string[]
│   ├── summary: string
│   ├── totalPlannedMinutes: number
│   ├── totalPlannedKm: number
│   ├── sessions: [{
│   │     day: 'monday' | 'tuesday' | ... | 'sunday'
│   │     date: timestamp
│   │     type: 'run' | 'cycle' | 'swim' | 'strength' | 'yoga' |
│   │           'hiit' | 'rest' | 'active_recovery' | 'cross_training'
│   │     title: string
│   │     description: string
│   │     durationMinutes: number
│   │     intensityLevel: 'easy' | 'moderate' | 'hard' | 'max'
│   │     targetHRZone?: number
│   │     targetPace?: { min, max }  // sec/km
│   │     targetDistance?: number
│   │     warmUp?: string
│   │     mainSet?: string
│   │     coolDown?: string
│   │     completed: boolean
│   │     actualActivityId?: string  // Link to actual Garmin activity
│   │     adherenceNotes?: string
│   │   }]
│   ├── adjustments: [{          // Mid-week AI adjustments
│   │     date: timestamp
│   │     reason: string
│   │     changes: string
│   │   }]
│   ├── weekReview?: {           // AI end-of-week review
│   │     adherencePercent: number
│   │     totalActualMinutes: number
│   │     totalActualKm: number
│   │     highlights: string
│   │     improvements: string
│   │     nextWeekFocus: string
│   │   }
│   ├── generatedBy: string
│   └── createdAt: timestamp
│
├── trends/{period}  (pre-computed for fast dashboard loading)
│   ├── period: 'week' | 'month' | 'quarter' | 'year'
│   ├── startDate: timestamp
│   ├── endDate: timestamp
│   ├── metrics: {
│   │     avgRestingHR: number
│   │     restingHRTrend: number[]
│   │     avgSleepScore: number
│   │     sleepScoreTrend: number[]
│   │     avgSteps: number
│   │     stepsTrend: number[]
│   │     avgHRV: number
│   │     hrvTrend: number[]
│   │     weightTrend: number[]
│   │     vo2MaxTrend: number[]
│   │     avgBodyBattery: number
│   │     totalActivities: number
│   │     totalActiveMinutes: number
│   │     totalDistanceKm: number
│   │     bloodPressureTrend: { systolic: number[], diastolic: number[] }
│   │   }
│   ├── computedAt: timestamp
│   └── nextComputeAt: timestamp
│
├── activityStats/{periodKey}  (pre-computed training history aggregations)
│   │   // periodKey format: "week-2026-06" | "month-2026-01" | "year-2026"
│   ├── periodType: 'week' | 'month' | 'year'
│   ├── periodLabel: string          // e.g. "W6 2026", "Jan 2026", "2026"
│   ├── startDate: timestamp
│   ├── endDate: timestamp
│   │
│   │   // ── TOTALS (all sports combined) ──
│   ├── totals: {
│   │     activityCount: number
│   │     durationSeconds: number      // Total training time
│   │     durationHours: number        // Convenience: seconds / 3600
│   │     calories: number             // Total active calories burned
│   │     distanceMeters: number
│   │     distanceKm: number           // Convenience
│   │     elevationGainM: number
│   │     avgHR: number                // Weighted avg across all activities
│   │     tss: number                  // Total TSS (cycling only, 0 for others)
│   │     work: number                 // Total kJ
│   │   }
│   │
│   │   // ── PER-SPORT BREAKDOWN ──
│   ├── bySport: {
│   │     running: {
│   │       activityCount: number
│   │       durationSeconds: number
│   │       durationHours: number
│   │       calories: number
│   │       distanceKm: number
│   │       elevationGainM: number
│   │       avgPace: number            // sec/km weighted avg
│   │       avgHR: number
│   │       longestRunKm: number
│   │       fastestPace: number        // best avg pace in period
│   │     }
│   │     cycling: {
│   │       activityCount: number
│   │       durationSeconds: number
│   │       durationHours: number
│   │       calories: number
│   │       distanceKm: number
│   │       elevationGainM: number
│   │       avgPower: number           // Weighted avg power
│   │       avgNP: number              // Weighted avg NP
│   │       totalTSS: number
│   │       totalWork: number          // kJ
│   │       avgHR: number
│   │       longestRideKm: number
│   │       bestNP: number             // Highest NP ride in period
│   │     }
│   │     swimming: {
│   │       activityCount: number
│   │       durationSeconds: number
│   │       durationHours: number
│   │       calories: number
│   │       distanceKm: number
│   │       avgPace: number            // sec/100m
│   │       avgHR: number
│   │     }
│   │     strength: {
│   │       activityCount: number
│   │       durationSeconds: number
│   │       durationHours: number
│   │       calories: number
│   │     }
│   │     other: {                     // yoga, hiking, walking, etc.
│   │       activityCount: number
│   │       durationSeconds: number
│   │       durationHours: number
│   │       calories: number
│   │       distanceKm: number
│   │       sportTypes: string[]       // e.g. ['yoga', 'hiking', 'walking']
│   │     }
│   │   }
│   │
│   │   // ── DAILY BREAKDOWN (for bar chart rendering) ──
│   ├── dailyBreakdown: [{
│   │     date: string                 // 'YYYY-MM-DD'
│   │     dayLabel: string             // 'Mon', 'Tue', etc.
│   │     activities: [{
│   │       type: string
│   │       durationSeconds: number
│   │       calories: number
│   │       distanceKm: number
│   │     }]
│   │     totalDurationSeconds: number
│   │     totalCalories: number
│   │   }]
│   │
│   │   // ── PERIOD-OVER-PERIOD COMPARISON ──
│   ├── comparison: {
│   │     prevPeriodKey: string        // e.g. "week-2026-05"
│   │     durationChange: number       // percentage change
│   │     caloriesChange: number
│   │     distanceChange: number
│   │     activityCountChange: number
│   │   }
│   │
│   │   // ── YEAR-OVER-YEAR COMPARISON (same period, prior year) ──
│   ├── yoyComparison: {
│   │     // Compares e.g. W6-2026 vs W6-2025, Jan-2026 vs Jan-2025
│   │     priorYearPeriodKey: string   // e.g. "week-2025-06" | "month-2025-01"
│   │     hasPriorYearData: boolean    // false if no data for that period last year
│   │     priorYear: {
│   │       durationHours: number
│   │       calories: number
│   │       distanceKm: number
│   │       activityCount: number
│   │       bySport: {                 // per-sport prior year totals for comparison
│   │         [sport: string]: {
│   │           durationHours: number
│   │           calories: number
│   │           distanceKm: number
│   │           activityCount: number
│   │         }
│   │       }
│   │     }
│   │     changes: {
│   │       durationChange: number     // percentage: ((current - prior) / prior) * 100
│   │       caloriesChange: number
│   │       distanceChange: number
│   │       activityCountChange: number
│   │     }
│   │     // Per-sport YoY changes
│   │     sportChanges: {
│   │       [sport: string]: {
│   │         durationChange: number
│   │         caloriesChange: number
│   │         distanceChange: number
│   │       }
│   │     }
│   │   }
│   │
│   ├── computedAt: timestamp
│   └── computedFrom: number           // Count of activities used
│
│   // ── LIFETIME STATS (singleton, updated incrementally) ──
├── lifetimeStats (document)
│   ├── totalActivities: number
│   ├── totalDurationHours: number
│   ├── totalCalories: number
│   ├── totalDistanceKm: number
│   ├── totalElevationGainM: number
│   ├── bySport: {
│   │     running: { count, hours, km, calories }
│   │     cycling: { count, hours, km, calories, tss, kj }
│   │     swimming: { count, hours, km, calories }
│   │     strength: { count, hours, calories }
│   │     other: { count, hours, calories }
│   │   }
│   ├── firstActivityDate: timestamp
│   ├── currentStreak: number          // consecutive days with activity
│   ├── longestStreak: number
│   ├── personalRecords: {
│   │     longestRun: { km, date }
│   │     fastestRunPace: { secPerKm, date, distanceKm }
│   │     longestRide: { km, date }
│   │     highestNP: { watts, date }
│   │     highestTSS: { tss, date }
│   │     mostCaloriesBurned: { calories, date, activity }
│   │     longestActivity: { hours, date, activity }
│   │   }
│   └── updatedAt: timestamp
│
└── goals/{goalId}
    ├── type: 'fitness' | 'health' | 'body_composition' | 'habit'
    ├── metric: string
    ├── targetValue: number
    ├── currentValue: number
    ├── startDate: timestamp
    ├── targetDate: timestamp
    ├── milestones: [{ value, date, achieved }]
    ├── status: 'active' | 'achieved' | 'abandoned'
    └── createdAt: timestamp
```

### 3.2 Indexes Required

```
// Composite indexes for efficient queries
garminData: date DESC (default ordering for dashboard)
healthLog: type ASC, date DESC (filter by type, newest first)
activities: date DESC, type ASC (activity history)
interventions: status ASC, period ASC, date DESC (active interventions by period)
trainingPlans: weekStartDate DESC, status ASC (current plan)
```

---

## 4. Claude AI Integration

### 4.1 AI Engine Cloud Functions

```typescript
// Daily health analysis - runs at 9:00 AM user timezone
export const dailyHealthAnalysis = onSchedule('every day 09:00', async () => {
  const users = await getActiveUsers();
  
  for (const user of users) {
    const context = await buildDailyContext(user.uid);
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: DAILY_ANALYSIS_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify(context)
      }]
    });
    
    const interventions = parseInterventions(response);
    await storeInterventions(user.uid, interventions, 'daily');
  }
});
```

### 4.2 Context Building

```typescript
async function buildDailyContext(uid: string): Promise<HealthContext> {
  const today = new Date();
  const sevenDaysAgo = subDays(today, 7);
  const thirtyDaysAgo = subDays(today, 30);
  
  // Gather comprehensive context
  const [
    todayGarmin,
    weekGarmin,
    recentHealth,
    activeGoals,
    currentPlan,
    userSettings,
    recentInterventions,
    monthTrends
  ] = await Promise.all([
    getGarminData(uid, today),
    getGarminDataRange(uid, sevenDaysAgo, today),
    getHealthLogRange(uid, thirtyDaysAgo, today),
    getActiveGoals(uid),
    getCurrentTrainingPlan(uid),
    getUserSettings(uid),
    getRecentInterventions(uid, 7),
    getTrends(uid, 'month')
  ]);
  
  return {
    user: {
      age: calculateAge(userSettings.dateOfBirth),
      gender: userSettings.gender,
      heightCm: userSettings.heightCm,
      fitnessLevel: userSettings.healthContext.fitnessLevel,
      conditions: userSettings.healthContext.conditions,
      medications: userSettings.healthContext.medications,
      injuries: userSettings.healthContext.injuries,
      goals: userSettings.goals,
      preferences: userSettings.preferences,
    },
    today: todayGarmin,
    weekHistory: weekGarmin,
    manualHealthData: recentHealth,
    activeGoals,
    currentTrainingPlan: currentPlan,
    recentInterventions,  // Avoid repeating same advice
    trends: monthTrends,
    currentDate: today.toISOString(),
    dayOfWeek: format(today, 'EEEE'),
  };
}
```

### 4.3 System Prompts

**Daily Analysis Prompt:**
```
You are a personal health and fitness analyst. You receive comprehensive health 
data from a Garmin wearable and manually logged health metrics. Your role is to:

1. ANALYSE the data for patterns, concerns, and opportunities
2. GENERATE 2-4 prioritised interventions for today
3. ADJUST the current training plan if needed based on recovery metrics

CRITICAL RULES:
- Never diagnose medical conditions. Flag concerning trends for doctor review.
- Blood pressure > 140/90 or < 90/60 → always flag as high priority
- Resting HR change > 10bpm from baseline → flag recovery concern
- HRV declining 3+ days → suggest recovery day
- Sleep score < 60 for 3+ nights → prioritise sleep interventions
- Body battery < 25 at morning → suggest light activity only
- Training readiness score drives today's training intensity

OUTPUT FORMAT (JSON):
{
  "dailySummary": "Brief overview of health status today",
  "interventions": [
    {
      "category": "training|recovery|nutrition|sleep|stress|health_alert",
      "priority": "high|medium|low",
      "title": "Short actionable title",
      "summary": "One-line summary",
      "detail": "Detailed recommendation with specific actions",
      "reasoning": "What data drove this recommendation",
      "dataPoints": [{ "metric": "...", "value": ..., "trend": "..." }],
      "actions": [{ "description": "Specific step to take" }]
    }
  ],
  "trainingAdjustment": null | {
    "affectedSessions": ["tuesday", "wednesday"],
    "reason": "Recovery metrics suggest ...",
    "changes": "Swap Tuesday intervals for easy run..."
  }
}
```

**Weekly Training Plan Prompt:**
```
You are an expert running and fitness coach creating a personalised weekly 
training plan. You receive:
- User profile (age, fitness level, goals, injuries)
- Last 4 weeks of training data and Garmin metrics
- Current fitness trends (VO2 max, training load, recovery)
- Previous week's plan adherence and review
- AVAILABILITY CONSTRAINTS (CRITICAL — plans must fit within these):
  - Total weekly hours budget (hard cap)
  - Day-by-day schedule: which days are available, AM/Mid/PM slot, max duration
  - Designated rest days (never schedule training on rest days)
  - Maximum single session length
  - Sport priorities with ranked allocation (e.g. cycling 60%, running 33%, strength 7%)

PRINCIPLES:
- Progressive overload: max 10% volume increase per week
- Respect recovery: use HRV, training readiness, and sleep data
- Periodisation: vary intensity across the week (hard/easy pattern)
- NEVER exceed the user's stated availability for any day
- NEVER schedule on designated rest days
- Total planned hours MUST be ≤ totalHoursPerWeek budget
- Distribute hours across sports according to sportPriorities ranking
- If a missed session needs redistribution, only fill remaining days
  that have spare capacity (duration < their stated max)
- Include warm-up and cool-down in every session
- Account for injuries and user preferences
- Set realistic pace targets based on recent activity data
- Include at least 1 rest or active recovery day
- For runners: 80/20 rule (80% easy, 20% hard effort)
- Place high-intensity sessions on days with longer availability
- Place easy/recovery sessions on days with shorter windows

OUTPUT FORMAT (JSON):
{
  "weekSummary": "Overview and focus for this week",
  "focusAreas": ["endurance", "speed", "recovery"],
  "totalPlannedMinutes": 540,
  "totalPlannedKm": 45,
  "budgetUsed": { "hours": 9, "budgetMax": 9, "utilisation": "100%" },
  "sportAllocation": {
    "cycling": { "sessions": 3, "hours": 5.25, "tss": 280 },
    "running": { "sessions": 3, "hours": 3.0, "km": 32 },
    "strength": { "sessions": 1, "hours": 0.75 }
  },
  "sessions": [
    {
      "day": "monday",
      "slot": "morning",
      "type": "run",
      "title": "Easy Recovery Run",
      "description": "Gentle pace, focus on form and breathing",
      "durationMinutes": 40,
      "availableMinutes": 90,
      "intensityLevel": "easy",
      "targetHRZone": 2,
      "targetPace": { "min": 330, "max": 360 },
      "targetDistance": 7,
      "warmUp": "5 min walk, dynamic stretches",
      "mainSet": "30 min easy run at conversational pace",
      "coolDown": "5 min walk, static stretches"
    }
  ]
}
```

**Monthly Review Prompt:**
```
You are a health analytics specialist producing a comprehensive monthly health 
review. Analyse 30 days of combined Garmin and manual health data to identify:

1. PROGRESS toward goals (quantified with % and deltas)
2. TRENDS in key metrics (improving/stable/declining + rate of change)
3. CORRELATIONS between behaviours and outcomes
4. RISK FACTORS that need attention
5. RECOMMENDATIONS for the coming month

Focus areas:
- Cardiovascular: resting HR trend, HRV trend, VO2 max progression
- Sleep: quality trends, consistency, impact on recovery
- Body composition: weight trajectory, body fat if available
- Blood pressure: trends, concerning readings, medication effectiveness
- Cholesterol: if new readings, compare to previous
- Training: volume progression, injury risk, performance improvements
- Mental wellness: stress trends, mood correlations, body battery patterns

OUTPUT FORMAT (JSON):
{
  "monthSummary": "Executive summary paragraph",
  "scorecard": {
    "overallHealth": 78,  // 0-100
    "fitness": 82,
    "recovery": 65,
    "nutrition": 70,
    "sleep": 75,
    "stress": 60
  },
  "goalProgress": [...],
  "keyTrends": [...],
  "correlations": [...],
  "riskFactors": [...],
  "nextMonthPlan": {
    "priorities": [...],
    "targets": [...],
    "focusAreas": [...]
  }
}
```

### 4.4 Cost Estimation

| Function | Frequency | Avg Tokens | Cost/Call | Monthly Cost (1 user) |
|---|---|---|---|---|
| Daily Analysis | 1/day | ~3,000 in + 1,000 out | ~$0.02 | ~$0.60 |
| Weekly Plan | 1/week | ~5,000 in + 2,000 out | ~$0.04 | ~$0.16 |
| Monthly Review | 1/month | ~10,000 in + 3,000 out | ~$0.07 | ~$0.07 |
| Ad-hoc queries | ~10/month | ~2,000 in + 500 out | ~$0.01 | ~$0.10 |
| **Total** | | | | **~$0.93/user/month** |

---

## 4A. Cycling Power Analytics & Demographic Comparison

### 4A.1 Coggan Power Profile Reference Data

The app embeds the Coggan/Allen power classification table from "Training and Racing with a Power Meter" for real-time comparison. These are stored as static reference data and used by both the frontend (for gauge rendering) and the AI engine (for contextual recommendations).

**Male FTP W/kg Classifications:**

| Category | FTP W/kg | Racing Equiv | Percentile (approx) |
|---|---|---|---|
| Untrained | 2.00 - 2.49 | Non-racer | 0-20th |
| Fair | 2.50 - 3.04 | Cat 5 | 20-35th |
| Moderate | 3.05 - 3.54 | Cat 4 | 35-50th |
| Good | 3.55 - 4.12 | Cat 3 | 50-70th |
| Very Good | 4.13 - 4.70 | Cat 2 | 70-85th |
| Excellent | 4.71 - 5.27 | Cat 1 | 85-95th |
| Exceptional | 5.28 - 5.82 | Domestic Pro | 95-99th |
| World Class | 5.83 - 6.40 | International Pro | 99th+ |

**Female FTP W/kg Classifications:**

| Category | FTP W/kg | Racing Equiv | Percentile (approx) |
|---|---|---|---|
| Untrained | 1.58 - 1.90 | Non-racer | 0-20th |
| Fair | 1.91 - 2.35 | Cat 4 | 20-35th |
| Moderate | 2.36 - 2.81 | Cat 3 | 35-50th |
| Good | 2.82 - 3.27 | Cat 2 | 50-70th |
| Very Good | 3.28 - 3.59 | Cat 1 | 70-85th |
| Excellent | 3.60 - 4.12 | Domestic Pro | 85-95th |
| Exceptional | 4.13 - 4.64 | National | 95-99th |
| World Class | 4.65 - 5.69 | International Pro | 99th+ |

### 4A.2 Full Power Profile Durations (Coggan Male W/kg)

| Category | 5-sec | 1-min | 5-min | FTP |
|---|---|---|---|---|
| World Class | 24.04-26.07 | 11.50-12.91 | 7.60-8.47 | 5.83-6.40 |
| Exceptional | 22.36-23.68 | 10.44-11.32 | 6.81-7.50 | 5.28-5.82 |
| Excellent | 20.57-22.13 | 9.29-10.33 | 6.04-6.72 | 4.71-5.27 |
| Very Good | 18.27-20.35 | 8.06-9.18 | 5.26-5.96 | 4.13-4.70 |
| Good | 15.83-18.04 | 6.80-7.94 | 4.52-5.18 | 3.55-4.12 |
| Moderate | 13.38-15.61 | 5.54-6.68 | 3.78-4.44 | 3.05-3.54 |
| Fair | 10.87-13.16 | 4.24-5.42 | 3.04-3.70 | 2.50-3.04 |
| Untrained | 8.00-10.64 | 2.89-4.12 | 2.30-2.96 | 2.00-2.49 |

### 4A.3 Age-Adjusted Performance Calculation

FTP naturally declines with age (~5-8% per decade from mid-30s). The app computes an age-adjusted score:

```typescript
function calculateAgeAdjustedFTP(ftp: number, age: number): {
  adjustedFTP: number;
  agePerformanceIndex: number;
} {
  // Decline factors based on published research
  // Peak performance typically 25-35 years
  const peakAge = 30;
  const declinePerYear = age > 35 ? 0.007 : 0; // 0.7% per year after 35
  const yearsFromPeak = Math.max(0, age - peakAge);
  const ageFactor = 1 + (yearsFromPeak * declinePerYear);
  
  // Age-adjusted FTP = what your current FTP would equate to at peak age
  const adjustedFTP = ftp * ageFactor;
  
  // Age performance index: how you compare vs expected for your age
  // 100 = average for age, >100 = above average, <100 = below
  const expectedDecline = 1 - (yearsFromPeak * declinePerYear);
  const expectedFTPForAge = ftp / expectedDecline;
  const agePerformanceIndex = (ftp / expectedFTPForAge) * 100;
  
  return { adjustedFTP, agePerformanceIndex };
}
```

### 4A.4 Performance Management Chart (PMC) Computation

The PMC uses Chronic Training Load (CTL), Acute Training Load (ATL), and Training Stress Balance (TSB) to model fitness, fatigue, and form:

```typescript
// Computed daily via scheduled Cloud Function
async function computePMC(uid: string): Promise<void> {
  const activities = await getLast90DaysActivities(uid, 'cycling');
  
  // TSS per day (sum of all activities)
  const dailyTSS = aggregateDailyTSS(activities);
  
  let ctl = 0; // Chronic Training Load (fitness) — 42-day exponential avg
  let atl = 0; // Acute Training Load (fatigue) — 7-day exponential avg
  const history = [];
  
  for (const day of dailyTSS) {
    const tss = day.totalTSS;
    ctl = ctl + (tss - ctl) / 42;    // 42-day time constant
    atl = atl + (tss - atl) / 7;     // 7-day time constant
    const tsb = ctl - atl;           // Training Stress Balance (form)
    
    history.push({ date: day.date, ctl, atl, tsb, tss });
  }
  
  await updateCyclingProfile(uid, { ctl, atl, tsb: ctl - atl, history });
}

// TSS calculation for individual rides
function calculateTSS(normalizedPower: number, durationSeconds: number, ftp: number): number {
  const intensityFactor = normalizedPower / ftp;
  return (durationSeconds * normalizedPower * intensityFactor) / (ftp * 3600) * 100;
}
```

### 4A.5 Activity Stats Aggregation (History)

Pre-computed statistics for fast history views. Triggered when activities are synced and runs on a nightly schedule to catch any gaps:

```typescript
// Triggered on activity write + nightly scheduled function
export const computeActivityStats = onDocumentWritten(
  'users/{uid}/activities/{activityId}',
  async (event) => {
    const uid = event.params.uid;
    const activity = event.data?.after.data();
    if (!activity) return;
    
    // Recompute the affected week and month
    const date = activity.date.toDate();
    const weekKey = `week-${format(date, 'yyyy')}-${getISOWeek(date).toString().padStart(2, '0')}`;
    const monthKey = `month-${format(date, 'yyyy-MM')}`;
    const yearKey = `year-${format(date, 'yyyy')}`;
    
    await Promise.all([
      recomputePeriodStats(uid, weekKey, 'week', startOfISOWeek(date), endOfISOWeek(date)),
      recomputePeriodStats(uid, monthKey, 'month', startOfMonth(date), endOfMonth(date)),
      recomputePeriodStats(uid, yearKey, 'year', startOfYear(date), endOfYear(date)),
      updateLifetimeStats(uid, activity),
    ]);
  }
);

async function recomputePeriodStats(
  uid: string, 
  periodKey: string, 
  periodType: 'week' | 'month' | 'year',
  startDate: Date, 
  endDate: Date
): Promise<void> {
  // Fetch all activities in the period
  const activities = await db
    .collection(`users/${uid}/activities`)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();
  
  // Initialize aggregation buckets
  const totals = { activityCount: 0, durationSeconds: 0, calories: 0, 
                   distanceMeters: 0, elevationGainM: 0, tss: 0, work: 0 };
  
  const bySport: Record<string, SportStats> = {};
  const dailyMap: Record<string, DayBreakdown> = {};
  
  for (const doc of activities.docs) {
    const act = doc.data();
    const sportKey = normaliseSportType(act.type); // 'running'|'cycling'|'swimming'|'strength'|'other'
    const dayKey = format(act.date.toDate(), 'yyyy-MM-dd');
    
    // Accumulate totals
    totals.activityCount++;
    totals.durationSeconds += act.durationSeconds || 0;
    totals.calories += act.calories || 0;
    totals.distanceMeters += act.distanceMeters || 0;
    totals.elevationGainM += act.elevationGain || 0;
    
    if (act.cycling?.trainingStressScore) {
      totals.tss += act.cycling.trainingStressScore;
    }
    if (act.cycling?.work) {
      totals.work += act.cycling.work;
    }
    
    // Accumulate per-sport
    if (!bySport[sportKey]) {
      bySport[sportKey] = initSportStats(sportKey);
    }
    accumulateSportStats(bySport[sportKey], act, sportKey);
    
    // Accumulate daily breakdown
    if (!dailyMap[dayKey]) {
      dailyMap[dayKey] = { 
        date: dayKey, 
        dayLabel: format(act.date.toDate(), 'EEE'),
        activities: [], 
        totalDurationSeconds: 0, 
        totalCalories: 0 
      };
    }
    dailyMap[dayKey].activities.push({
      type: act.type,
      durationSeconds: act.durationSeconds || 0,
      calories: act.calories || 0,
      distanceKm: (act.distanceMeters || 0) / 1000,
    });
    dailyMap[dayKey].totalDurationSeconds += act.durationSeconds || 0;
    dailyMap[dayKey].totalCalories += act.calories || 0;
  }
  
  // Compute period-over-period comparison (e.g. this week vs last week)
  const prevPeriodKey = getPreviousPeriodKey(periodKey, periodType);
  const prevStats = await db.doc(`users/${uid}/activityStats/${prevPeriodKey}`).get();
  const comparison = prevStats.exists ? {
    prevPeriodKey,
    durationChange: percentChange(totals.durationSeconds, prevStats.data()!.totals.durationSeconds),
    caloriesChange: percentChange(totals.calories, prevStats.data()!.totals.calories),
    distanceChange: percentChange(totals.distanceMeters, prevStats.data()!.totals.distanceMeters),
    activityCountChange: percentChange(totals.activityCount, prevStats.data()!.totals.activityCount),
  } : null;
  
  // Compute year-over-year comparison (e.g. W6-2026 vs W6-2025, Jan-2026 vs Jan-2025)
  const priorYearPeriodKey = getSameperiodPriorYearKey(periodKey, periodType);
  const priorYearStats = await db.doc(`users/${uid}/activityStats/${priorYearPeriodKey}`).get();
  const yoyComparison = priorYearStats.exists ? {
    priorYearPeriodKey,
    hasPriorYearData: true,
    priorYear: {
      durationHours: priorYearStats.data()!.totals.durationHours || 0,
      calories: priorYearStats.data()!.totals.calories || 0,
      distanceKm: priorYearStats.data()!.totals.distanceKm || 0,
      activityCount: priorYearStats.data()!.totals.activityCount || 0,
      bySport: extractPriorYearSportTotals(priorYearStats.data()!.bySport),
    },
    changes: {
      durationChange: percentChange(totals.durationSeconds, priorYearStats.data()!.totals.durationSeconds),
      caloriesChange: percentChange(totals.calories, priorYearStats.data()!.totals.calories),
      distanceChange: percentChange(totals.distanceMeters / 1000, priorYearStats.data()!.totals.distanceKm),
      activityCountChange: percentChange(totals.activityCount, priorYearStats.data()!.totals.activityCount),
    },
    sportChanges: computeSportYoYChanges(bySport, priorYearStats.data()!.bySport),
  } : { priorYearPeriodKey, hasPriorYearData: false, priorYear: null, changes: null, sportChanges: null };
  
  // Write the computed stats
  await db.doc(`users/${uid}/activityStats/${periodKey}`).set({
    periodType,
    periodLabel: formatPeriodLabel(periodKey, periodType),
    startDate,
    endDate,
    totals: { ...totals, durationHours: totals.durationSeconds / 3600, distanceKm: totals.distanceMeters / 1000 },
    bySport,
    dailyBreakdown: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    comparison,
    yoyComparison,
    computedAt: new Date(),
    computedFrom: activities.size,
  }, { merge: true });
}

// Helper: Get the same period key from the prior year
// "week-2026-06" → "week-2025-06", "month-2026-02" → "month-2025-02", "year-2026" → "year-2025"
function getSameperiodPriorYearKey(periodKey: string, periodType: string): string {
  const parts = periodKey.split('-');
  if (periodType === 'year') {
    return `year-${parseInt(parts[1]) - 1}`;
  } else if (periodType === 'month') {
    return `month-${parseInt(parts[1]) - 1}-${parts[2]}`;
  } else {
    // week: "week-2026-06" → "week-2025-06"
    return `week-${parseInt(parts[1]) - 1}-${parts[2]}`;
  }
}

function extractPriorYearSportTotals(bySport: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [sport, stats] of Object.entries(bySport || {})) {
    const s = stats as any;
    result[sport] = {
      durationHours: s.durationHours || 0,
      calories: s.calories || 0,
      distanceKm: s.distanceKm || 0,
      activityCount: s.activityCount || 0,
    };
  }
  return result;
}

function computeSportYoYChanges(
  currentBySport: Record<string, any>,
  priorBySport: Record<string, any>
): Record<string, any> {
  const changes: Record<string, any> = {};
  const allSports = new Set([...Object.keys(currentBySport), ...Object.keys(priorBySport || {})]);
  
  for (const sport of allSports) {
    const cur = currentBySport[sport] || {};
    const prev = (priorBySport || {})[sport] || {};
    changes[sport] = {
      durationChange: percentChange(cur.durationHours || 0, prev.durationHours || 0),
      caloriesChange: percentChange(cur.calories || 0, prev.calories || 0),
      distanceChange: percentChange(cur.distanceKm || 0, prev.distanceKm || 0),
    };
  }
  return changes;
}

// Incremental lifetime stats update (avoids full recomputation)
async function updateLifetimeStats(uid: string, activity: any): Promise<void> {
  const sportKey = normaliseSportType(activity.type);
  const ref = db.doc(`users/${uid}/lifetimeStats`);
  
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const stats = doc.exists ? doc.data()! : initLifetimeStats();
    
    stats.totalActivities++;
    stats.totalDurationHours += (activity.durationSeconds || 0) / 3600;
    stats.totalCalories += activity.calories || 0;
    stats.totalDistanceKm += (activity.distanceMeters || 0) / 1000;
    stats.totalElevationGainM += activity.elevationGain || 0;
    
    // Update sport-specific totals
    const sport = stats.bySport[sportKey] || { count: 0, hours: 0, km: 0, calories: 0 };
    sport.count++;
    sport.hours += (activity.durationSeconds || 0) / 3600;
    sport.km += (activity.distanceMeters || 0) / 1000;
    sport.calories += activity.calories || 0;
    if (sportKey === 'cycling' && activity.cycling) {
      sport.tss = (sport.tss || 0) + (activity.cycling.trainingStressScore || 0);
      sport.kj = (sport.kj || 0) + (activity.cycling.work || 0);
    }
    stats.bySport[sportKey] = sport;
    
    // Check personal records
    updatePersonalRecords(stats.personalRecords, activity, sportKey);
    
    stats.updatedAt = new Date();
    tx.set(ref, stats, { merge: true });
  });
}
```
```

### 4A.5 Cycling-Specific AI Prompts

**Cycling Power Analysis (added to daily analysis context):**
```
CYCLING POWER CONTEXT:
When cycling data with power metrics is available, include in your analysis:

1. FTP PROGRESSION: Track W/kg trend over time. Flag if:
   - FTP has improved >5% in 4 weeks (celebrate + ensure recovery)
   - FTP has declined >5% without explanation (overtraining? illness?)
   - FTP test is overdue (>8 weeks since last test/update)

2. DEMOGRAPHIC COMPARISON: User's Coggan category and percentile.
   Provide motivating context like:
   - "Your FTP of 3.8 W/kg puts you in the 'Good' category — Cat 3 level"
   - "You're in the top 35% of male cyclists your age"
   - "To reach 'Very Good' (Cat 2), you need to gain 0.33 W/kg"
   Never be discouraging. Frame gaps as achievable targets.

3. TRAINING LOAD BALANCE (PMC):
   - CTL trending up = fitness improving
   - ATL much higher than CTL = accumulated fatigue risk
   - TSB < -30 = high injury/burnout risk, recommend recovery
   - TSB between -10 and +10 = good form for racing/events
   - TSB > 20 = detraining, suggest stimulus

4. POWER ZONE DISTRIBUTION: Analyse time-in-zone across recent rides.
   - Too much Zone 3 (tempo) = "polarised training gap"
   - Not enough Zone 2 = insufficient base building
   - Excessive Zone 5+ without recovery = overtraining risk
   - Target 80/20 rule: 80% Zone 1-2, 20% Zone 4+

5. EFFICIENCY METRICS:
   - Efficiency Factor (NP/HR) improving = aerobic gains
   - Variability Index (NP/avg power) > 1.15 = very variable ride
   - L/R balance > 53/47 = significant imbalance, suggest drills
   - Pedal smoothness declining = fatigue indicator

6. POWER PROFILE SHAPE:
   - Strong 5s but weak FTP = "sprinter" profile, build endurance
   - Strong FTP but weak 1min = "diesel" profile, add anaerobic work
   - Even across durations = "all-rounder", maintain balance
   
OUTPUT: Include a "Cycling Performance" section in daily/weekly 
interventions when ride data is present.
```

**Weekly Cycling Plan Extension:**
```
CYCLING-SPECIFIC TRAINING PLAN RULES:
When generating weekly plans that include cycling sessions:

1. Use FTP-based power zones for all intensity targets:
   - Zone 1 (Recovery): < 55% FTP
   - Zone 2 (Endurance): 56-75% FTP  
   - Zone 3 (Tempo): 76-90% FTP
   - Zone 4 (Threshold): 91-105% FTP
   - Zone 5 (VO2 Max): 106-120% FTP
   - Zone 6 (Anaerobic): 121-150% FTP

2. Express cycling sessions with BOTH:
   - Duration + target power zones (e.g. "2x20min at Zone 4 (250-275W)")
   - TSS target for the session (e.g. "Target TSS: 85")

3. Weekly TSS progression:
   - Increase CTL by max 5-7 TSS/week (ramp rate)
   - 3 weeks build → 1 week recovery cycle
   - Recovery week = 40-60% of build week TSS

4. Include power-specific workout types:
   - Sweet spot intervals (88-93% FTP) for FTP building
   - Over-under intervals (95/105% FTP) for threshold tolerance
   - VO2 max intervals (3-5min at 106-120% FTP)
   - Endurance rides (Zone 2, NP < 75% FTP)
   - Sprint intervals (10-30s at >150% FTP) for neuromuscular

5. For each cycling session, output:
   {
     "type": "cycle",
     "title": "Sweet Spot Intervals",
     "durationMinutes": 75,
     "targetTSS": 72,
     "intensityLevel": "moderate",
     "targetPowerZone": 3-4,
     "warmUp": "15 min progressive build to Zone 2",
     "mainSet": "3 x 12 min at 88-93% FTP (240-255W) with 4 min Zone 1 recovery",
     "coolDown": "10 min easy spin Zone 1",
     "targetNP": 225,
     "targetIF": 0.82
   }
```

---

## 5. Frontend Architecture

### 5.1 Screen Map

```
┌─────────────────────────────────────────────────────────┐
│                    APP NAVIGATION                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📊 Dashboard (Home)                                     │
│  ├── Today's Health Snapshot                             │
│  │   ├── Body Battery gauge                             │
│  │   ├── Sleep score (last night)                       │
│  │   ├── Resting HR + HRV                               │
│  │   ├── Steps / Active minutes                         │
│  │   └── Training readiness indicator                   │
│  ├── Today's Interventions (cards)                      │
│  ├── Today's Training Session (from weekly plan)        │
│  └── Quick-log buttons (weight, BP, mood)               │
│                                                         │
│  📝 Health Log                                           │
│  ├── Date Selector (shared across all entry types)      │
│  │   ├── Defaults to today                              │
│  │   ├── Prev/Next day buttons                          │
│  │   ├── Tap to open native date picker                 │
│  │   ├── Cannot select future dates                     │
│  │   └── "Today" quick-reset button when on past date   │
│  ├── Quick Entry (weight, BP, glucose, mood)            │
│  ├── Full Entry (cholesterol, labs, nutrition, etc.)     │
│  ├── Entry History (filterable timeline)                │
│  └── Photo Capture (lab results)                        │
│                                                         │
│  🏃 Training                                             │
│  ├── This Week's Plan (day-by-day cards)                │
│  ├── Today's Session (expandable detail)                │
│  ├── Activity History (from Garmin)                     │
│  ├── Plan Adherence tracker                             │
│  └── Generate New Plan (on-demand)                      │
│                                                         │
│  🚴 Cycling Power                                        │
│  ├── Power Dashboard                                    │
│  │   ├── Current FTP (watts + W/kg)                     │
│  │   ├── Coggan Category gauge (where you sit)          │
│  │   ├── Percentile rank vs age/gender                  │
│  │   └── "Next level" target indicator                  │
│  ├── Power Profile (Coggan radar chart)                 │
│  │   ├── 5s / 1min / 5min / FTP spider chart            │
│  │   ├── Category overlay on each duration              │
│  │   └── Rider type indicator (sprinter/climber/TT)     │
│  ├── FTP History (progression chart)                    │
│  │   ├── FTP watts over time                            │
│  │   ├── W/kg over time (weight-adjusted)               │
│  │   └── Category boundary lines                        │
│  ├── Performance Management Chart (PMC)                 │
│  │   ├── CTL (fitness) line                             │
│  │   ├── ATL (fatigue) line                             │
│  │   ├── TSB (form) area                                │
│  │   └── Ramp rate indicator                            │
│  ├── Recent Rides Power Summary                         │
│  │   ├── NP, IF, TSS, kJ per ride                       │
│  │   ├── Power zone distribution stacked bars           │
│  │   ├── Efficiency Factor trend                        │
│  │   └── L/R balance indicator (if available)           │
│  └── Demographic Comparison                             │
│      ├── "You vs Age Group" bar chart                   │
│      ├── Coggan table with your position highlighted    │
│      ├── Age-adjusted performance score                 │
│      └── Percentile rankings across durations           │
│                                                         │
│  📈 Insights & Trends                                    │
│  ├── Metric Explorer (select any metric, view trend)    │
│  ├── Monthly Review Report                              │
│  ├── Goal Progress                                      │
│  ├── Correlations (AI-discovered)                       │
│  └── Historical Comparisons                             │
│                                                         │
│  📅 History                                              │
│  ├── Period Selector (week / month / year)              │
│  ├── Date Navigation (prev/next + date picker)          │
│  ├── Sport Filter (All / Running / Cycling / Swimming   │
│  │                  / Strength / Other)                  │
│  ├── Summary Cards                                      │
│  │   ├── Total Training Hours (big hero number)         │
│  │   ├── Total Calories Burned                          │
│  │   ├── Total Distance (km)                            │
│  │   ├── Activity Count                                 │
│  │   └── Period-over-period change (% vs previous)      │
│  ├── Daily Breakdown Bar Chart                          │
│  │   ├── Stacked bars (sport-coloured) per day          │
│  │   ├── Toggle: hours / calories / distance            │
│  │   └── Tap bar for day detail                         │
│  ├── Sport Distribution                                 │
│  │   ├── Donut chart (% time per sport)                 │
│  │   └── Per-sport stat cards                           │
│  ├── Trend Comparison                                   │
│  │   ├── Multi-period overlay (this week vs last)       │
│  │   ├── Month-over-month progression bars              │
│  │   └── Year-to-date cumulative line                   │
│  ├── Lifetime Stats Banner                              │
│  │   ├── Total hours ever / total km / total calories   │
│  │   ├── Current streak / longest streak                │
│  │   └── Personal records                               │
│  └── Activity List                                      │
│      ├── Filterable by sport + date range               │
│      ├── Sort by date / duration / distance / calories  │
│      └── Tap for full activity detail                   │
│                                                         │
│  ⚙️ Settings                                             │
│  ├── Garmin Connection (connect/disconnect)             │
│  ├── Power Meter (type, FTP source, auto-detect)        │
│  ├── Training Goals                                     │
│  │   ├── Primary goal selector (single)                 │
│  │   ├── Secondary goals (multi-select)                 │
│  │   ├── Numeric targets: FTP, W/kg, weight, running    │
│  │   │   km, cycling TSS, sleep hours                   │
│  │   └── AI uses these to set plan intensity & focus    │
│  ├── Weekly Availability                                │
│  │   ├── Total hours slider (2-20h, drives budget)      │
│  │   ├── Day-by-day schedule                            │
│  │   │   ├── Time slot per day (AM / Mid / PM / Rest)   │
│  │   │   ├── Duration per day (editable)                │
│  │   │   └── Typical session label (read-only, AI-set)  │
│  │   ├── Max single session length                      │
│  │   ├── Preferred rest days per week                   │
│  │   └── AI explainer: "Plans respect your time slots"  │
│  ├── Sport Priorities (drag-to-rank)                    │
│  │   ├── Ranked list of active sports                   │
│  │   ├── Allocated hours + percentage per sport         │
│  │   ├── Add sport button                               │
│  │   └── AI distributes hours proportionally by rank    │
│  ├── Profile (DOB, height, health context)              │
│  ├── Health Context (conditions, medications)           │
│  ├── Notification Preferences                           │
│  └── Data Export                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Component Architecture

```
src/
├── app/
│   ├── layout.tsx
│   └── (routes)/
│       ├── dashboard/
│       ├── health-log/
│       ├── training/
│       ├── insights/
│       └── settings/
├── components/
│   ├── dashboard/
│   │   ├── BodyBatteryGauge.tsx
│   │   ├── SleepScoreCard.tsx
│   │   ├── HeartRateCard.tsx
│   │   ├── StepsCard.tsx
│   │   ├── TrainingReadinessIndicator.tsx
│   │   ├── InterventionCard.tsx
│   │   ├── TodaySessionCard.tsx
│   │   └── QuickLogBar.tsx
│   ├── health-log/
│   │   ├── QuickEntryForm.tsx
│   │   ├── FullEntryForm.tsx
│   │   ├── EntryTimeline.tsx
│   │   ├── MetricInput.tsx     // Reusable: number + unit + validation
│   │   └── LabPhotoCapture.tsx
│   ├── training/
│   │   ├── WeeklyPlanView.tsx
│   │   ├── SessionDetailCard.tsx
│   │   ├── ActivityHistory.tsx
│   │   ├── AdherenceTracker.tsx
│   │   └── PlanGenerator.tsx
│   ├── insights/
│   │   ├── MetricExplorer.tsx
│   │   ├── TrendChart.tsx
│   │   ├── MonthlyReport.tsx
│   │   ├── GoalProgressCard.tsx
│   │   └── CorrelationInsight.tsx
│   ├── shared/
│   │   ├── MetricCard.tsx
│   │   ├── TrendArrow.tsx
│   │   ├── DateRangePicker.tsx
│   │   └── LoadingSkeleton.tsx
│   └── charts/
│       ├── SparkLine.tsx
│       ├── AreaChart.tsx
│       ├── BarChart.tsx
│       └── GaugeChart.tsx
├── hooks/
│   ├── useGarminData.ts
│   ├── useHealthLog.ts
│   ├── useTrainingPlan.ts
│   ├── useInterventions.ts
│   ├── useTrends.ts
│   └── useGoals.ts
├── lib/
│   ├── firebase.ts
│   ├── garmin.ts
│   ├── ai.ts
│   └── validation.ts
└── types/
    ├── garmin.ts
    ├── health.ts
    ├── training.ts
    └── interventions.ts
```

---

## 6. Agent Workflow

This project uses Nick's 13-agent Claude Code workflow. Here is the execution plan:

### Phase 1: Architecture & Design (Week 1-2)

| Step | Agent | Task |
|---|---|---|
| 1.1 | **architect** | Review this document, validate data model for analytics, challenge Garmin data structure for query efficiency, ensure trend computation is optimised |
| 1.2 | **architect** | Design the AI prompt pipeline — ensure context building queries are efficient, design the intervention feedback loop |
| 1.3 | **design-ui-ux** | Design all screens — mobile-first PWA, dashboard layout, health log entry UX, training plan views, chart interactions |
| 1.4 | **behavioral-science-nudge** | Review intervention delivery — when/how to nudge, notification psychology, habit loop design for daily logging, gamification of plan adherence |

### Phase 2: Data Layer (Week 3-4)

| Step | Agent | Task |
|---|---|---|
| 2.1 | **firestore-specialist** | Implement data model, optimise indexes, design aggregation strategy for trends collection, implement denormalisation for dashboard performance |
| 2.2 | **functions-specialist** | Build Garmin sync pipeline (Garth login, scheduled pull, backfill tasks), AI analysis engine, data processing |
| 2.3 | **functions-specialist** | Build AI engine functions — context builder, daily/weekly/monthly analysis, training plan generator |
| 2.4 | **security-rules** | Write Firestore rules — users can only access own data, Garmin tokens encrypted, health data GDPR compliant |

### Phase 3: Security & Compliance (Week 5)

| Step | Agent | Task |
|---|---|---|
| 3.1 | **security-dos-protection** | Rate limit Garmin sync calls, protect AI endpoints from abuse, implement AES-256-GCM encryption for Garth session tokens |
| 3.2 | **gdpr** | Health data is sensitive — implement consent flows, data export, right to deletion, retention policies, encryption at rest |

### Phase 4: Frontend Build (Week 6-8)

| Step | Agent | Task |
|---|---|---|
| 4.1 | **design-ui-ux** | Build dashboard components — gauges, cards, sparklines, intervention cards |
| 4.2 | **functions-specialist** | Wire up Garmin data hooks, real-time listeners for health log |
| 4.3 | **behavioral-science-nudge** | Review completed UI — are interventions compelling? Is logging friction-free? Does training plan view motivate? |
| 4.4 | **code-review** | Full code review before security hardening |

### Phase 5: Optimisation (Week 9-10)

| Step | Agent | Task |
|---|---|---|
| 5.1 | **performance** | Optimise dashboard load — ensure Garmin data renders fast, charts lazy-load, offline caching for PWA |
| 5.2 | **architect** | Review complete implementation — data flow, AI pipeline efficiency, query patterns |

### Phase 6: Testing & Deployment (Week 11-12)

| Step | Agent | Task |
|---|---|---|
| 6.1 | **qa-e2e-testing** | E2E tests — Garmin connection flow, health log CRUD, training plan generation, intervention display |
| 6.2 | **devops-cicd** | CI/CD pipeline — GitHub Actions, Firebase preview deployments, environment management |
| 6.3 | **observability** | Logging for Garmin sync failures, AI function monitoring, error tracking with Sentry, health data audit trail |

---

## 7. Garmin Data Integration — Garth Library

VitalSync uses the **Garth** open-source library (and its `garminconnect` Python wrapper) to access Garmin Connect data. This is the same OAuth 2.0 SSO authentication flow used by the official Garmin Connect mobile app.

### Why Not the Official Garmin Connect Developer Program?

The official Garmin API programme is enterprise-only, requires a business application, and small/indie developers frequently report being ghosted or rejected. The Health API also requires a commercial licence fee for production use. For a personal-scale app like VitalSync, this is unnecessary overhead.

### Libraries Used

| Library | Role | Language |
|---|---|---|
| **garth** (`pip install garth`) | OAuth 2.0 authentication with Garmin SSO, token management, auto-refresh | Python |
| **garminconnect** (`pip install garminconnect`) | 105+ API method wrapper around Garth — health, activity, device data | Python |
| **fitdecode** (`pip install fitdecode`) | Parse FIT binary files for granular activity data (power, GPS, cadence) | Python |

### Cloud Function Architecture (Python Runtime)

Firebase Cloud Functions 2nd gen supports **Python** runtimes, which is essential since Garth is a Python library. The Garmin sync functions are deployed as Python Cloud Functions:

```
functions/
├── python/
│   ├── garmin_login.py          # Initial authentication
│   ├── garmin_sync.py           # Scheduled + on-demand data pull
│   ├── garmin_backfill.py       # Historical data fetch (chunked)
│   ├── garmin_activity_detail.py # FIT file download & parse
│   └── requirements.txt         # garth, garminconnect, fitdecode, firebase-admin
├── typescript/
│   ├── ai_engine.ts             # Claude AI analysis
│   ├── scheduled_jobs.ts        # Daily digest, weekly plan, monthly review
│   └── ...
```

### Token Storage & Security

Garth sessions are serialised and encrypted before storage:

```python
# After successful login
garth_session = garth.client.dumps()  # JSON string with OAuth2 tokens

# Encrypt with AES-256-GCM before storing in Firestore
encrypted = encrypt_aes256(garth_session, key_from_secret_manager)
db.document(f'users/{uid}/settings').update({
    'garmin.garthSession': encrypted,
    'garmin.connected': True,
    'garmin.lastSyncAt': firestore.SERVER_TIMESTAMP,
})

# To restore session later
garth.resume(decrypt_aes256(encrypted_session, key))
client = Garmin()
client.garth = garth.client
# Ready to make API calls — Garth auto-refreshes expired tokens
```

### Risk Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Garmin breaks the unofficial API | Sync stops until library is updated | Manual health logging still works; `garminconnect` is actively maintained (105+ contributors) |
| OAuth token expires | Temporary auth failure | Garth auto-refreshes; if refresh fails, prompt user to re-enter credentials |
| Rate limiting | API calls throttled | 15-min sync interval is conservative; exponential backoff on 429 responses |
| Garmin blocks Garth's user agent | Full API access lost | Library maintainers typically adapt within days; VitalSync stores all historical data locally |

### Future: Official API Migration Path

If VitalSync scales beyond personal use, the architecture supports clean migration:
1. Apply to Garmin Connect Developer Program (as Inrange or separate entity)
2. Replace Garth pull functions with official webhook push handlers
3. Data model stays identical — Firestore collections don't change
4. Add official backfill API calls alongside existing pull-based backfill

---

## 8. Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Data storage** | Firestore with daily document pattern | One document per day is efficient for dashboard reads, keeps under 1MB limit |
| **Garmin sync** | Pull (scheduled every 15 min + on-demand) | Garth library — no enterprise API approval needed, 105+ endpoints, same OAuth2 as Garmin Connect app |
| **AI model** | Claude Sonnet 4.5 | Best cost/quality ratio for structured health analysis at ~$0.93/user/month |
| **AI output format** | Structured JSON | Deterministic parsing, easy to render in UI, feedback loop possible |
| **Trend computation** | Pre-computed + on-demand | Pre-compute common trends (7d, 30d) via scheduled function; compute custom ranges on demand |
| **Frontend** | React PWA + Tailwind | Offline capability for logging, installable on mobile, fast iteration |
| **Charts** | Recharts | Lightweight, React-native, good for health visualisations |
| **Garmin auth tokens** | Garth OAuth2 session encrypted (AES-256-GCM) in Firestore | Garth auto-refreshes tokens; encrypted at rest via Secret Manager key; never exposed to client |
| **Health data classification** | GDPR special category | Health data requires explicit consent, encryption, audit trails, deletion capability |

---

## 9. Implementation Priorities (MVP)

### MVP (Weeks 1-6)
1. ✅ Garmin connection + daily data sync
2. ✅ Dashboard with today's health snapshot
3. ✅ Manual health log (weight, BP, mood)
4. ✅ Daily AI interventions
5. ✅ Weekly training plan generation

### V1.1 (Weeks 7-10)
6. Full health log (cholesterol, labs, nutrition)
7. Trend charts and metric explorer
8. Monthly review reports
9. Goal tracking with milestones
10. Training plan adherence tracking

### V1.2 (Weeks 11-14)
11. Correlation discovery (AI finds patterns)
12. Lab photo capture + OCR
13. Push notifications for interventions
14. Data export (PDF reports)
15. Offline PWA capability

---

## 10. Getting Started — Agent Commands

```bash
# Step 1: Architecture review
claude "Use architect to review the VitalSync architecture document at 
docs/architecture.md — validate data model for Garmin + manual health 
data analytics, challenge the AI context building approach, and ensure 
Firestore queries support the dashboard and trend views efficiently"

# Step 2: UI/UX Design  
claude "Use design-ui-ux to design mobile-first screens for the VitalSync 
dashboard, health log entry flow, and weekly training plan view. Focus on 
health metric visualisation with gauges, sparklines, and intervention cards"

# Step 3: Behavioral review
claude "Use behavioral-science-nudge to review the VitalSync intervention 
delivery system — optimise for daily logging habit formation, training plan 
adherence motivation, and intervention engagement without notification fatigue"

# Step 4: Data layer
claude "Use firestore-specialist to implement the VitalSync data model from 
docs/architecture.md — focus on garminData, healthLog, and interventions 
collections with optimised indexes for dashboard and trend queries"

# Step 5: Cloud Functions
claude "Use functions-specialist to build the Garmin sync pipeline — Garth login 
Cloud Function, scheduled 15-min pull, backfill tasks, and the Claude AI daily analysis 
function with context builder"
```

---

## 8. Brand Identity & Millennial Design System

### 8.1 Brand Positioning

**Name:** VitalSync
**Tagline:** "Your body. Your data. Your edge."
**Voice:** Confident but approachable. Data-driven but human. Like a coach who respects that you're smart enough to read your own numbers — they just make the numbers easier to understand.

**Brand Pillars:**
- **Precision without overwhelm** — complex data, clean surfaces
- **Earned confidence** — celebrate consistency, not perfection
- **Personal intelligence** — AI that knows *you*, not generic advice

**Competitive position:** Sits between WHOOP's elite-performance intensity and Oura's calm minimalism. VitalSync is for the millennial who trains hard, geeks out on data, but also cares about sleep, stress, and long-term health. It doesn't shout at you to train harder — it tells you *when* you're ready and *why*.

### 8.2 Visual Design System

#### Colour Palette

```
PRIMARY
─────────────────────────────────────────────
Midnight        #0F172A   Background, depth layers
Slate Deep      #1E293B   Card backgrounds, elevated surfaces
Slate Mid       #334155   Borders, dividers, inactive states

ACCENT (The "Vital" gradient)
─────────────────────────────────────────────
Emerald         #10B981   Primary action, positive trends, health
Cyan            #06B6D4   Secondary accent, cycling, data highlights
Gradient        emerald→cyan (135deg) for CTAs, progress arcs, hero metrics

SEMANTIC
─────────────────────────────────────────────
Amber           #F59E0B   Warnings, fatigue, caution states
Rose            #F43F5E   Negative trends, high strain, alerts
Violet          #8B5CF6   Sleep, recovery, AI insights
White           #F8FAFC   Primary text on dark
Slate Light     #94A3B8   Secondary text, labels, captions

SPORT-SPECIFIC
─────────────────────────────────────────────
Running         #34D399   Emerald green
Cycling         #06B6D4   Cyan
Swimming        #3B82F6   Blue
Strength        #F97316   Orange
Other           #A78BFA   Violet
```

#### Typography

```
HEADINGS    Inter or SF Pro Display — Semi-bold/Bold
            Tight tracking (-0.02em), clean geometric forms

BODY        Inter or SF Pro Text — Regular/Medium
            16px base, 1.5 line height

NUMBERS     JetBrains Mono or SF Mono — Medium
            For metrics, stats, power numbers — monospace gives
            the "data dashboard" feel millennials associate with
            premium fitness tech (WHOOP, Strava, TrainingPeaks)

HERO METRIC 48-64px, Bold, -0.03em tracking
            The big number at the top of each card. This is
            the single most important design element — the
            number you glance at to know if you're on track.
```

#### Design Principles

**1. Dark-first, not dark-only**
Primary experience is dark (#0F172A base) — it's what WHOOP, Strava, and premium fitness apps train users to expect. It reduces eye strain for early-morning and late-night check-ins, saves battery on OLED, and makes data visualisations pop. Light mode available as toggle, but dark is the default and the brand identity.

**2. Exaggerated minimalism**
Clean layouts with ample negative space, but the hero metric on each card is oversized and bold. No decorative illustrations. Data *is* the decoration. Gradients used sparingly — only on the primary CTA and progress arcs, never on backgrounds.

**3. Glassmorphism for depth layers**
Cards use subtle background blur (backdrop-filter: blur(16px)) with 8-12% white overlay to create depth without hard borders. This creates the premium "floating" feel that differentiates from flat design without going full skeuomorphic.

```css
.card-glass {
  background: rgba(30, 41, 59, 0.7);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 16px;
}
```

**4. Micro-interactions that reward**
- Metric cards animate number counts on mount (0 → actual value over 400ms)
- Progress arcs draw themselves with spring easing
- Pull-to-refresh has a breathing animation (not a spinner)
- Streak badges pulse gently when you hit a new record
- Haptic feedback (on mobile) when logging manual entries

**5. Data visualisation hierarchy**
1. **Hero number** — the single metric that matters most right now
2. **Trend spark** — tiny inline chart showing 7-day direction
3. **Full chart** — expandable, interactive, on dedicated screens
4. **AI insight** — one sentence underneath, conversational tone

### 8.3 Gamification & Engagement

**Streaks:** Daily activity streak counter on dashboard. "Current streak" and "Longest streak" prominently shown. Missing a day resets current but preserves longest. Rest days don't break streak if AI has recommended rest.

**Levels:** Based on cumulative training hours across all sports:
- Level 1: Starter (0-25h) → Level 2: Regular (25-100h) → Level 3: Committed (100-250h)
- Level 4: Dedicated (250-500h) → Level 5: Elite (500-1000h) → Level 6: Legendary (1000h+)
- Levels unlock badge colours and subtle UI theme accents

**Milestones:** Auto-detected and celebrated with animated cards:
- Distance milestones (100km, 500km, 1000km per sport)
- FTP milestones (every 10W, Coggan category promotions)
- Consistency milestones (7-day, 30-day, 100-day, 365-day streaks)
- Personal records (fastest pace, highest NP, longest activity)

**AI personality:** Claude responses use first-person, conversational tone. Not clinical. Not cheerleader. Like a knowledgeable training partner.
- ✅ "Your CTL has been climbing steadily — you're fitter now than any point in the last 3 months. Thursday's a good day for that FTP test."
- ❌ "Your Chronic Training Load indicates improved fitness. Consider scheduling a Functional Threshold Power test."

### 8.4 Action Prompts & Behavioural Nudges

VitalSync uses contextual action prompts on the Dashboard to drive manual data capture, plan engagement, and healthy habits. These appear as dismissible cards between the metric summary and AI interventions — the highest-visibility real estate in the app.

#### Prompt Types

| Category | Trigger Condition | Example Copy | Accent | CTA |
|----------|-------------------|--------------|--------|-----|
| **Weight** | No weight entry in >2 days | "Last weigh-in was 3 days ago. Weekly consistency keeps your W/kg and trends accurate." | Emerald | "Log now" → Health Log > Weight |
| **Mood** | No mood entry today | "No mood logged today. A 10-second check-in helps the AI spot patterns between stress and recovery." | Violet | "Check in" → Health Log > Mood |
| **Training Plan** | New/updated plan available, or start of week | "New AI-adjusted plan ready. Friday's VO2max swapped to Z2 based on your HRV trend." | Cyan | "Review" → Training tab |
| **FTP Retest** | Last FTP test >8 weeks ago AND recent NP consistently exceeds current FTP | "9 weeks since last test. Recent NP suggests your FTP may have jumped to ~275W." | Amber | "Schedule" → Cycling tab |
| **Sleep** | Average sleep <85% of target over trailing 5 days | "Avg 6h12m this week vs 7h05m target. Getting to bed 30 min earlier could improve recovery." | Rose | "See sleep" → Dashboard sleep section |
| **Blood Pressure** | No BP entry in >7 days (if user has logged BP before) | "Weekly BP tracking helps catch trends early. Last reading was 8 days ago." | Emerald | "Log now" → Health Log > BP |
| **Glucose** | No fasting glucose in >14 days (if user has logged glucose before) | "Time for a fasting glucose check — last one was 16 days ago." | Amber | "Log now" → Health Log > Glucose |
| **Hydration** | Daily water intake below 2L for 3+ consecutive days | "You've been under 2L water for 3 days running. Dehydration impacts HRV and recovery." | Cyan | "Log water" → Health Log > Hydration |

#### Prompt Logic

```typescript
interface ActionPrompt {
  id: string;
  type: 'weight' | 'mood' | 'training_plan' | 'ftp_retest' | 'sleep' |
        'blood_pressure' | 'glucose' | 'hydration';
  priority: number;           // 1 (highest) to 10 — determines sort order
  triggerCondition: () => boolean;  // Evaluated on dashboard load
  title: string;
  subtitle: string;
  cta: string;
  ctaRoute: { tab: string; subView?: string };
  accent: 'emerald' | 'violet' | 'cyan' | 'amber' | 'rose';
  dismissible: boolean;
  dismissDuration: 'session' | 'today' | 'week';  // How long dismissal lasts
  cooldownAfterAction: number;  // Hours before showing again after user acts
}

// Firestore: users/{uid}/promptDismissals/{promptId}
// { dismissedAt: timestamp, expiresAt: timestamp }

// Cloud Function: evaluatePrompts(uid)
// Runs on dashboard load. Checks trigger conditions, filters dismissed prompts,
// sorts by priority, returns max 3-4 visible prompts to avoid overwhelming.
```

#### UX Rules

1. **Maximum 4 visible prompts** at any time — prioritised by urgency and staleness of data.
2. **Dismissible** — each prompt has an × button. Dismissed prompts respect their `dismissDuration`:
   - `session`: returns next time user opens the app
   - `today`: returns tomorrow
   - `week`: returns in 7 days
3. **Auto-clear on action** — if the user logs weight, the "Log your weight" prompt disappears immediately without needing dismissal. A `cooldownAfterAction` prevents it reappearing too soon (e.g. 48h for weight, 20h for mood).
4. **Deep-link CTA** — each prompt's button navigates directly to the relevant tab and pre-selects the correct entry type (e.g. "Log now" on weight → Health Log tab with Weight form active and today's date pre-filled).
5. **Time-of-day awareness** — mood prompt appears from 7am; sleep prompt appears after 9pm. Weight prompt appears in the morning (when users typically weigh themselves).
6. **Progressive frequency** — new users see more prompts to build habits. After 4+ weeks of consistent logging, prompts reduce in frequency (the system has learned the user's rhythm).
7. **AI-generated copy** — subtitle text is personalised by Claude based on the user's actual data (e.g. "Last weigh-in was 3 days ago" uses the real gap, "Avg 6h12m" uses their real sleep data). Static fallback copy used if AI unavailable.

#### Firestore Data Model Extension

```
users/{uid}/
├── promptState/
│   ├── active                    // Current active prompts (computed)
│   │   ├── prompts: ActionPrompt[]
│   │   ├── computedAt: timestamp
│   │   └── nextRecomputeAt: timestamp
│   │
│   └── dismissals/{promptId}     // User dismissal records
│       ├── dismissedAt: timestamp
│       ├── expiresAt: timestamp
│       └── dismissType: 'session' | 'today' | 'week'
```

### 8.5 Onboarding Flow

```
┌─────────────────────────────────────────────┐
│ STEP 1: Welcome & Sign In                   │
│                                             │
│  [Logo + "Your body. Your data. Your edge."]│
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  🔵 Continue with Google            │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  One-tap Google sign-in. No email/password  │
│  forms. No friction.                        │
│                                             │
├─────────────────────────────────────────────┤
│ STEP 2: Quick Profile                       │
│                                             │
│  First name: [________]                     │
│  Date of birth: [DD/MM/YYYY]                │
│  Gender: [M] [F] [Other]                    │
│  Weight (kg): [____]                        │
│  Height (cm): [____]                        │
│                                             │
│  "We use this to personalise your metrics   │
│   like W/kg, age-adjusted performance,      │
│   and calorie targets."                     │
│                                             │
├─────────────────────────────────────────────┤
│ STEP 3: Connect Garmin                      │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  ⌚ Connect Garmin Account           │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  → Enters Garmin Connect credentials          │
│  → On success, triggers full history backfill │
│  → Progress indicator: "Syncing your        │
│    history... this may take a few minutes"  │
│                                             │
│  [Skip for now — I'll add Garmin later]     │
│                                             │
├─────────────────────────────────────────────┤
│ STEP 4: What Matters to You? (optional)     │
│                                             │
│  ☐ Get fitter on the bike (FTP, power)      │
│  ☐ Run faster / further                     │
│  ☐ Lose weight / body composition           │
│  ☐ Sleep better                             │
│  ☐ Manage stress                            │
│  ☐ General health tracking                  │
│                                             │
│  Drives AI prompt personalisation and       │
│  which metrics appear on dashboard first.   │
│                                             │
├─────────────────────────────────────────────┤
│ STEP 5: You're In                           │
│                                             │
│  "We're pulling in your Garmin history.     │
│   Your dashboard will build itself as       │
│   data arrives. Come back in 5 minutes      │
│   for your first AI health briefing."       │
│                                             │
│  [→ Go to Dashboard]                        │
└─────────────────────────────────────────────┘
```

---

## 9. Multi-Tenant Authentication Architecture

### 9.1 Auth Strategy

VitalSync uses **Firebase Authentication** with **Google Sign-In** as the primary provider and **Garmin credentials** (via the Garth library) as a linked external data connection. There is no email/password flow — Google Sign-In gives us passwordless auth, verified emails, profile photos, and one-tap sign-in on mobile. Garmin is not an auth provider — it's a data source connected after sign-in.

Data isolation is achieved at the **Firestore document level** via security rules — each user's data lives under `users/{uid}/` and is accessible only to that uid. This is a single-database, multi-tenant model where tenant = individual user.

### 9.2 Google Sign-In Implementation

```typescript
// ── CLIENT: React PWA ──

import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';

const auth = getAuth();
const googleProvider = new GoogleAuthProvider();

// Sign in (one-tap on mobile, popup on desktop)
async function signInWithGoogle(): Promise<void> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Check if this is a new user (first sign-in)
    const isNewUser = result._tokenResponse?.isNewUser ?? false;
    
    if (isNewUser) {
      // Create initial user document
      await setDoc(doc(db, 'users', user.uid, 'settings'), {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
        onboardingComplete: false,
        garmin: { connected: false },
      });
      
      // Route to onboarding flow
      navigate('/onboarding');
    } else {
      // Existing user — go to dashboard
      navigate('/dashboard');
    }
  } catch (error) {
    if (error.code === 'auth/popup-closed-by-user') return;
    throw error;
  }
}

// Auth state listener (persists across sessions + tabs)
onAuthStateChanged(auth, (user) => {
  if (user) {
    // User is signed in — user.uid available for all Firestore operations
    store.setUser(user);
  } else {
    // Signed out — redirect to landing
    navigate('/');
  }
});
```

### 9.3 Firestore Security Rules (Multi-Tenant Isolation)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ── USER DATA: Only accessible by the authenticated user ──
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    
    // ── GARMIN TOKENS: Only accessible by Cloud Functions (admin SDK) ──
    // Client cannot read garmin.accessToken or garmin.accessTokenSecret
    // These fields are written/read exclusively by Cloud Functions using Admin SDK
    // which bypasses security rules. The client only sees garmin.connected: true/false.
    
    // ── SHARED DATA: Read-only reference tables ──
    match /reference/{docId} {
      allow read: if request.auth != null;
      allow write: if false;  // Admin-only via Cloud Functions
    }
    
    // ── Rate limiting: Prevent abuse ──
    // Firestore rules can't rate-limit directly, but Cloud Functions
    // validate request frequency before writing
  }
}
```

### 9.4 Garmin Connection — Garth Credential Flow

Unlike the official Garmin Developer Program (which uses OAuth 1.0a with consumer keys), VitalSync uses the **Garth library** which authenticates via the same SSO endpoint as the Garmin Connect mobile app. The user provides their Garmin email and password once, and Garth handles OAuth2 token exchange and refresh.

```python
# ── CLOUD FUNCTION (Python): garminLogin ──
# Called when user clicks "Connect Garmin" in Settings

from firebase_functions import https_fn
from firebase_admin import firestore
import garth
from garminconnect import Garmin

@https_fn.on_call()
def garmin_login(req: https_fn.CallableRequest) -> dict:
    uid = req.auth.uid
    if not uid:
        raise https_fn.HttpsError('unauthenticated', 'Must be signed in')
    
    email = req.data.get('email')
    password = req.data.get('password')
    
    if not email or not password:
        raise https_fn.HttpsError('invalid-argument', 'Email and password required')
    
    try:
        # Garth SSO authentication (same flow as Garmin Connect app)
        garth.login(email, password)
        
        # Verify connection by fetching user profile
        client = Garmin()
        client.garth = garth.client
        profile = client.get_full_name()
        
        # Serialise Garth session (contains OAuth2 tokens)
        garth_session = garth.client.dumps()
        
        # Encrypt and store
        encrypted_session = encrypt_aes256(garth_session)
        encrypted_email = encrypt_aes256(email)
        
        db = firestore.client()
        db.document(f'users/{uid}/settings').update({
            'garmin.connected': True,
            'garmin.garthSession': encrypted_session,
            'garmin.garminEmail': encrypted_email,
            'garmin.connectedAt': firestore.SERVER_TIMESTAMP,
            'garmin.lastSyncAt': None,
            'garmin.backfillStatus': 'idle',
            'garmin.backfillProgress': 0,
            'garmin.displayName': profile,
        })
        
        # Trigger initial full sync + backfill
        trigger_initial_sync(uid)
        
        return {'status': 'connected', 'displayName': profile}
        
    except Exception as e:
        if 'MFA' in str(e):
            raise https_fn.HttpsError(
                'failed-precondition',
                'MFA detected — please provide the MFA code'
            )
        raise https_fn.HttpsError('permission-denied', f'Garmin login failed: {str(e)}')


# ── MFA SUPPORT ──
# If Garmin account has MFA enabled, Garth supports it:

@https_fn.on_call()
def garmin_login_mfa(req: https_fn.CallableRequest) -> dict:
    uid = req.auth.uid
    mfa_code = req.data.get('mfa_code')
    
    # Resume the MFA challenge
    garth.login(email, password)
    garth.client.login_mfa(mfa_code)
    
    # Continue with token storage (same as above)
    # ...
```

### 9.5 Token Security

```python
# ── ENCRYPTION: AES-256-GCM for Garth session tokens at rest ──
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os, base64

# Encryption key from Google Cloud Secret Manager
# (loaded once at function cold start)
ENCRYPTION_KEY = get_secret('GARMIN_TOKEN_ENCRYPTION_KEY')  # 32 bytes

def encrypt_aes256(plaintext: str) -> str:
    """Encrypt with AES-256-GCM, return base64(nonce + ciphertext + tag)."""
    nonce = os.urandom(12)
    aesgcm = AESGCM(ENCRYPTION_KEY)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()

def decrypt_aes256(encrypted: str) -> str:
    """Decrypt AES-256-GCM from base64(nonce + ciphertext + tag)."""
    data = base64.b64decode(encrypted)
    nonce, ciphertext = data[:12], data[12:]
    aesgcm = AESGCM(ENCRYPTION_KEY)
    return aesgcm.decrypt(nonce, ciphertext, None).decode()

# KEY MANAGEMENT:
# - Encryption key stored in Google Cloud Secret Manager (not env vars)
# - Key rotation: generate new key, re-encrypt all sessions, delete old key
# - Garth session tokens NEVER exposed to client — only Cloud Functions access them
# - Firestore security rules prevent client from reading garmin.garthSession
# - Password is NEVER stored — only the Garth OAuth2 session (which auto-refreshes)
```

### 9.6 Session & Multi-Device Behaviour

Firebase Auth handles sessions automatically:
- **Web:** Auth state persisted in IndexedDB (survives tab close, browser restart)
- **Mobile (Capacitor/React Native):** Persisted in secure keychain/keystore
- **Multi-device:** User signs in on phone and laptop — both see same data. Garmin sync is serverside (Cloud Function pulls data to Firestore), so all clients see updates via onSnapshot listeners regardless of which device is active.
- **Sign out:** `auth.signOut()` clears local session. Garth session remains encrypted in Firestore (user doesn't need to re-enter Garmin credentials on next sign-in).
- **Garth token refresh:** Happens automatically server-side. If the OAuth2 refresh token expires entirely (rare — typically months), user is prompted to re-enter Garmin credentials.

---

## 10. Garmin Full History Backfill (Pull-Based)

### 10.1 Backfill Strategy

With the Garth library, historical data is pulled directly using date-range API calls — no asynchronous webhook delivery needed. The `garminconnect` library supports querying any past date for health data, and listing activities with pagination for activity history.

**Practical data limits (Garmin Connect retains):**
- **Health data:** Full history available — Garmin Connect stores all-time daily summaries, sleep, HR, stress, HRV etc.
- **Activities:** Full history — `get_activities(start_index, limit)` paginates through all activities ever recorded
- **FIT files:** Available for download for all stored activities

The backfill runs as a **background Cloud Task** (Firebase Cloud Tasks) to avoid Cloud Function timeout limits (max 9 minutes for 2nd gen). Large backfills are chunked into multiple invocations.

### 10.2 Backfill Cloud Function

```python
# ── Triggered automatically after first Garmin login ──

from firebase_functions import https_fn, tasks_fn
from firebase_admin import firestore
from garminconnect import Garmin
from datetime import date, timedelta
import garth

@tasks_fn.on_task_dispatched(retry_config=tasks_fn.RetryConfig(max_attempts=3))
def garmin_backfill_chunk(req: tasks_fn.CallableRequest) -> None:
    """Process one chunk of historical data backfill."""
    
    uid = req.data['uid']
    chunk_type = req.data['chunk_type']     # 'health' or 'activities'
    start_date = req.data['start_date']     # ISO date string
    end_date = req.data['end_date']         # ISO date string
    chunk_index = req.data['chunk_index']
    total_chunks = req.data['total_chunks']
    
    # Restore Garth session
    client = restore_garmin_client(uid)
    db = firestore.client()
    
    if chunk_type == 'health':
        # Pull health data day by day for this chunk
        current = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
        batch = db.batch()
        write_count = 0
        
        while current <= end:
            date_str = current.isoformat()
            
            try:
                # Pull all health metrics for this day
                daily = {
                    'stats': client.get_stats(date_str),
                    'heartRates': client.get_heart_rates(date_str),
                    'sleep': client.get_sleep_data(date_str),
                    'stress': client.get_stress_data(date_str),
                    'bodyComp': client.get_body_composition(date_str),
                    'hrv': client.get_hrv_data(date_str),
                    'spo2': client.get_spo2_data(date_str),
                    'respiration': client.get_respiration_data(date_str),
                    'trainingReadiness': safe_call(client.get_training_readiness, date_str),
                    'processedAt': firestore.SERVER_TIMESTAMP,
                }
                
                ref = db.document(f'users/{uid}/garminDailies/{date_str}')
                batch.set(ref, daily, merge=True)
                write_count += 1
                
                # Firestore batch limit
                if write_count >= 450:
                    batch.commit()
                    batch = db.batch()
                    write_count = 0
                    
            except Exception as e:
                # Log but continue — some days may have no data
                print(f'Health data missing for {date_str}: {e}')
            
            current += timedelta(days=1)
        
        if write_count > 0:
            batch.commit()
    
    elif chunk_type == 'activities':
        # Pull activities by pagination
        start_index = req.data.get('start_index', 0)
        batch_size = 50
        activities = client.get_activities(start_index, batch_size)
        
        batch = db.batch()
        for activity in activities:
            act_id = str(activity.get('activityId'))
            ref = db.document(f'users/{uid}/activities/{act_id}')
            activity['processedAt'] = firestore.SERVER_TIMESTAMP
            batch.set(ref, activity, merge=True)
        
        if activities:
            batch.commit()
    
    # Update progress
    db.document(f'users/{uid}/backfillJobs/initial').update({
        'chunksReceived': firestore.Increment(1),
    })
    
    # Calculate and update progress percentage
    job = db.document(f'users/{uid}/backfillJobs/initial').get().to_dict()
    progress = min(95, round((job['chunksReceived'] / max(1, total_chunks)) * 100))
    
    db.document(f'users/{uid}/settings').update({
        'garmin.backfillProgress': progress,
        'garmin.lastSyncAt': firestore.SERVER_TIMESTAMP,
    })
    
    # Save refreshed Garth tokens
    save_garmin_tokens(uid, garth.client.dumps())


def trigger_initial_sync(uid: str) -> None:
    """Enqueue backfill tasks after first Garmin connection."""
    
    db = firestore.client()
    today = date.today()
    
    # ── HEALTH DATA: Pull last 2 years in 30-day chunks ──
    health_start = today - timedelta(days=730)
    health_chunks = []
    chunk_start = health_start
    while chunk_start < today:
        chunk_end = min(chunk_start + timedelta(days=29), today)
        health_chunks.append(('health', chunk_start.isoformat(), chunk_end.isoformat()))
        chunk_start = chunk_end + timedelta(days=1)
    
    # ── ACTIVITIES: Pull in batches of 50 ──
    # First, count total activities
    client = restore_garmin_client(uid)
    # Get first page to estimate total
    first_page = client.get_activities(0, 1)
    # Garmin doesn't return total count, so we'll paginate until empty
    activity_chunks = []
    for i in range(0, 2000, 50):  # Max 2000 activities (~5 years)
        activity_chunks.append(('activities', None, None, i))
    
    total_chunks = len(health_chunks) + len(activity_chunks)
    
    # Create backfill tracking document
    db.document(f'users/{uid}/backfillJobs/initial').set({
        'status': 'syncing',
        'requestedAt': firestore.SERVER_TIMESTAMP,
        'completedAt': None,
        'chunksRequested': total_chunks,
        'chunksReceived': 0,
        'errors': [],
    })
    
    db.document(f'users/{uid}/settings').update({
        'garmin.backfillStatus': 'syncing',
        'garmin.backfillProgress': 0,
    })
    
    # Enqueue Cloud Tasks (rate-limited, 1 per second)
    from google.cloud import tasks_v2
    tasks_client = tasks_v2.CloudTasksClient()
    
    for idx, chunk in enumerate(health_chunks):
        enqueue_backfill_task(tasks_client, uid, {
            'uid': uid,
            'chunk_type': chunk[0],
            'start_date': chunk[1],
            'end_date': chunk[2],
            'chunk_index': idx,
            'total_chunks': total_chunks,
        }, delay_seconds=idx * 2)  # 2-second spacing to avoid rate limits
    
    for idx, chunk in enumerate(activity_chunks):
        enqueue_backfill_task(tasks_client, uid, {
            'uid': uid,
            'chunk_type': 'activities',
            'start_index': chunk[3],
            'chunk_index': len(health_chunks) + idx,
            'total_chunks': total_chunks,
        }, delay_seconds=(len(health_chunks) + idx) * 2)
```

### 10.3 Backfill Completion Detection

Since backfill is pull-based (Cloud Tasks), completion is deterministic — we know exactly how many tasks were enqueued:

```python
# ── SCHEDULED FUNCTION: Check backfill completion every 5 minutes ──

@scheduler_fn.on_schedule(schedule='every 5 minutes')
def check_backfill_completion(event) -> None:
    """Check if any active backfill jobs have completed."""
    
    db = firestore.client()
    
    # Find all users with active backfill jobs
    active_jobs = db.collection_group('backfillJobs') \
        .where('status', '==', 'syncing') \
        .get()
    
    for job_doc in active_jobs:
        job = job_doc.to_dict()
        uid = job_doc.reference.parent.parent.id
        
        chunks_received = job.get('chunksReceived', 0)
        chunks_requested = job.get('chunksRequested', 1)
        
        # Complete if all chunks received (or 95%+ with no activity for 10 min)
        completion_ratio = chunks_received / max(1, chunks_requested)
        
        if completion_ratio >= 0.95:
            # Mark as processing
            job_doc.reference.update({
                'status': 'processing',
                'completedAt': firestore.SERVER_TIMESTAMP,
            })
            
            # Trigger post-backfill processing
            post_backfill_processing(uid)
            
            # Update client
            db.document(f'users/{uid}/settings').update({
                'garmin.backfillStatus': 'complete',
                'garmin.backfillProgress': 100,
            })
            
            job_doc.reference.update({'status': 'complete'})
```
  
  // 5. Trigger first AI analysis with full historical context
  await triggerInitialAIAnalysis(uid);
  
  logger.info(`Post-backfill processing complete for ${uid}. ${activities.size} activities processed.`);
}
```

### 10.5 Client-Side Backfill Progress

```tsx
// ── REACT: Garmin sync progress indicator ──

function GarminSyncProgress() {
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'complete'>('idle');
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'users', uid, 'settings'),
      (snapshot) => {
        const garmin = snapshot.data()?.garmin;
        if (garmin?.backfillStatus === 'syncing') {
          setSyncStatus('syncing');
          setProgress(garmin.backfillProgress || 0);
        } else if (garmin?.backfillStatus === 'complete') {
          setSyncStatus('complete');
          setProgress(100);
        }
      }
    );
    return unsubscribe;
  }, [uid]);
  
  if (syncStatus === 'idle') return null;
  
  return (
    <div className="bg-slate-800/80 backdrop-blur-xl rounded-2xl p-4 border border-emerald-800/30">
      <div className="flex items-center gap-3">
        {syncStatus === 'syncing' ? (
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">✓</div>
        )}
        <div className="flex-1">
          <p className="text-sm text-white font-medium">
            {syncStatus === 'syncing' ? 'Syncing your Garmin history...' : 'History sync complete!'}
          </p>
          <p className="text-xs text-slate-400">
            {syncStatus === 'syncing'
              ? 'Pulling up to 5 years of activities and 2 years of health data'
              : 'Your dashboard is ready with all your historical data'}
          </p>
        </div>
      </div>
      {syncStatus === 'syncing' && (
        <div className="mt-3 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

### 10.6 Garmin Disconnection & Reconnection

```python
# ── CLOUD FUNCTION: User clicks "Disconnect Garmin" in Settings ──

@https_fn.on_call()
def garmin_disconnect(req: https_fn.CallableRequest) -> dict:
    uid = req.auth.uid
    db = firestore.client()
    
    # Mark Garmin as disconnected — but KEEP all historical data
    # User's synced data remains in Firestore for their continued use
    db.document(f'users/{uid}/settings').update({
        'garmin.connected': False,
        'garmin.garthSession': firestore.DELETE_FIELD,
        'garmin.garminEmail': firestore.DELETE_FIELD,
        'garmin.disconnectedAt': firestore.SERVER_TIMESTAMP,
    })
    
    return {'status': 'disconnected'}

# Reconnection: User clicks "Connect Garmin" again
# → Same credential flow as initial connection (garmin_login)
# → Garth issues new OAuth2 session
# → Trigger backfill for the gap period (disconnectedAt → now)
# → Existing data preserved, gap filled seamlessly
```

### 10.7 GDPR Compliance

```typescript
// ── CLOUD FUNCTION: Right to deletion ──

export const deleteUserData = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in');
  
  // 1. Disconnect Garmin (revoke access)
  const settings = await db.doc(`users/${uid}/settings`).get();
  if (settings.data()?.garmin?.connected) {
    // Garmin doesn't have a programmatic revoke — user must do it via connect.garmin.com
    // We delete our stored tokens
    await db.doc(`users/${uid}/settings`).update({
      'garmin.accessToken': FieldValue.delete(),
      'garmin.accessTokenSecret': FieldValue.delete(),
      'garmin.connected': false,
    });
  }
  
  // 2. Delete all user data from Firestore
  const subcollections = [
    'activities', 'healthLog', 'interventions', 'trainingPlans',
    'garminDailies', 'garminSleep', 'activityStats', 'trends',
    'goals', 'backfillJobs'
  ];
  
  for (const sub of subcollections) {
    await deleteCollection(db, `users/${uid}/${sub}`);
  }
  
  await db.doc(`users/${uid}/settings`).delete();
  await db.doc(`users/${uid}/lifetimeStats`).delete();
  await db.doc(`users/${uid}/cyclingProfile`).delete();
  
  // 3. Delete Firebase Auth account
  await admin.auth().deleteUser(uid);
  
  // 4. Audit log (retained for compliance, anonymised)
  await db.collection('auditLog').add({
    action: 'user_deletion',
    timestamp: FieldValue.serverTimestamp(),
    // No PII — just the fact that a deletion occurred
  });
});
```

---

*Document version: 3.0*  
*Created: 2026-02-07*  
*Updated: 2026-02-07 — Added Brand Identity, Multi-Tenant Auth, Garmin Full History Backfill, History tab with YoY comparison*  
*Project: VitalSync*  
*Stack: Firebase + React PWA + Garmin Health API + Claude API*
