import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminSync } from '@/hooks/useGarminData';

const GOALS = [
  { value: 'build_ftp', label: 'Build FTP / Power' },
  { value: 'run_race', label: 'Run a Race' },
  { value: 'lose_weight', label: 'Lose Weight' },
  { value: 'general_fitness', label: 'General Fitness' },
  { value: 'improve_endurance', label: 'Improve Endurance' },
];

const FITNESS_LEVELS = [
  { value: 'beginner', label: 'Beginner', desc: 'New to regular exercise' },
  { value: 'intermediate', label: 'Intermediate', desc: '1-3 years consistent training' },
  { value: 'advanced', label: 'Advanced', desc: '3+ years, structured training' },
  { value: 'elite', label: 'Elite', desc: 'Competitive athlete' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export default function OnboardingPage() {
  const { user, setUserSettings } = useAuth();
  const { connectGarmin } = useGarminSync();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1: Profile basics
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');

  // Step 2: Fitness level & conditions
  const [fitnessLevel, setFitnessLevel] = useState('intermediate');
  const [conditions, setConditions] = useState('');
  const [medications, setMedications] = useState('');

  // Step 3: Goals
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [secondaryGoals, setSecondaryGoals] = useState([]);

  // Step 4: Availability
  const [totalHours, setTotalHours] = useState(9);
  const [restDays, setRestDays] = useState(['thu']);

  // Step 5: Garmin
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState('');
  const [garminConnected, setGarminConnected] = useState(false);

  const steps = [
    { title: 'About You', icon: '\uD83D\uDC4B' },
    { title: 'Health', icon: '\uD83C\uDFCB\uFE0F' },
    { title: 'Goals', icon: '\uD83C\uDFAF' },
    { title: 'Schedule', icon: '\uD83D\uDCC5' },
    { title: 'Garmin', icon: '\u231A' },
  ];

  function toggleSecondaryGoal(goal) {
    setSecondaryGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  }

  function toggleRestDay(day) {
    setRestDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  async function handleGarminConnect(e) {
    e.preventDefault();
    setGarminLoading(true);
    setGarminError('');
    try {
      await connectGarmin(garminEmail, garminPassword);
      setGarminConnected(true);
    } catch (err) {
      setGarminError(err?.details?.message || err?.message?.replace(/^.*?:\s*/, '') || 'Connection failed.');
    } finally {
      setGarminLoading(false);
    }
  }

  async function finishOnboarding() {
    if (!user) return;
    setSaving(true);

    // Build schedule from rest days
    const schedule = {};
    for (const day of DAYS) {
      if (restDays.includes(day)) {
        schedule[day] = { slot: 'rest', durationHours: 0 };
      } else {
        schedule[day] = { slot: 'morning', durationHours: 1.5 };
      }
    }

    const settings = {
      profile: {
        dob: dob || null,
        gender: gender || null,
        heightCm: heightCm ? parseFloat(heightCm) : null,
        weightKg: weightKg ? parseFloat(weightKg) : null,
      },
      healthContext: {
        fitnessLevel,
        conditions: conditions ? conditions.split(',').map((s) => s.trim()).filter(Boolean) : [],
        medications: medications ? medications.split(',').map((s) => s.trim()).filter(Boolean) : [],
      },
      goals: {
        primaryGoal,
        secondaryGoals,
      },
      availability: {
        totalHoursPerWeek: totalHours,
        schedule,
      },
      preferences: {
        units: 'metric',
        aiPersonality: 'coach',
      },
      onboardingComplete: true,
    };

    try {
      await setDoc(doc(db, 'users', user.uid), settings, { merge: true });
      setUserSettings((prev) => ({ ...prev, ...settings }));
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Failed to save onboarding:', err);
    } finally {
      setSaving(false);
    }
  }

  function canProceed() {
    switch (step) {
      case 0: return true; // Profile is optional
      case 1: return !!fitnessLevel;
      case 2: return !!primaryGoal;
      case 3: return totalHours >= 1;
      case 4: return true; // Garmin is optional
      default: return true;
    }
  }

  return (
    <div className="min-h-screen bg-midnight flex flex-col">
      {/* Progress bar */}
      <div className="px-6 pt-6">
        <div className="flex gap-1.5 mb-2">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-emerald-500' : 'bg-slate-800'
              }`}
            />
          ))}
        </div>
        <p className="text-slate-500 text-xs">Step {step + 1} of {steps.length}</p>
      </div>

      {/* Step content */}
      <div className="flex-1 px-6 py-6 overflow-y-auto">
        <h2 className="text-white text-2xl font-bold mb-1">
          {steps[step].icon} {steps[step].title}
        </h2>

        {/* Step 0: Profile */}
        {step === 0 && (
          <div className="space-y-4 mt-6">
            <p className="text-slate-400 text-sm">Tell us a bit about yourself so we can personalise your experience.</p>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Date of Birth</label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Gender</label>
              <div className="flex gap-2">
                {['male', 'female', 'other'].map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={`text-xs rounded-lg px-4 py-2 border transition-colors capitalize flex-1 ${
                      gender === g
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 text-xs block mb-1">Height (cm)</label>
                <input
                  type="number"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="175"
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Weight (kg)</label>
                <input
                  type="number"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  placeholder="70"
                  className="input-field w-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Health Context */}
        {step === 1 && (
          <div className="space-y-4 mt-6">
            <p className="text-slate-400 text-sm">Help us understand your fitness background.</p>
            <div>
              <label className="text-slate-400 text-xs block mb-2">Fitness Level</label>
              <div className="space-y-2">
                {FITNESS_LEVELS.map((fl) => (
                  <button
                    key={fl.value}
                    onClick={() => setFitnessLevel(fl.value)}
                    className={`w-full text-left rounded-lg px-4 py-3 border transition-colors ${
                      fitnessLevel === fl.value
                        ? 'bg-emerald-500/20 border-emerald-500/50'
                        : 'border-slate-700'
                    }`}
                  >
                    <p className={`text-sm font-medium ${fitnessLevel === fl.value ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {fl.label}
                    </p>
                    <p className="text-slate-500 text-xs">{fl.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Medical conditions (optional)</label>
              <input
                type="text"
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                placeholder="e.g. asthma, hypertension"
                className="input-field w-full"
              />
              <p className="text-slate-600 text-[10px] mt-1">Comma-separated</p>
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Current medications (optional)</label>
              <input
                type="text"
                value={medications}
                onChange={(e) => setMedications(e.target.value)}
                placeholder="e.g. metformin, lisinopril"
                className="input-field w-full"
              />
              <p className="text-slate-600 text-[10px] mt-1">Comma-separated</p>
            </div>
          </div>
        )}

        {/* Step 2: Goals */}
        {step === 2 && (
          <div className="space-y-4 mt-6">
            <p className="text-slate-400 text-sm">What are you training for?</p>
            <div>
              <label className="text-slate-400 text-xs block mb-2">Primary Goal</label>
              <div className="space-y-2">
                {GOALS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setPrimaryGoal(g.value)}
                    className={`w-full text-left text-sm rounded-lg px-4 py-3 border transition-colors ${
                      primaryGoal === g.value
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            {primaryGoal && (
              <div>
                <label className="text-slate-400 text-xs block mb-2">Secondary Goals (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {GOALS.filter((g) => g.value !== primaryGoal).map((g) => (
                    <button
                      key={g.value}
                      onClick={() => toggleSecondaryGoal(g.value)}
                      className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
                        secondaryGoals.includes(g.value)
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                          : 'border-slate-600 text-slate-400'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Availability */}
        {step === 3 && (
          <div className="space-y-4 mt-6">
            <p className="text-slate-400 text-sm">How much time can you dedicate to training?</p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 text-xs">Hours per week</label>
                <span className="text-emerald-400 text-sm font-mono">{totalHours}h</span>
              </div>
              <input
                type="range"
                min="1"
                max="25"
                step="0.5"
                value={totalHours}
                onChange={(e) => setTotalHours(parseFloat(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-2">Rest days</label>
              <div className="flex gap-2">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    onClick={() => toggleRestDay(day)}
                    className={`text-xs rounded-lg px-2 py-2 border transition-colors flex-1 ${
                      restDays.includes(day)
                        ? 'bg-slate-600/50 border-slate-500/50 text-slate-300'
                        : 'border-slate-700 text-slate-500'
                    }`}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Garmin */}
        {step === 4 && (
          <div className="space-y-4 mt-6">
            {garminConnected ? (
              <div className="glass-card p-6 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                  <span className="text-emerald-400 text-xl">{'\u2713'}</span>
                </div>
                <p className="text-emerald-400 font-medium">Garmin Connected</p>
                <p className="text-slate-400 text-xs mt-1">Your data will start syncing shortly.</p>
              </div>
            ) : (
              <>
                <p className="text-slate-400 text-sm">
                  Connect your Garmin to automatically sync heart rate, sleep, HRV, activities, and more.
                </p>
                <form onSubmit={handleGarminConnect} className="space-y-3">
                  <input
                    type="email"
                    placeholder="Garmin email"
                    value={garminEmail}
                    onChange={(e) => setGarminEmail(e.target.value)}
                    disabled={garminLoading}
                    className="input-field w-full"
                  />
                  <input
                    type="password"
                    placeholder="Garmin password"
                    value={garminPassword}
                    onChange={(e) => setGarminPassword(e.target.value)}
                    disabled={garminLoading}
                    className="input-field w-full"
                  />
                  {garminError && <p className="text-rose-400 text-xs">{garminError}</p>}
                  <button
                    type="submit"
                    disabled={garminLoading || !garminEmail || !garminPassword}
                    className="btn-cta-sm w-full disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {garminLoading && <div className="w-4 h-4 rounded-full border-2 border-midnight border-t-transparent animate-spin" />}
                    {garminLoading ? 'Connecting...' : 'Connect Garmin'}
                  </button>
                </form>
                <p className="text-slate-600 text-[10px] text-center">
                  Credentials are encrypted with AES-256. You can skip this and connect later in Settings.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="px-6 pb-8 pt-2 flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="btn-secondary flex-1"
          >
            Back
          </button>
        )}
        {step < steps.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="btn-cta-sm flex-1 disabled:opacity-50"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={finishOnboarding}
            disabled={saving}
            className="btn-cta-sm flex-1 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <div className="w-4 h-4 rounded-full border-2 border-midnight border-t-transparent animate-spin" />}
            {saving ? 'Saving...' : 'Get Started'}
          </button>
        )}
      </div>
    </div>
  );
}
