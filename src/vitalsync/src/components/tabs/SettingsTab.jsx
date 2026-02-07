import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminSync } from '@/hooks/useGarminData';
import GarminSyncProgress from '@/components/GarminSyncProgress';

export default function SettingsTab() {
  const { user, userSettings, signOut } = useAuth();
  const {
    connected,
    displayName: garminDisplayName,
    backfillStatus,
    backfillProgress,
    lastSyncAt,
    syncing,
    syncNow,
    connectGarmin,
    disconnectGarmin,
  } = useGarminSync();

  // Garmin connection form
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState('');
  const [garminSuccess, setGarminSuccess] = useState('');

  async function handleGarminConnect(e) {
    e.preventDefault();
    setGarminLoading(true);
    setGarminError('');
    setGarminSuccess('');
    try {
      const result = await connectGarmin(garminEmail, garminPassword);
      setGarminEmail('');
      setGarminPassword('');
      setGarminSuccess(
        result?.displayName
          ? `Connected as ${result.displayName}`
          : 'Connected successfully'
      );
    } catch (err) {
      // Firebase callable errors: err.code, err.message, err.details
      const msg =
        err?.details?.message ||
        err?.message?.replace(/^.*?:\s*/, '') ||
        'Connection failed. Check your credentials and try again.';
      setGarminError(msg);
    } finally {
      setGarminLoading(false);
    }
  }

  async function handleGarminDisconnect() {
    if (!window.confirm('Disconnect Garmin? Your historical data will be kept.')) return;
    try {
      await disconnectGarmin();
      setGarminSuccess('');
    } catch (err) {
      setGarminError(err?.message || 'Disconnect failed');
    }
  }

  async function handleSyncNow() {
    try {
      await syncNow();
    } catch (err) {
      console.error('Sync failed:', err);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Profile ── */}
      <div className="glass-card p-4 flex items-center gap-4">
        {user?.photoURL ? (
          <img
            src={user.photoURL}
            alt=""
            className="w-12 h-12 rounded-full border border-slate-700"
          />
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
          <span className="text-base">{"\u231A"}</span>
          Garmin Connection
        </h3>

        {connected ? (
          <div className="space-y-3">
            {/* Connected status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-slow" />
                <span className="text-emerald-400 text-sm font-medium">Connected</span>
              </div>
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="text-xs text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
            </div>

            {/* Garmin display name */}
            {garminDisplayName && (
              <p className="text-slate-300 text-sm">
                {garminDisplayName}
              </p>
            )}

            {/* Last sync time */}
            {lastSyncAt && (
              <p className="text-slate-500 text-xs">
                Last synced: {lastSyncAt.toLocaleString()}
              </p>
            )}

            {/* Backfill progress */}
            {backfillStatus === 'syncing' && (
              <GarminSyncProgress progress={backfillProgress} />
            )}

            {/* Disconnect */}
            <button
              onClick={handleGarminDisconnect}
              className="text-rose-400 text-xs hover:text-rose-300 transition-colors mt-1"
            >
              Disconnect Garmin
            </button>
          </div>
        ) : (
          <form onSubmit={handleGarminConnect} className="space-y-3">
            <p className="text-slate-400 text-xs leading-relaxed">
              Enter your Garmin Connect credentials. They are encrypted with AES-256 and stored
              securely on our servers — your password is never saved, only the OAuth session token.
            </p>
            <input
              type="email"
              placeholder="Garmin email"
              value={garminEmail}
              onChange={(e) => setGarminEmail(e.target.value)}
              autoComplete="email"
              disabled={garminLoading}
              className="input-field w-full"
            />
            <input
              type="password"
              placeholder="Garmin password"
              value={garminPassword}
              onChange={(e) => setGarminPassword(e.target.value)}
              autoComplete="current-password"
              disabled={garminLoading}
              className="input-field w-full"
            />

            {/* Error message */}
            {garminError && (
              <p className="text-rose-400 text-xs">{garminError}</p>
            )}

            {/* Success message */}
            {garminSuccess && (
              <p className="text-emerald-400 text-xs">{garminSuccess}</p>
            )}

            <button
              type="submit"
              disabled={garminLoading || !garminEmail || !garminPassword}
              className="btn-cta-sm w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {garminLoading && (
                <div className="w-4 h-4 rounded-full border-2 border-midnight border-t-transparent animate-spin" />
              )}
              {garminLoading ? 'Connecting...' : 'Connect Garmin'}
            </button>
          </form>
        )}
      </div>

      {/* ── Training Goals (placeholder) ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">
          {"\uD83C\uDFAF"} Training Goals
        </h3>
        <p className="text-slate-400 text-xs">
          Primary goal, secondary goals, and numeric targets for AI plan generation.
        </p>
        <div className="mt-3 text-slate-500 text-xs text-center py-4 border border-dashed border-slate-700 rounded-xl">
          Goal settings UI coming soon
        </div>
      </div>

      {/* ── Weekly Availability (placeholder) ── */}
      <div className="glass-card p-5">
        <h3 className="text-white font-semibold text-sm mb-3">
          {"\uD83D\uDCC5"} Weekly Availability
        </h3>
        <p className="text-slate-400 text-xs">
          Total training hours, day-by-day schedule, sport priorities.
        </p>
        <div className="mt-3 text-slate-500 text-xs text-center py-4 border border-dashed border-slate-700 rounded-xl">
          Availability settings UI coming soon
        </div>
      </div>

      {/* ── Data & Privacy ── */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-white font-semibold text-sm">Data & Privacy</h3>
        <button className="text-slate-400 text-xs hover:text-slate-300 block transition-colors">
          Export my data
        </button>
        <button className="text-rose-400 text-xs hover:text-rose-300 block transition-colors">
          Delete my account and all data
        </button>
      </div>

      {/* ── Sign Out ── */}
      <button
        onClick={signOut}
        className="btn-secondary w-full"
      >
        Sign Out
      </button>
    </div>
  );
}
