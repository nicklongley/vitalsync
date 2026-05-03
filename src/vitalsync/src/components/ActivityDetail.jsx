// ══════════════════════════════════════════════════════
// VITALSYNC — Activity Detail
// Summary stats from Firestore + lazy-loaded streams chart from intervals.icu
// ══════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useIntervalsSync } from '@/hooks/useIntervalsData';

const SPORT_ICONS = {
  running: '🏃', trail_running: '🏃', treadmill_running: '🏃', track_running: '🏃',
  cycling: '🚴', road_biking: '🚴', indoor_cycling: '🚴', virtual_ride: '🚴',
  mountain_biking: '🚴', gravel_cycling: '🚴',
  swimming: '🏊', open_water_swimming: '🏊', lap_swimming: '🏊',
  strength_training: '🏋️', walking: '🚶', hiking: '⛰️', yoga: '🧘',
  elliptical: '🏋️', stair_climbing: '🧗', rowing: '🚣', other: '🎯',
};

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDateTime(s) {
  if (!s) return '--';
  try {
    return new Date(s).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return s;
  }
}

function sourceBadge(act) {
  const device = (act.deviceName || '').toLowerCase();
  const client = (act.sourceClient || '').toLowerCase();
  if (device.includes('hammerhead') || client.includes('hammerhead')) {
    return { label: 'Hammerhead', cls: 'bg-orange-900/40 text-orange-400 border-orange-800/40' };
  }
  if (device.includes('garmin') || client.includes('garmin')) {
    return { label: 'Garmin', cls: 'bg-blue-900/40 text-blue-400 border-blue-800/40' };
  }
  if (client.includes('rouvy')) return { label: 'Rouvy', cls: 'bg-purple-900/40 text-purple-400 border-purple-800/40' };
  if (client.includes('whoosh')) return { label: 'MyWhoosh', cls: 'bg-cyan-900/40 text-cyan-400 border-cyan-800/40' };
  return null;
}

