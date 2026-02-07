import { useGarminToday, useGarminSync } from '@/hooks/useGarminData';
import GarminSyncProgress from '@/components/GarminSyncProgress';

export default function DashboardTab() {
  const { data: todayData, loading } = useGarminToday();
  const { connected, backfillStatus, backfillProgress } = useGarminSync();

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

  return (
    <div className="space-y-4">
      {/* Backfill progress */}
      {backfillStatus === 'syncing' && (
        <GarminSyncProgress progress={backfillProgress} />
      )}

      {/* ── Hero Metric: Resting HR ── */}
      <div className="glass-card p-6">
        <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Resting Heart Rate</p>
        <div className="flex items-baseline gap-2">
          <span className="metric-hero text-emerald-400">
            {hr?.restingHeartRate || '--'}
          </span>
          <span className="text-slate-400 text-sm">bpm</span>
        </div>
      </div>

      {/* ── Quick Stats Grid ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass-card p-4">
          <p className="text-slate-400 text-xs mb-1">Steps</p>
          <p className="metric-lg">{(stats?.totalSteps || 0).toLocaleString()}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-slate-400 text-xs mb-1">Calories</p>
          <p className="metric-lg">{(stats?.totalKilocalories || 0).toLocaleString()}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-slate-400 text-xs mb-1">Sleep</p>
          <p className="metric-lg">
            {sleep?.sleepTimeSeconds
              ? `${Math.floor(sleep.sleepTimeSeconds / 3600)}h ${Math.round((sleep.sleepTimeSeconds % 3600) / 60)}m`
              : '--'}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-slate-400 text-xs mb-1">Body Battery</p>
          <p className="metric-lg">{stress?.bodyBatteryHigh || '--'}%</p>
        </div>
      </div>

      {/* ── Garmin not connected prompt ── */}
      {!connected && (
        <div className="glass-card p-6 border-amber-800/40 bg-amber-950/20">
          <p className="text-amber-400 font-medium text-sm mb-1">Connect your Garmin</p>
          <p className="text-slate-400 text-xs">
            Head to Settings to link your Garmin account and start syncing health data.
          </p>
        </div>
      )}
    </div>
  );
}
