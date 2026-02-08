// ══════════════════════════════════════════════════════
// VITALSYNC — Dashboard Tab
// Today's snapshot: gauges, weekly trends, activities, AI
// ══════════════════════════════════════════════════════

import { useGarminToday, useGarminWeek, useGarminSync, useRecentActivities } from '@/hooks/useGarminData';
import { useAuth } from '@/contexts/AuthContext';
import { GaugeRing, MetricCard, ActionPrompt } from '@/components/shared';
import GarminSyncProgress from '@/components/GarminSyncProgress';

export default function DashboardTab() {
  const { user, userSettings } = useAuth();
  const { data: todayData, loading } = useGarminToday();
  const { data: weekData } = useGarminWeek();
  const { connected, backfillStatus, backfillProgress, syncing, syncNow, lastSyncAt } = useGarminSync();
  const { activities } = useRecentActivities(5);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  const stats = todayData?.stats || {};
  const hr = todayData?.heartRates || {};
  const sleep = todayData?.sleep || {};
  const stress = todayData?.stress || {};
  const bodyBattery = todayData?.bodyBattery || {};
  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.displayName?.split(' ')[0] || 'Athlete';

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div>
        <h2 className="text-lg font-bold text-white">{greeting}, {firstName}</h2>
        <p className="text-xs text-slate-400">
          {connected
            ? `Last synced ${lastSyncAt ? formatTimeAgo(lastSyncAt) : 'recently'}`
            : 'Connect Garmin to see your data'}
        </p>
      </div>

      {/* Backfill progress */}
      {backfillStatus === 'syncing' && (
        <GarminSyncProgress progress={backfillProgress} />
      )}

      {/* Garmin not connected */}
      {!connected && (
        <ActionPrompt
          icon={"\u231A"}
          title="Connect your Garmin"
          subtitle="Link your Garmin account to sync health data, activities, and training metrics automatically."
          cta="Go to Settings"
          accent="amber"
          dismissible={false}
        />
      )}

      {/* ── Gauge Rings: Key Metrics ── */}
      <div className="glass-card p-5">
        <div className="flex justify-between items-start mb-1">
          <p className="text-xs text-slate-400 uppercase tracking-wider">Today's Snapshot</p>
          {connected && (
            <button
              onClick={syncNow}
              disabled={syncing}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 transition-colors"
            >
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
          )}
        </div>
        <div className="flex justify-around items-center py-2">
          <GaugeRing
            value={stats.totalSteps || 0}
            max={10000}
            color="#10b981"
            size={72}
            label="Steps"
          />
          <GaugeRing
            value={stats.totalKilocalories || 0}
            max={3000}
            color="#f97316"
            size={72}
            label="Calories"
          />
          <GaugeRing
            value={stress.bodyBatteryHigh || bodyBattery.bodyBatteryHigh || 0}
            max={100}
            color="#06b6d4"
            size={72}
            label="Battery"
          />
          <GaugeRing
            value={hr.restingHeartRate || 0}
            max={100}
            color="#ef4444"
            size={72}
            label="RHR"
          />
        </div>
      </div>

      {/* ── Quick Stats Cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={"\uD83D\uDEB6"}
          title="Steps"
          value={(stats.totalSteps || 0).toLocaleString()}
          subtitle={`Goal: ${(stats.dailyStepGoal || 10000).toLocaleString()}`}
        />
        <MetricCard
          icon={"\u2764\uFE0F"}
          title="Resting HR"
          value={hr.restingHeartRate || '--'}
          unit="bpm"
          subtitle={`Max: ${hr.maxHeartRate || '--'} bpm`}
        />
        <MetricCard
          icon={"\uD83D\uDE34"}
          title="Sleep"
          value={sleep.sleepTimeSeconds
            ? `${Math.floor(sleep.sleepTimeSeconds / 3600)}h ${Math.round((sleep.sleepTimeSeconds % 3600) / 60)}m`
            : '--'}
          subtitle={sleep.sleepScores?.overall?.value ? `Score: ${sleep.sleepScores.overall.value}` : ''}
        />
        <MetricCard
          icon={"\u26A1"}
          title="Body Battery"
          value={stress.bodyBatteryHigh || bodyBattery.bodyBatteryHigh || '--'}
          unit="%"
          subtitle={`Low: ${stress.bodyBatteryLow || bodyBattery.bodyBatteryLow || '--'}%`}
        />
      </div>

      {/* ── Weekly Trend ── */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">7-Day Steps</p>
        <div className="flex items-end justify-between gap-1 h-20">
          {(weekData.length > 0 ? weekData : mockWeekData()).map((day, i) => {
            const steps = day.stats?.totalSteps || 0;
            const maxSteps = 15000;
            const pct = Math.min(steps / maxSteps, 1);
            const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
            return (
              <div key={i} className="flex flex-col items-center flex-1 gap-1">
                <div className="w-full max-w-[28px] rounded-t-md bg-slate-700 relative" style={{ height: '64px' }}>
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-500"
                    style={{ height: `${pct * 100}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-500">{dayLabel}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recent Activities ── */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Recent Activities</p>
        {activities.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No activities yet. Sync your Garmin to see recent workouts.</p>
        ) : null}
        {activities.map((act, i) => {
          const sportIcon = SPORT_ICONS[act.activityType || act.sport] || '\uD83C\uDFC3';
          return (
            <div key={act.id || i} className="flex items-center gap-3 py-2 border-b border-slate-800/50 last:border-0">
              <span className="text-lg">{sportIcon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{act.activityName || act.name}</p>
                <p className="text-[10px] text-slate-500">
                  {act.startTimeLocal || act.date || ''}
                  {act.distance ? ` \u00B7 ${(act.distance / 1000).toFixed(1)} km` : ''}
                  {act.duration ? ` \u00B7 ${Math.round(act.duration / 60)}min` : ''}
                </p>
              </div>
              {(act.averageHR || act.hr) && (
                <span className="text-[10px] text-slate-400 font-mono">{act.averageHR || act.hr} bpm</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Sync button (when connected) ── */}
      {connected && (
        <button
          onClick={syncNow}
          disabled={syncing}
          className="w-full py-3 rounded-xl bg-emerald-600/20 border border-emerald-800/40 text-emerald-400 text-sm font-medium
                     hover:bg-emerald-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {syncing ? 'Syncing...' : 'Sync Garmin Data'}
        </button>
      )}

    </div>
  );
}

// ── Helpers ──

const SPORT_ICONS = {
  running: '\uD83C\uDFC3',
  cycling: '\uD83D\uDEB4',
  swimming: '\uD83C\uDFCA',
  strength_training: '\uD83C\uDFCB\uFE0F',
  walking: '\uD83D\uDEB6',
  hiking: '\u26F0\uFE0F',
  yoga: '\uD83E\uDDD8',
  other: '\uD83C\uDFAF',
};

function mockWeekData() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ date: d.toISOString().split('T')[0] });
  }
  return days;
}

function formatTimeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
