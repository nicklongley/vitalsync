// ══════════════════════════════════════════════════════
// VITALSYNC — Settings Tab
// Profile, Garmin, Goals, Availability, Preferences, Data
// Design ref: vitalsync-dashboard.jsx lines 551-610
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminSync } from '@/hooks/useGarminData';

const GOALS = [
  { id: 'improve_ftp', label: 'Build cycling FTP' },
  { id: 'run_faster', label: 'Run faster / further' },
  { id: 'lose_weight', label: 'Improve body composition' },
  { id: 'build_endurance', label: 'Build endurance' },
  { id: 'improve_sleep', label: 'Sleep better' },
  { id: 'manage_stress', label: 'Manage stress' },
  { id: 'improve_health', label: 'General health tracking' },
  { id: 'triathlon', label: 'Complete a triathlon' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const SLOTS = ['morning', 'afternoon', 'evening', 'rest'];
const SLOT_LABELS = { morning: '\u2600\uFE0F AM', afternoon: '\u2615 Mid', evening: '\uD83C\uDF19 PM', rest: '\uD83D\uDECC Rest' };

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
  const [showPassword, setShowPassword] = useState(false);

  // Export / Delete state
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Profile fields (needed for cycling W/kg, age-adjusted FTP)
  const [weight, setWeight] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('male');
  const [height, setHeight] = useState('');

  // Settings state
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [secondaryGoals, setSecondaryGoals] = useState([]);
  const [totalHours, setTotalHours] = useState(9);
  const [restDays, setRestDays] = useState(1);
  const [schedule, setSchedule] = useState({});
  const [units, setUnits] = useState('metric');
  const [aiPersonality, setAiPersonality] = useState('coach');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

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
    setWeight(userSettings.profile?.weight || '');
    setAge(userSettings.profile?.age || '');
    setGender(userSettings.profile?.gender || 'male');
    setHeight(userSettings.profile?.height || '');
  }, [userSettings]);

  async function saveSettings() {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      await setDoc(doc(db, 'users', user.uid), {
        profile: {
          weight: weight ? parseFloat(weight) : null,
          age: age ? parseInt(age) : null,
          gender,
          height: height ? parseFloat(height) : null,
        },
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
      setSaveError('Failed to save. Please try again.');
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

  // Compute scheduled total
  const scheduledTotal = DAYS.reduce((sum, day) => {
    const slot = schedule[day];
    if (!slot || slot.slot === 'rest') return sum;
    return sum + (slot.durationHours || 1.5);
  }, 0);

  async function handleGarminConnect() {
    if (!garminEmail || !garminPassword) return;
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(garminEmail)) {
      setGarminError('Please enter a valid email address');
      return;
    }
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
    setShowDeleteConfirm(false);
    await disconnectGarmin();
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
      <div className="glass-card p-4">
        <div className="flex items-center gap-4 mb-4">
          {user?.photoURL && (
            <img src={user.photoURL} alt="" className="w-12 h-12 rounded-full border border-slate-700" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium truncate">{user?.displayName}</p>
            <p className="text-slate-400 text-xs truncate">{user?.email}</p>
          </div>
        </div>

        {/* Physical profile fields */}
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Physical Profile</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Weight ({units === 'imperial' ? 'lbs' : 'kg'})</label>
            <input type="number" step="0.1" placeholder={units === 'imperial' ? '175' : '80'} value={weight}
              onChange={e => setWeight(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm
                         placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Height ({units === 'imperial' ? 'in' : 'cm'})</label>
            <input type="number" placeholder={units === 'imperial' ? '70' : '178'} value={height}
              onChange={e => setHeight(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm
                         placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Age</label>
            <input type="number" min="15" max="100" placeholder="35" value={age}
              onChange={e => setAge(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm
                         placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 block mb-1">Gender</label>
            <div className="flex gap-1">
              {['male', 'female', 'other'].map(g => (
                <button key={g} onClick={() => setGender(g)}
                  className={`flex-1 py-2.5 rounded-xl text-xs capitalize font-medium transition-colors min-h-[44px] ${
                    gender === g
                      ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                      : 'bg-slate-800 border border-slate-700 text-slate-400'
                  }`}>
                  {g === 'male' ? 'M' : g === 'female' ? 'F' : 'O'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">
          Used for W/kg, age-adjusted performance, and calorie estimates.
        </p>
      </div>

      {/* ── Garmin Connection ── */}
      <div className="glass-card p-5">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Garmin Connection</p>
        {connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-400 text-sm font-medium">Connected</span>
            </div>
            {lastSyncAt && (
              <p className="text-slate-400 text-xs">Last synced: {lastSyncAt.toLocaleString()}</p>
            )}
            <button onClick={handleGarminDisconnect}
              className="text-rose-400 text-xs hover:text-rose-300 transition-colors py-2 min-h-[44px]">
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
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} placeholder="Garmin password" value={garminPassword}
                onChange={e => setGarminPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGarminConnect()}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 pr-12 text-white text-sm
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors" />
              <button onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs min-w-[44px] min-h-[44px] flex items-center justify-center">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {garminError && <p className="text-rose-400 text-xs">{garminError}</p>}
            <button onClick={handleGarminConnect}
              disabled={garminLoading || !garminEmail || !garminPassword}
              className="w-full py-3 rounded-xl text-sm font-medium bg-emerald-600 text-white
                         hover:bg-emerald-500 disabled:opacity-50 transition-colors min-h-[44px]">
              {garminLoading ? 'Connecting...' : 'Connect Garmin'}
            </button>
          </div>
        )}
      </div>

      {/* ── Training Goals ── */}
      <div className="glass-card p-5">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Training Goals</p>

        <p className="text-xs text-slate-400 mb-2">Primary Goal</p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {GOALS.map(g => (
            <button key={g.id} onClick={() => setPrimaryGoal(g.id)}
              className={`px-3 py-3 rounded-xl text-xs text-left transition-colors min-h-[44px] ${
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
              className={`px-3 py-2 rounded-full text-xs transition-colors min-h-[36px] ${
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
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Weekly Availability</p>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-1">
              <p className="text-xs text-slate-400">Total hours/week</p>
              <p className="text-sm font-mono font-bold text-white">{totalHours}h</p>
            </div>
            <input type="range" min="2" max="25" step="0.5" value={totalHours}
              onChange={e => setTotalHours(parseFloat(e.target.value))}
              className="w-full accent-emerald-500" />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <p className="text-xs text-slate-400">Rest days/week</p>
              <p className="text-sm font-mono font-bold text-white">{restDays}</p>
            </div>
            <input type="range" min="0" max="3" value={restDays}
              onChange={e => setRestDays(parseInt(e.target.value))}
              className="w-full accent-emerald-500" />
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-2">Daily Schedule</p>
            <div className="space-y-2">
              {DAYS.map(day => (
                <div key={day} className={`flex items-center gap-2 py-2 px-2 rounded-lg ${
                  (schedule[day]?.slot || 'morning') === 'rest' ? 'bg-slate-700/30' : 'bg-slate-700/50'
                }`}>
                  <span className="text-xs text-slate-300 w-8 font-medium">{DAY_LABELS[day]}</span>
                  <div className="flex gap-1 flex-1">
                    {SLOTS.map(slot => (
                      <button key={slot} onClick={() => updateScheduleSlot(day, slot)}
                        className={`flex-1 py-2 rounded-lg text-[10px] transition-colors min-h-[36px] ${
                          (schedule[day]?.slot || 'morning') === slot
                            ? slot === 'rest'
                              ? 'bg-slate-600 text-slate-300'
                              : 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                            : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                        }`}>
                        {SLOT_LABELS[slot]}
                      </button>
                    ))}
                  </div>
                  {(schedule[day]?.slot || 'morning') !== 'rest' && (
                    <select
                      value={schedule[day]?.durationHours || 1.5}
                      onChange={e => updateScheduleDuration(day, parseFloat(e.target.value))}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-[10px] text-white
                                 focus:outline-none focus:border-emerald-600 min-h-[36px]"
                    >
                      {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(h => (
                        <option key={h} value={h}>{h}h</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
            {/* Schedule total */}
            <div className={`mt-2 text-xs text-center py-1.5 rounded-lg ${
              Math.abs(scheduledTotal - totalHours) <= 0.5 ? 'text-emerald-400 bg-emerald-950/30' :
              'text-amber-400 bg-amber-950/30'
            }`}>
              Scheduled: {scheduledTotal.toFixed(1)}h / {totalHours}h per week
            </div>
          </div>
        </div>
      </div>

      {/* ── Preferences ── */}
      <div className="glass-card p-5">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Preferences</p>

        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-400 mb-2">Units</p>
            <div className="flex gap-2">
              {['metric', 'imperial'].map(u => (
                <button key={u} onClick={() => setUnits(u)}
                  className={`flex-1 py-2.5 rounded-xl text-xs capitalize font-medium transition-colors min-h-[44px] ${
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
                  className={`w-full text-left px-3 py-3 rounded-xl transition-colors min-h-[44px] ${
                    aiPersonality === p.id
                      ? 'bg-cyan-600/20 border border-cyan-700/50'
                      : 'bg-slate-800 border border-slate-700 hover:border-slate-600'
                  }`}>
                  <p className={`text-xs font-medium ${aiPersonality === p.id ? 'text-cyan-400' : 'text-slate-300'}`}>
                    {p.label}
                  </p>
                  <p className="text-xs text-slate-400">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Save Settings ── */}
      <button onClick={saveSettings} disabled={saving}
        className={`w-full py-3 rounded-xl text-sm font-medium transition-all min-h-[44px] ${
          saved
            ? 'bg-emerald-600 text-white'
            : 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400 hover:bg-emerald-600/30'
        } disabled:opacity-50`}>
        {saving ? 'Saving...' : saved ? 'Settings Saved!' : 'Save Settings'}
      </button>
      {saveError && <p className="text-xs text-rose-400 text-center">{saveError}</p>}

      {/* ── Data & Privacy ── */}
      <div className="glass-card p-5 space-y-2">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Data & Privacy</p>
        <button onClick={handleExport} disabled={exporting}
          className="w-full text-left py-3 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-sm
                     hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]">
          {exporting ? 'Exporting...' : 'Export my data'}
        </button>
        <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting}
          className="w-full text-left py-3 px-3 rounded-xl bg-slate-800 border border-rose-800/40 text-rose-400 text-sm
                     hover:bg-rose-950/30 disabled:opacity-50 transition-colors min-h-[44px]">
          {deleting ? 'Deleting...' : 'Delete my account and all data'}
        </button>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 max-w-sm w-full space-y-4 animate-fade-in border border-rose-800/40">
            <p className="text-lg font-bold text-white">Delete Account?</p>
            <p className="text-sm text-slate-300">
              This will permanently delete all your health data, training plans, AI insights, and account. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-slate-800 border border-slate-700 text-slate-300
                           hover:bg-slate-700 transition-colors min-h-[44px]">
                Cancel
              </button>
              <button onClick={handleDeleteAccount} disabled={deleting}
                className="flex-1 py-3 rounded-xl text-sm font-medium bg-rose-600 text-white
                           hover:bg-rose-500 disabled:opacity-50 transition-colors min-h-[44px]">
                {deleting ? 'Deleting...' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sign Out ── */}
      <button onClick={signOut}
        className="w-full py-3 rounded-xl text-sm font-medium bg-slate-800 border border-slate-700
                   text-slate-300 hover:bg-slate-700 transition-colors min-h-[44px]">
        Sign Out
      </button>
    </div>
  );
}
