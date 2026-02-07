import { useState } from 'react';
import { useRecentActivities, useActivityStats } from '@/hooks/useGarminData';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const ACTIVITY_COLORS = {
  running: '#10B981',
  cycling: '#06B6D4',
  swimming: '#8B5CF6',
  strength_training: '#F59E0B',
  walking: '#6366F1',
  hiking: '#EC4899',
  yoga: '#14B8A6',
  other: '#94A3B8',
};

function getActivityColor(name) {
  const key = (name || '').toLowerCase().replace(/\s+/g, '_');
  for (const [k, v] of Object.entries(ACTIVITY_COLORS)) {
    if (key.includes(k)) return v;
  }
  return ACTIVITY_COLORS.other;
}

function formatDuration(seconds) {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ActivityCard({ activity }) {
  const name = activity.activityName || activity.activityType?.typeKey || 'Activity';
  const duration = activity.duration || activity.movingDuration || 0;
  const distance = activity.distance ? (activity.distance / 1000).toFixed(1) : null;
  const calories = activity.calories || activity.activeKilocalories || null;
  const date = activity.startTimeLocal?.slice(0, 10) || activity.date || '';
  const color = getActivityColor(name);
  const avgHR = activity.averageHR || activity.avgHr || null;
  const avgPower = activity.avgPower || null;

  return (
    <div className="glass-card p-4">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-white text-sm font-medium truncate">{name}</p>
            <p className="text-slate-500 text-xs flex-shrink-0 ml-2">{date}</p>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {duration > 0 && (
              <span className="text-slate-400 text-xs">{formatDuration(duration)}</span>
            )}
            {distance && (
              <span className="text-slate-400 text-xs">{distance} km</span>
            )}
            {calories && (
              <span className="text-slate-400 text-xs">{calories} kcal</span>
            )}
            {avgHR && (
              <span className="text-slate-400 text-xs">{avgHR} bpm</span>
            )}
            {avgPower && (
              <span className="text-slate-400 text-xs">{avgPower} W</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeeklyStatsChart({ stats }) {
  if (!stats || stats.length === 0) return null;

  const chartData = [...stats].reverse().map((s) => ({
    label: s.periodStart?.slice(5, 10) || s.id?.slice(0, 10) || '',
    hours: s.totalDurationSeconds ? +(s.totalDurationSeconds / 3600).toFixed(1) : 0,
    distance: s.totalDistanceMeters ? +(s.totalDistanceMeters / 1000).toFixed(0) : 0,
    activities: s.activityCount || 0,
  }));

  return (
    <div className="glass-card p-4">
      <p className="text-slate-400 text-xs mb-3">Weekly Training Volume</p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
            labelStyle={{ color: '#94A3B8' }}
          />
          <Bar dataKey="hours" fill="#10B981" radius={[4, 4, 0, 0]} name="Hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActivitySummary({ activities }) {
  const byType = {};
  for (const act of activities) {
    const name = act.activityName || act.activityType?.typeKey || 'Other';
    if (!byType[name]) byType[name] = { count: 0, duration: 0, distance: 0 };
    byType[name].count += 1;
    byType[name].duration += (act.duration || act.movingDuration || 0);
    byType[name].distance += (act.distance || 0);
  }

  const sorted = Object.entries(byType).sort((a, b) => b[1].duration - a[1].duration);

  if (sorted.length === 0) return null;

  return (
    <div className="glass-card p-4">
      <p className="text-slate-400 text-xs mb-3">Activity Breakdown</p>
      <div className="space-y-2">
        {sorted.map(([name, data]) => {
          const color = getActivityColor(name);
          return (
            <div key={name} className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-white text-xs flex-1 truncate">{name}</span>
              <span className="text-slate-400 text-xs">{data.count}x</span>
              <span className="text-slate-500 text-xs w-14 text-right">{formatDuration(data.duration)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TrainingTab() {
  const [view, setView] = useState('activities');
  const { activities, loading: activitiesLoading } = useRecentActivities(30);
  const { stats, loading: statsLoading } = useActivityStats('week', 12);

  const loading = activitiesLoading || statsLoading;

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  // Group activities by month
  const grouped = {};
  for (const act of activities) {
    const date = act.startTimeLocal?.slice(0, 7) || act.date?.slice(0, 7) || 'Unknown';
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(act);
  }

  const totalThisWeek = activities
    .filter((a) => {
      const d = a.startTimeLocal || a.date;
      if (!d) return false;
      const actDate = new Date(d);
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return actDate >= weekAgo;
    });

  const weekDuration = totalThisWeek.reduce((sum, a) => sum + (a.duration || a.movingDuration || 0), 0);
  const weekDistance = totalThisWeek.reduce((sum, a) => sum + (a.distance || 0), 0);

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('activities')}
          className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${
            view === 'activities'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          Activities
        </button>
        <button
          onClick={() => setView('stats')}
          className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${
            view === 'stats'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          Stats
        </button>
      </div>

      {/* This Week Summary */}
      <div className="glass-card p-4">
        <p className="text-slate-400 text-xs mb-2">This Week</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-white text-lg font-semibold">{totalThisWeek.length}</p>
            <p className="text-slate-500 text-[10px]">Activities</p>
          </div>
          <div>
            <p className="text-emerald-400 text-lg font-semibold">{formatDuration(weekDuration)}</p>
            <p className="text-slate-500 text-[10px]">Duration</p>
          </div>
          <div>
            <p className="text-cyan-400 text-lg font-semibold">
              {weekDistance > 0 ? `${(weekDistance / 1000).toFixed(1)}` : '--'}
            </p>
            <p className="text-slate-500 text-[10px]">Km</p>
          </div>
        </div>
      </div>

      {view === 'stats' ? (
        <>
          <WeeklyStatsChart stats={stats} />
          <ActivitySummary activities={activities} />
        </>
      ) : (
        <>
          {activities.length === 0 ? (
            <div className="glass-card p-6 text-center">
              <p className="text-slate-400 text-sm">No activities yet</p>
              <p className="text-slate-500 text-xs mt-1">
                Connect your Garmin in Settings to sync activity data.
              </p>
            </div>
          ) : (
            Object.entries(grouped).map(([month, acts]) => (
              <div key={month}>
                <h3 className="text-slate-400 text-xs font-medium mb-2 uppercase tracking-wider">
                  {month}
                </h3>
                <div className="space-y-2">
                  {acts.map((act) => (
                    <ActivityCard key={act.id} activity={act} />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
