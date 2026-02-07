import { useGarminToday, useGarminWeek, useGarminSync, useRecentActivities } from '@/hooks/useGarminData';
import GarminSyncProgress from '@/components/GarminSyncProgress';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';

function Sparkline({ data, dataKey, color = '#10B981', height = 40 }) {
  if (!data || data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
          labelStyle={{ color: '#94A3B8' }}
          itemStyle={{ color }}
          formatter={(v) => [v, '']}
          labelFormatter={(l) => l}
        />
        <Area type="monotone" dataKey={dataKey} stroke={color} fill={`url(#grad-${dataKey})`} strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MetricCard({ label, value, unit, color = 'text-white', sub }) {
  return (
    <div className="glass-card p-4">
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <p className={`metric-lg ${color}`}>{value}</p>
        {unit && <span className="text-slate-400 text-[10px]">{unit}</span>}
      </div>
      {sub && <p className="text-slate-500 text-[10px] mt-0.5">{sub}</p>}
    </div>
  );
}

function ActivityItem({ activity }) {
  const name = activity.activityName || activity.activityType?.typeKey || 'Activity';
  const duration = activity.duration
    ? `${Math.floor(activity.duration / 60)}m`
    : activity.movingDuration
      ? `${Math.floor(activity.movingDuration / 60)}m`
      : '';
  const distance = activity.distance
    ? `${(activity.distance / 1000).toFixed(1)}km`
    : '';
  const date = activity.startTimeLocal?.slice(0, 10) || activity.date || '';

  return (
    <div className="glass-card p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-xs font-medium">
        {name.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{name}</p>
        <p className="text-slate-400 text-xs">{[duration, distance].filter(Boolean).join(' / ')}</p>
      </div>
      <p className="text-slate-500 text-xs flex-shrink-0">{date}</p>
    </div>
  );
}

export default function DashboardTab() {
  const { data: todayData, loading } = useGarminToday();
  const { data: weekData } = useGarminWeek();
  const { connected, backfillStatus, backfillProgress } = useGarminSync();
  const { activities } = useRecentActivities(5);

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="glass-card h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  const stats = todayData?.stats || {};
  const hr = todayData?.heartRates || {};
  const sleep = todayData?.sleep || {};
  const stress = todayData?.stress || {};
  const hrv = todayData?.hrv || {};
  const spo2 = todayData?.spo2 || {};
  const readiness = todayData?.trainingReadiness || {};

  // Build sparkline data from week
  const weekSteps = weekData.map((d) => ({
    date: d.date?.slice(5),
    steps: d.stats?.totalSteps || 0,
  }));
  const weekHR = weekData.map((d) => ({
    date: d.date?.slice(5),
    hr: d.heartRates?.restingHeartRate || null,
  })).filter((d) => d.hr);
  const weekSleep = weekData.map((d) => ({
    date: d.date?.slice(5),
    hours: d.sleep?.sleepTimeSeconds ? +(d.sleep.sleepTimeSeconds / 3600).toFixed(1) : null,
  })).filter((d) => d.hours);

  const sleepDisplay = sleep?.sleepTimeSeconds
    ? `${Math.floor(sleep.sleepTimeSeconds / 3600)}h ${Math.round((sleep.sleepTimeSeconds % 3600) / 60)}m`
    : '--';

  const hrvValue = hrv?.hrvSummary?.lastNightAvg || hrv?.lastNightAvg || hrv?.weeklyAvg || null;
  const spo2Value = spo2?.averageSpO2 || spo2?.latestSpO2 || null;
  const readinessScore = readiness?.score || readiness?.trainingReadinessScore || null;

  return (
    <div className="space-y-4">
      {backfillStatus === 'syncing' && <GarminSyncProgress progress={backfillProgress} />}

      {/* ── Hero: Resting HR ── */}
      <div className="glass-card p-5">
        <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Resting Heart Rate</p>
        <div className="flex items-baseline gap-2">
          <span className="metric-hero text-emerald-400">{hr?.restingHeartRate || '--'}</span>
          <span className="text-slate-400 text-sm">bpm</span>
        </div>
        {weekHR.length > 1 && <Sparkline data={weekHR} dataKey="hr" color="#10B981" />}
      </div>

      {/* ── Quick Stats Grid ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Steps" value={(stats?.totalSteps || 0).toLocaleString()} />
        <MetricCard label="Calories" value={(stats?.totalKilocalories || 0).toLocaleString()} unit="kcal" />
        <MetricCard label="Sleep" value={sleepDisplay} color="text-cyan-400" />
        <MetricCard label="Body Battery" value={stress?.bodyBatteryHigh || '--'} unit="%" color="text-amber-400" />
      </div>

      {/* ── HRV / SpO2 / Readiness row ── */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="HRV" value={hrvValue || '--'} unit="ms" color="text-purple-400" />
        <MetricCard label="SpO2" value={spo2Value || '--'} unit="%" color="text-blue-400" />
        <MetricCard
          label="Readiness"
          value={readinessScore || '--'}
          color={readinessScore >= 70 ? 'text-emerald-400' : readinessScore >= 40 ? 'text-amber-400' : 'text-rose-400'}
        />
      </div>

      {/* ── 7-day Steps Sparkline ── */}
      {weekSteps.some((d) => d.steps > 0) && (
        <div className="glass-card p-4">
          <p className="text-slate-400 text-xs mb-2">7-day Steps</p>
          <Sparkline data={weekSteps} dataKey="steps" color="#06B6D4" height={50} />
        </div>
      )}

      {/* ── 7-day Sleep Sparkline ── */}
      {weekSleep.length > 1 && (
        <div className="glass-card p-4">
          <p className="text-slate-400 text-xs mb-2">7-day Sleep</p>
          <Sparkline data={weekSleep} dataKey="hours" color="#8B5CF6" height={50} />
        </div>
      )}

      {/* ── Recent Activities ── */}
      {activities.length > 0 && (
        <div>
          <h3 className="text-white font-semibold text-sm mb-2">Recent Activities</h3>
          <div className="space-y-2">
            {activities.slice(0, 5).map((act) => (
              <ActivityItem key={act.id} activity={act} />
            ))}
          </div>
        </div>
      )}

      {/* ── Garmin not connected ── */}
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