export default function ActivityDetail({ activityId, onBack }) {
  const { user } = useAuth();
  const { getActivityStreams, connected } = useIntervalsSync();
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [streams, setStreams] = useState(null);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [streamsError, setStreamsError] = useState('');

  // Load activity from Firestore
  useEffect(() => {
    if (!user || !activityId) return;
    const ref = doc(db, 'users', user.uid, 'activities', activityId);
    const unsub = onSnapshot(ref, (snap) => {
      setActivity(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, (err) => {
      console.error('Error loading activity:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [user, activityId]);

  // Lazy-load streams from intervals.icu
  useEffect(() => {
    if (!activity?.intervalsId || !connected) return;
    let cancelled = false;
    setStreamsLoading(true);
    setStreamsError('');
    getActivityStreams(activity.intervalsId)
      .then((res) => {
        if (cancelled) return;
        setStreams(res?.data?.streams || null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Streams fetch failed:', err);
        setStreamsError('Could not load chart data.');
      })
      .finally(() => {
        if (!cancelled) setStreamsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activity?.intervalsId, connected, getActivityStreams]);

  // Down-sample streams to <= 300 points for charting
  const chartData = useMemo(() => {
    if (!streams) return [];
    const time = streams.time || [];
    const hr = streams.heartrate || [];
    const watts = streams.watts || [];
    const altitude = streams.altitude || [];
    const len = time.length || hr.length || watts.length || 0;
    if (len === 0) return [];
    const target = 300;
    const stride = Math.max(1, Math.floor(len / target));
    const points = [];
    for (let i = 0; i < len; i += stride) {
      const t = time[i] ?? i;
      points.push({
        t: Math.round(t / 60),  // minutes from start
        hr: hr[i] ?? null,
        power: watts[i] ?? null,
        altitude: altitude[i] ?? null,
      });
    }
    return points;
  }, [streams]);

  const hasPower = chartData.some(p => p.power && p.power > 0);
  const hasHR = chartData.some(p => p.hr && p.hr > 0);

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <BackButton onBack={onBack} />
        <div className="glass-card h-32 animate-pulse" />
        <div className="glass-card h-48 animate-pulse" />
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <div className="glass-card p-6 text-center">
          <p className="text-sm text-slate-400">Activity not found.</p>
        </div>
      </div>
    );
  }

  const typeKey = activity.activityType?.typeKey || activity.sport || '';
  const icon = SPORT_ICONS[typeKey] || '🎯';
  const badge = sourceBadge(activity);
  const distanceKm = activity.distance ? (activity.distance / 1000).toFixed(2) : null;
  const durationStr = formatDuration(activity.duration || activity.movingDuration);

  return (
    <div className="space-y-4 animate-fade-in">
      <BackButton onBack={onBack} />

      {/* Header */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-semibold text-white">{activity.activityName || 'Activity'}</p>
              {badge && (
                <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{formatDateTime(activity.startTimeLocal)}</p>
            {activity.deviceName && (
              <p className="text-[10px] text-slate-600 mt-0.5">{activity.deviceName}</p>
            )}
          </div>
        </div>
        {activity.description && (
          <p className="text-xs text-slate-400 mt-3 leading-relaxed whitespace-pre-line">{activity.description}</p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Duration" value={durationStr} />
        <Stat label="Distance" value={distanceKm ? `${distanceKm} km` : '--'} />
        <Stat label="Elevation" value={activity.elevationGain ? `${Math.round(activity.elevationGain)} m` : '--'} />
        <Stat label="Avg HR" value={activity.averageHR ? `${Math.round(activity.averageHR)} bpm` : '--'} />
        <Stat label="Max HR" value={activity.maxHR ? `${Math.round(activity.maxHR)} bpm` : '--'} />
        <Stat label="Calories" value={activity.calories ? `${activity.calories} kcal` : '--'} />
        {(activity.averagePower || activity.normalizedPower) && (
          <>
            <Stat label="Avg Power" value={activity.averagePower ? `${Math.round(activity.averagePower)} W` : '--'} />
            <Stat label="Norm. Power" value={activity.normalizedPower ? `${Math.round(activity.normalizedPower)} W` : '--'} />
            <Stat label="Max Power" value={activity.maxPower ? `${Math.round(activity.maxPower)} W` : '--'} />
          </>
        )}
        {(activity.tss || activity.intensityFactor) && (
          <>
            <Stat label="Training Load" value={activity.tss ? Math.round(activity.tss) : '--'} />
            <Stat label="Intensity" value={activity.intensityFactor ? activity.intensityFactor.toFixed(2) : '--'} />
            <Stat label="Avg Cadence" value={activity.averageCadence ? Math.round(activity.averageCadence) : '--'} />
          </>
        )}
      </div>

      {/* Streams chart */}
      {connected && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">
            {hasPower && hasHR ? 'Power & Heart Rate' : hasPower ? 'Power' : hasHR ? 'Heart Rate' : 'Activity'}
          </p>
          {streamsLoading ? (
            <div className="h-40 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            </div>
          ) : streamsError ? (
            <p className="text-xs text-rose-400 py-4">{streamsError}</p>
          ) : chartData.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No stream data available.</p>
          ) : (
            <div className="h-48 mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: 'min', position: 'insideBottomRight', offset: -2, fill: '#64748b', fontSize: 10 }}
                  />
                  <YAxis hide yAxisId="left" />
                  {hasPower && hasHR && <YAxis hide yAxisId="right" orientation="right" />}
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#94a3b8' }}
                    labelFormatter={(t) => `${t} min`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {hasPower && (
                    <Line yAxisId="left" type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Power (W)" connectNulls />
                  )}
                  {hasHR && (
                    <Line yAxisId={hasPower ? 'right' : 'left'} type="monotone" dataKey="hr" stroke="#ef4444" strokeWidth={1.5} dot={false} name="HR (bpm)" connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button
      onClick={onBack}
      className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors min-h-[36px] -ml-1 px-1"
    >
      <span>‹</span> Back
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="glass-card p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono font-semibold text-white mt-1">{value}</p>
    </div>
  );
}
