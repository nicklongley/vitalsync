import { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminSync } from '@/hooks/useGarminData';
import GarminSyncProgress from '@/components/GarminSyncProgress';

const GOALS = [
  { value: 'build_ftp', label: 'Build FTP / Power' },
  { value: 'run_race', label: 'Run a Race' },
  { value: 'lose_weight', label: 'Lose Weight' },
  { value: 'general_fitness', label: 'General Fitness' },
  { value: 'improve_endurance', label: 'Improve Endurance' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const SLOTS = ['morning', 'lunch', 'evening', 'rest'];

export default function SettingsTab() {
  const { user, userSettings, setUserSettings, signOut } = useAuth();
  const {
    connected, displayName: garminDisplayName, backfillStatus, backfillProgress,
    lastSyncAt, syncing, syncNow, connectGarmin, disconnectGarmin,
  } = useGarminSync();

  // Garmin connection form
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState('');
  const [garminSuccess, setGarminSuccess] = useState('');

  // Goals state
  const [primaryGoal, setPrimaryGoal] = useState(userSettings?.goals?.primaryGoal || '');
  const [secondaryGoals, setSecondaryGoals] = useState(userSettings?.goals?.secondaryGoals || []);

  // Availability state
  const [totalHours, setTotalHours] = useState(userSettings?.availability?.totalHoursPerWeek || 9);
  const [schedule, setSchedule] = useState(
    userSettings?.availability?.schedule || {
      mon: { slot: 'morning', durationHours: 1.5 },
      tue: { slot: 'evening', durationHours: 1.5 },
      wed: { slot: 'morning', durationHours: 1.5 },
      thu: { slot: 'rest', durationHours: 0 },
      fri: { slot: 'evening', durationHours: 1.5 },
      sat: { slot: 'morning', durationHours: 2 },
      sun: { slot: 'morning', durationHours: 1.5 },
    }
  );

  // Saving state
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Sync from userSettings when they change
  useEffect(() => {
    if (userSettings?.goals) {
      setPrimaryGoal(userSettings.goals.primaryGoal || '');
      setSecondaryGoals(userSettings.goals.secondaryGoals || []);
    }
    if (userSettings?.availability) {
      setTotalHours(userSettings.availability.totalHoursPerWeek || 9);
      if (userSettings.availability.schedule) setSchedule(userSettings.availability.schedule);
    }
  }, [userSettings]);

  async function saveSettings(section, data) {
    if (!user) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await setDoc(doc(db, 'users', user.uid), { [section]: data }, { merge: true });
      setUserSettings((prev) => ({ ...prev, [section]: { ...prev?.[section], ...data } }));
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  }

  function toggleSecondaryGoal(goal) {
    setSecondaryGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  }

  function updateDaySlot(day, slot) {
    setSchedule((prev) => ({
      ...prev,
      [day]: { ...prev[day], slot, durationHours: slot === 'rest' ? 0 : (prev[day]?.durationHours || 1.5) },
    }));
  }

  function updateDayDuration(day, hours) {
    setSchedule((prev) => ({ ...prev, [day]: { ...prev[day], durationHours: hours } }));
  }

  // Garmin handlers
  async function handleGarminConnect(e) {
    e.preventDefault();
    setGarminLoading(true); setGarminError(''); setGarminSuccess('');
    try {
      const result = await connectGarmin(garminEmail, garminPassword);
      setGarminEmail(''); setGarminPassword('');
      setGarminSuccess(result?.displayName ? `Connected as ${result.displayName}` : 'Connected successfully');
    } catch (err) {
      setGarminError(err?.details?.message || err?.message?.replace(/^.*?:\s*/, '') || 'Connection failed.');
    } finally { setGarminLoading(false); }
  }

  async function handleGarminDisconnect() {
    if (!window.confirm('Disconnect Garmin? Historical data will be kept.')) return;
    try { await disconnectGarmin(); setGarminSuccess(''); } catch (err) { setGarminError(err?.message || 'Disconnect failed'); }
  }

  return (
    <div className="space-y-6">
      {/* Save indicator */}
      {saveMsg && (
        <div className={`text-xs text-center py-1 rounded-lg ${saveMsg === 'Saved' ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
          {saveMsg}
        </div>
      )}

      {/* ── Profile ── */}
      <div className="glass-card p-4 flex items-center gap-4">
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="w-12 h-12 rounded-full border border-slate-700" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-slate-400 text-lg font-semibold">
            {user?.displayName?.[0] || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{user?.displayName}</p>
          <p className="text-slate-400 text-xs truncate">{user?.email}</p>
        </div>
      </div>

      {/* ── Garmin Connection ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <span className="text-base">{"\u231A"}</span> Garmin Connection
        </h3>
        {connected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-400 text-sm font-medium">Connected</span>
              </div>
              <button onClick={syncNow} disabled={syncing} className="text-xs text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50">
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
            </div>
            {garminDisplayName && <p className="text-slate-300 text-sm">{garminDisplayName}</p>}
            {lastSyncAt && <p className="text-slate-500 text-xs">Last synced: {lastSyncAt.toLocaleString()}</p>}
            {backfillStatus === 'syncing' && <GarminSyncProgress progress={backfillProgress} />}
            <button onClick={handleGarminDisconnect} className="text-rose-400 text-xs hover:text-rose-300 transition-colors mt-1">Disconnect Garmin</button>
          </div>
        ) : (
          <form onSubmit={handleGarminConnect} className="space-y-3">
            <p className="text-slate-400 text-xs leading-relaxed">
              Enter your Garmin Connect credentials. They are encrypted with AES-256 and stored securely.
            </p>
            <input type="email" placeholder="Garmin email" value={garminEmail} onChange={(e) => setGarminEmail(e.target.value)} autoComplete="email" disabled={garminLoading} className="input-field w-full" />
            <input type="password" placeholder="Garmin password" value={garminPassword} onChange={(e) => setGarminPassword(e.target.value)} autoComplete="current-password" disabled={garminLoading} className="input-field w-full" />
            {garminError && <p className="text-rose-400 text-xs">{garminError}</p>}
            {garminSuccess && <p className="text-emerald-400 text-xs">{garminSuccess}</p>}
            <button type="submit" disabled={garminLoading || !garminEmail || !garminPassword} className="btn-cta-sm w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {garminLoading && <div className="w-4 h-4 rounded-full border-2 border-midnight border-t-transparent animate-spin" />}
              {garminLoading ? 'Connecting...' : 'Connect Garmin'}
            </button>
          </form>
        )}
      </div>

      {/* ── Training Goals ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">{"\uD83C\uDFAF"} Training Goals</h3>

        <label className="text-slate-400 text-xs block mb-2">Primary Goal</label>
        <div className="grid grid-cols-1 gap-2 mb-4">
          {GOALS.map((g) => (
            <button
              key={g.value}
              onClick={() => setPrimaryGoal(g.value)}
              className={`text-left text-xs rounded-lg px-3 py-2.5 border transition-colors ${
                primaryGoal === g.value
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                  : 'bg-slate-700/50 border-slate-600/50 text-slate-400 hover:border-slate-500'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <label className="text-slate-400 text-xs block mb-2">Secondary Goals (optional)</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {GOALS.filter((g) => g.value !== primaryGoal).map((g) => (
            <button
              key={g.value}
              onClick={() => toggleSecondaryGoal(g.value)}
              className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                secondaryGoals.includes(g.value)
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                  : 'border-slate-600 text-slate-400'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => saveSettings('goals', { primaryGoal, secondaryGoals })}
          disabled={saving}
          className="btn-cta-sm text-xs disabled:opacity-50"
        >
          Save Goals
        </button>
      </div>

      {/* ── Weekly Availability ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">{"\uD83D\uDCC5"} Weekly Availability</h3>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-slate-400 text-xs">Total hours/week</label>
            <span className="text-emerald-400 text-sm font-mono">{totalHours}h</span>
          </div>
          <input
            type="range" min="1" max="25" step="0.5" value={totalHours}
            onChange={(e) => setTotalHours(parseFloat(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </div>

        <label className="text-slate-400 text-xs block mb-2">Day-by-day schedule</label>
        <div className="space-y-2 mb-4">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-2">
              <span className="text-slate-300 text-xs w-8 flex-shrink-0">{DAY_LABELS[day]}</span>
              <div className="flex gap-1 flex-1">
                {SLOTS.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => updateDaySlot(day, slot)}
                    className={`text-[10px] rounded px-1.5 py-1 border flex-1 transition-colors capitalize ${
                      schedule[day]?.slot === slot
                        ? slot === 'rest'
                          ? 'bg-slate-600/50 border-slate-500/50 text-slate-300'
                          : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'border-slate-700 text-slate-500'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
              {schedule[day]?.slot !== 'rest' && (
                <input
                  type="number" step="0.5" min="0.5" max="5"
                  value={schedule[day]?.durationHours || 1.5}
                  onChange={(e) => updateDayDuration(day, parseFloat(e.target.value))}
                  className="input-field w-14 text-xs text-center py-1"
                />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => saveSettings('availability', { totalHoursPerWeek: totalHours, schedule })}
          disabled={saving}
          className="btn-cta-sm text-xs disabled:opacity-50"
        >
          Save Availability
        </button>
      </div>

      {/* ── AI Insights ── */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-white font-semibold text-sm">AI Analysis</h3>
        <button
          onClick={async () => {
            setSaveMsg('Running AI analysis...');
            try {
              const fn = httpsCallable(functions, 'ai_daily_analysis');
              const result = await fn();
              setSaveMsg(`Analysis complete — ${result.data.interventionCount} insights generated`);
              setTimeout(() => setSaveMsg(''), 4000);
            } catch (err) {
              setSaveMsg('Analysis failed');
              setTimeout(() => setSaveMsg(''), 3000);
            }
          }}
          className="text-emerald-400 text-xs hover:text-emerald-300 block transition-colors"
        >
          Run daily analysis now
        </button>
        <button
          onClick={async () => {
            setSaveMsg('Generating training plan...');
            try {
              const fn = httpsCallable(functions, 'ai_weekly_plan');
              const result = await fn();
              setSaveMsg(`Plan created — ${result.data.sessionCount} sessions`);
              setTimeout(() => setSaveMsg(''), 4000);
            } catch (err) {
              setSaveMsg('Plan generation failed');
              setTimeout(() => setSaveMsg(''), 3000);
            }
          }}
          className="text-cyan-400 text-xs hover:text-cyan-300 block transition-colors"
        >
          Generate weekly training plan
        </button>
      </div>

      {/* ── Data & Privacy ── */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-white font-semibold text-sm">Data & Privacy</h3>
        <button
          onClick={async () => {
            setSaveMsg('Exporting data...');
            try {
              const fn = httpsCallable(functions, 'data_export');
              const result = await fn();
              const blob = new Blob([JSON.stringify(result.data.data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `vitalsync-export-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
              setSaveMsg('Export downloaded');
              setTimeout(() => setSaveMsg(''), 3000);
            } catch (err) {
              setSaveMsg('Export failed');
              setTimeout(() => setSaveMsg(''), 3000);
            }
          }}
          className="text-slate-400 text-xs hover:text-slate-300 block transition-colors"
        >
          Export my data
        </button>
        <button
          onClick={async () => {
            if (!window.confirm('Are you sure? This will permanently delete your account and all data. This cannot be undone.')) return;
            if (!window.confirm('Final confirmation: Delete everything?')) return;
            setSaveMsg('Deleting account...');
            try {
              const fn = httpsCallable(functions, 'delete_user_data');
              await fn();
              signOut();
            } catch (err) {
              setSaveMsg('Deletion failed');
              setTimeout(() => setSaveMsg(''), 3000);
            }
          }}
          className="text-rose-400 text-xs hover:text-rose-300 block transition-colors"
        >
          Delete my account and all data
        </button>
      </div>

      {/* ── Sign Out ── */}
      <button onClick={signOut} className="btn-secondary w-full">Sign Out</button>
    </div>
  );
}
