// ══════════════════════════════════════════════════════
// VITALSYNC — Settings Tab
// Profile, Garmin, Goals, Availability, Preferences, Data
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminSync } from '@/hooks/useGarminData';

const GOALS = [
  { id: 'improve_ftp', label: 'Improve cycling FTP' },
  { id: 'run_marathon', label: 'Run a marathon' },
  { id: 'run_5k', label: 'Run a faster 5K' },
  { id: 'lose_weight', label: 'Lose weight' },
  { id: 'build_endurance', label: 'Build endurance' },
  { id: 'build_strength', label: 'Build strength' },
  { id: 'improve_health', label: 'Improve general health' },
  { id: 'triathlon', label: 'Complete a triathlon' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const SLOTS = ['morning', 'afternoon', 'evening', 'rest'];

const AI_PERSONALITIES = [
  { id: 'coach', label: 'Coach', desc: 'Direct, motivating, structured' },
  { id: 'scientist', label: 'Scientist', desc: 'Data-driven, analytical, precise' },
  { id: 'friend', label: 'Friend', desc: 'Encouraging, conversational, supportive' },
];

export default function SettingsTab() {
  const { user, userSettings, signOut } = useAuth();
  const { connected, connectGarmin, disconnectGarmin, lastSyncAt } = useGarminSync();

  // Garmin connection form
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState('');

  // Export / Delete state
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Settings state (initialised from userSettings)
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [secondaryGoals, setSecondaryGoals] = useState([]);
  const [totalHours, setTotalHours] = useState(9);
  const [restDays, setRestDays] = useState(1);
  const [schedule, setSchedule] = useState({});
  const [units, setUnits] = useState('metric');
  const [aiPersonality, setAiPersonality] = useState('coach');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load from userSettings
  useEffect(() => {
    if (!userSettings) return;
    setPrimaryGoal(userSettings.goals?.primaryGoal || '');
    setSecondaryGoals(userSettings.goals?.secondaryGoals || []);
    setTotalHours(userSettings.availability?.totalHoursPerWeek || 9);
    setRestDays(userSettings.availability?.preferredRestDaysPerWeek || 1);
    setSchedule(userSettings.availability?.schedule || {});
    setUnits(userSettings.preferences?.units || 'metric');
    setAiPersonality(userSettings.preferences?.aiPersonality || 'coach');
  }, [userSettings]);

  async function saveSettings() {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    try {
      await setDoc(doc(db, 'users', user.uid), {
        goals: {
          primaryGoal,
          secondaryGoals,
        },
        availability: {
          totalHoursPerWeek: totalHours,
          preferredRestDaysPerWeek: restDays,
          schedule,
        },
        preferences: {
          units,
          aiPersonality,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  }

  function toggleSecondaryGoal(goalId) {
    setSecondaryGoals(prev =>
      prev.includes(goalId) ? prev.filter(g => g !== goalId) : [...prev, goalId]
    );
  }

  function updateScheduleSlot(day, slot) {
    setSchedule(prev => ({
      ...prev,
      [day]: { ...prev[day], slot, durationHours: slot === 'rest' ? 0 : (prev[day]?.durationHours || 1.5) },
    }));
  }

  function updateScheduleDuration(day, hours) {
    setSchedule(prev => ({
      ...prev,
      [day]: { ...prev[day], durationHours: hours },
    }));
  }

  async function handleGarminConnect() {
    setGarminLoading(true);
    setGarminError('');
    try {
      await connectGarmin(garminEmail, garminPassword);
      setGarminEmail('');
      setGarminPassword('');
    } catch (err) {
      setGarminError(err.message || 'Connection failed');
    } finally {
      setGarminLoading(false);
    }
  }

  async function handleGarminDisconnect() {
    if (window.confirm('Disconnect Garmin? Your historical data will be kept.')) {
      await disconnectGarmin();
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportFn = httpsCallable(functions, 'data_export');
      const result = await exportFn();
      const blob = new Blob([JSON.stringify(result.data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vitalsync-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Are you sure you want to delete your account and ALL data? This cannot be undone.')) return;
    if (!window.confirm('This will permanently delete all your health data, training plans, and account. Continue?')) return;

    setDeleting(true);
    try {
      const deleteFn = httpsCallable(functions, 'delete_user_data');
      await deleteFn();
      await signOut();
    } catch (err) {
      console.error('Account deletion failed:', err);
      alert('Account deletion failed. Please try again.');
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Profile ── */}
      <div className="glass-card p-4 flex items-center gap-4">
        {user?.photoURL && (
          <img src={user.photoURL} alt="" className="w-12 h-12 rounded-full border border-slate-700" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{user?.displayName}</p>
          <p className="text-slate-400 text-xs truncate">{user?.email}</p>
        </div>
      </div>

      {/* ── Garmin Connection ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          {"\u231A"} Garmin Connection
        </h3>
        {connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-400 text-sm font-medium">Connected</span>
            </div>
            {lastSyncAt && (
              <p className="text-slate-400 text-xs">Last synced: {lastSyncAt.toLocaleString()}</p>
            )}
            <button onClick={handleGarminDisconnect} className="text-rose-400 text-xs hover:text-rose-300 transition-colors">
              Disconnect Garmin
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-slate-400 text-xs">
              Enter your Garmin Connect credentials. They are encrypted and stored securely.
            </p>
            <input type="email" placeholder="Garmin email" value={garminEmail}
              onChange={e => setGarminEmail(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm
                         placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors" />
            <input type="password" placeholder="Garmin password" value={garminPassword}
              onChange={e => setGarminPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm
                         placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors" />
            {garminError && <p className="text-rose-400 text-xs">{garminError}</p>}
            <button onClick={handleGarminConnect}
              disabled={garminLoading || !garminEmail || !garminPassword}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white
                         hover:bg-emerald-500 disabled:opacity-50 transition-colors">
              {garminLoading ? 'Connecting...' : 'Connect Garmin'}
            </button>
          </div>
        )}
      </div>

      {/* ── Training Goals ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">{"\uD83C\uDFAF"} Training Goals</h3>

        <p className="text-xs text-slate-400 mb-2">Primary Goal</p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {GOALS.map(g => (
            <button key={g.id} onClick={() => setPrimaryGoal(g.id)}
              className={`px-3 py-2 rounded-xl text-xs text-left transition-colors ${
                primaryGoal === g.id
                  ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'
              }`}>
              {g.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-400 mb-2">Secondary Goals (optional)</p>
        <div className="flex flex-wrap gap-1.5">
          {GOALS.filter(g => g.id !== primaryGoal).map(g => (
            <button key={g.id} onClick={() => toggleSecondaryGoal(g.id)}
              className={`px-2.5 py-1 rounded-full text-[10px] transition-colors ${
                secondaryGoals.includes(g.id)
                  ? 'bg-cyan-600/20 border border-cyan-700/50 text-cyan-400'
                  : 'bg-slate-800 border border-slate-700 text-slate-500 hover:border-slate-600'
              }`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Weekly Availability ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">{"\uD83D\uDCC5"} Weekly Availability</h3>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-1">
              <p className="text-xs text-slate-400">Total hours/week</p>
              <p className="text-xs font-mono text-white">{totalHours}h</p>
            </div>
            <input type="range" min="2" max="25" step="0.5" value={totalHours}
              onChange={e => setTotalHours(parseFloat(e.target.value))}
              className="w-full accent-emerald-500" />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <p className="text-xs text-slate-400">Rest days/week</p>
              <p className="text-xs font-mono text-white">{restDays}</p>
            </div>
            <input type="range" min="0" max="3" value={restDays}
              onChange={e => setRestDays(parseInt(e.target.value))}
              className="w-full accent-emerald-500" />
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-2">Daily Schedule</p>
            <div className="space-y-2">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 w-8 font-medium">{DAY_LABELS[day]}</span>
                  <div className="flex gap-1 flex-1">
                    {SLOTS.map(slot => (
                      <button key={slot} onClick={() => updateScheduleSlot(day, slot)}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] capitalize transition-colors ${
                          (schedule[day]?.slot || 'morning') === slot
                            ? slot === 'rest'
                              ? 'bg-slate-600 text-slate-300'
                              : 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                            : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                        }`}>
                        {slot === 'rest' ? 'Rest' : slot.charAt(0).toUpperCase() + slot.slice(1, 3)}
                      </button>
                    ))}
                  </div>
                  {(schedule[day]?.slot || 'morning') !== 'rest' && (
                    <select
                      value={schedule[day]?.durationHours || 1.5}
                      onChange={e => updateScheduleDuration(day, parseFloat(e.target.value))}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-[10px] text-white
                                 focus:outline-none focus:border-emerald-600"
                    >
                      {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(h => (
                        <option key={h} value={h}>{h}h</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Preferences ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">{"\u2699\uFE0F"} Preferences</h3>

        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-400 mb-2">Units</p>
            <div className="flex gap-2">
              {['metric', 'imperial'].map(u => (
                <button key={u} onClick={() => setUnits(u)}
                  className={`flex-1 py-2 rounded-xl text-xs capitalize font-medium transition-colors ${
                    units === u
                      ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                      : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}>
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-2">AI Personality</p>
            <div className="space-y-2">
              {AI_PERSONALITIES.map(p => (
                <button key={p.id} onClick={() => setAiPersonality(p.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                    aiPersonality === p.id
                      ? 'bg-cyan-600/20 border border-cyan-700/50'
                      : 'bg-slate-800 border border-slate-700 hover:border-slate-600'
                  }`}>
                  <p className={`text-xs font-medium ${aiPersonality === p.id ? 'text-cyan-400' : 'text-slate-300'}`}>
                    {p.label}
                  </p>
                  <p className="text-[10px] text-slate-500">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Save Settings ── */}
      <button onClick={saveSettings} disabled={saving}
        className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
          saved
            ? 'bg-emerald-600 text-white'
            : 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400 hover:bg-emerald-600/30'
        } disabled:opacity-50`}>
        {saving ? 'Saving...' : saved ? 'Settings Saved!' : 'Save Settings'}
      </button>

      {/* ── Data & Privacy ── */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-white font-semibold text-sm">Data & Privacy</h3>
        <button onClick={handleExport} disabled={exporting}
          className="text-slate-400 text-xs hover:text-slate-300 block transition-colors disabled:opacity-50">
          {exporting ? 'Exporting...' : 'Export my data'}
        </button>
        <button onClick={handleDeleteAccount} disabled={deleting}
          className="text-rose-400 text-xs hover:text-rose-300 block transition-colors disabled:opacity-50">
          {deleting ? 'Deleting...' : 'Delete my account and all data'}
        </button>
      </div>

      {/* ── Sign Out ── */}
      <button onClick={signOut}
        className="w-full py-3 rounded-xl text-sm font-medium bg-slate-800 border border-slate-700
                   text-slate-300 hover:bg-slate-700 transition-colors">
        Sign Out
      </button>
    </div>
  );
}
