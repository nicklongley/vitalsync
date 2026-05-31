// ══════════════════════════════════════════════════════
// VITALSYNC — Activity Detail
// Summary stats from Firestore + lazy-loaded streams chart from intervals.icu
// ══════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useIntervalsSync } from '@/hooks/useIntervalsData';

// Stable reference — calling httpsCallable directly avoids the render loop
// that hook-returned closures cause when used as effect dependencies.
const fetchStreamsFn = httpsCallable(functions, 'intervals_get_activity_streams');
const fetchPowerCurveFn = httpsCallable(functions, 'intervals_get_activity_power_curve');

function formatBestEffortDuration(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}min`;
  return `${Math.round(secs / 3600)}h`;
}

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
  const { connected } = useIntervalsSync();
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

  // Lazy-load streams + fresh detail from intervals.icu
  const [freshDetail, setFreshDetail] = useState(null);
  const intervalsId = activity?.intervalsId;
  useEffect(() => {
    if (!intervalsId || !connected) return;
    let cancelled = false;
    setStreamsLoading(true);
    setStreamsError('');
    fetchStreamsFn({ intervalsId })
      .then((res) => {
        if (cancelled) return;
        setStreams(res?.data?.streams || null);
        setFreshDetail(res?.data?.detail || null);
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
  }, [intervalsId, connected]);

  // Lazy-load power curve (peaks at canonical durations) for the Best Efforts panel.
  const [powerCurve, setPowerCurve] = useState(null);
  const [powerCurveLoading, setPowerCurveLoading] = useState(false);
  const hasPowerData = !!(activity?.averagePower || activity?.normalizedPower);
  useEffect(() => {
    if (!intervalsId || !connected || !hasPowerData) return;
    let cancelled = false;
    setPowerCurveLoading(true);
    fetchPowerCurveFn({ intervalsId })
      .then((res) => {
        if (cancelled) return;
        setPowerCurve(res?.data || null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Power curve fetch failed:', err);
      })
      .finally(() => {
        if (!cancelled) setPowerCurveLoading(false);
      });
    return () => { cancelled = true; };
  }, [intervalsId, connected, hasPowerData]);

  // Compute peaks from streams as a reliable fallback when detail-endpoint maxes are missing.
  const streamPeaks = useMemo(() => {
    const out = {};
    if (streams?.watts?.length) {
      const max = streams.watts.reduce((m, v) => (v > m ? v : m), 0);
      if (max > 0) out.maxPower = max;
    }
    if (streams?.heartrate?.length) {
      const max = streams.heartrate.reduce((m, v) => (v > m ? v : m), 0);
      if (max > 0) out.maxHR = max;
    }
    return out;
  }, [streams]);

  // Merge fresh intervals.icu detail (if loaded) into the displayed activity, since
  // the synced summary in Firestore may lack some power/HR fields. Stream-derived
  // peaks override when present (most reliable).
  const display = useMemo(
    () => mergeDetail(activity, freshDetail, streamPeaks),
    [activity, freshDetail, streamPeaks]
  );

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

  const typeKey = display.activityType?.typeKey || display.sport || '';
  const icon = SPORT_ICONS[typeKey] || '🎯';
  const badge = sourceBadge(display);
  const distanceKm = display.distance ? (display.distance / 1000).toFixed(2) : null;
  const durationStr = formatDuration(display.duration || display.movingDuration);

  return (
    <div className="space-y-4 animate-fade-in">
      <BackButton onBack={onBack} />

      {/* Header */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-semibold text-white">{display.activityName || 'Activity'}</p>
              {badge && (
                <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{formatDateTime(display.startTimeLocal)}</p>
            {display.deviceName && (
              <p className="text-[10px] text-slate-600 mt-0.5">{display.deviceName}</p>
            )}
          </div>
        </div>
        {display.description && (
          <p className="text-xs text-slate-400 mt-3 leading-relaxed whitespace-pre-line">{display.description}</p>
        )}
      </div>

      {/* Stats grid — power before HR when present (cycling-primary view) */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Duration" value={durationStr} />
        <Stat label="Distance" value={distanceKm ? `${distanceKm} km` : '--'} />
        <Stat label="Elevation" value={display.elevationGain ? `${Math.round(display.elevationGain)} m` : '--'} />
        {(display.averagePower || display.normalizedPower || display.maxPower) && (
          <>
            <Stat
              label="Avg Power"
              value={display.averagePower ? `${Math.round(display.averagePower)} W` : '--'}
              sub={display.avgWkg ? `${display.avgWkg.toFixed(2)} W/kg` : null}
            />
            <Stat
              label="Norm. Power"
              value={display.normalizedPower ? `${Math.round(display.normalizedPower)} W` : '--'}
              sub={display.npWkg ? `${display.npWkg.toFixed(2)} W/kg` : null}
            />
            <Stat
              label="Max Power"
              value={display.maxPower ? `${Math.round(display.maxPower)} W` : '--'}
              sub={display.maxWkg ? `${display.maxWkg.toFixed(2)} W/kg` : null}
            />
          </>
        )}
        <Stat label="Avg HR" value={display.averageHR ? `${Math.round(display.averageHR)} bpm` : '--'} />
        <Stat label="Max HR" value={display.maxHR ? `${Math.round(display.maxHR)} bpm` : '--'} />
        <Stat label="Calories" value={display.calories ? `${display.calories} kcal` : '--'} />
        {(display.tss || display.intensityFactor) && (
          <>
            <Stat label="Training Load" value={display.tss ? Math.round(display.tss) : '--'} />
            <Stat label="Intensity" value={display.intensityFactor ? display.intensityFactor.toFixed(2) : '--'} />
            <Stat label="Avg Cadence" value={display.averageCadence ? Math.round(display.averageCadence) : '--'} />
          </>
        )}
      </div>

      {/* Best Efforts panel — peak watts + W/kg at canonical durations */}
      {connected && hasPowerData && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Best Efforts</p>
          {powerCurveLoading ? (
            <div className="h-14 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
            </div>
          ) : !powerCurve?.peaks?.length ? (
            <p className="text-xs text-slate-500 py-2">No peak data available.</p>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {powerCurve.peaks.map((p) => (
                <div key={p.targetSecs} className="text-center">
                  <p className="text-[9px] text-slate-500 uppercase">{formatBestEffortDuration(p.targetSecs)}</p>
                  <p className="text-sm font-mono font-bold text-white mt-0.5">{Math.round(p.watts || 0)}<span className="text-[9px] text-slate-500 ml-0.5">w</span></p>
                  <p className="text-[10px] text-cyan-400 font-mono">{p.wkg ? p.wkg.toFixed(2) : '--'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

// Merge fresh intervals.icu detail (raw field names) into the persisted Firestore
// activity (Garmin-shape names). Detail wins where present.
function mergeDetail(activity, detail, streamPeaks = {}) {
  if (!activity) return null;
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== 0 && v !== '');
  const d = detail || {};
  const joules = d.icu_joules;
  const kj = d.kilojoules;
  const calories = d.calories
    ?? (kj ? Math.round(kj / 4.184) : (joules ? Math.round(joules / 4184) : activity.calories));

  const averagePower = pick(d.average_watts, d.icu_average_watts, activity.averagePower);
  const normalizedPower = pick(d.icu_weighted_avg_watts, d.weighted_average_watts, activity.normalizedPower);
  const maxPower = pick(streamPeaks.maxPower, d.max_watts, d.icu_max_watts, activity.maxPower);
  // Derive W/kg on the fly when persisted fields are absent (pre-backfill activities)
  // — falls back to the fresh detail's `icu_weight` so the number is still honest.
  const weightAtTime = pick(activity.weightAtTime, d.icu_weight);
  const wkg = (p) => (p && weightAtTime ? Math.round((p / weightAtTime) * 100) / 100 : null);

  return {
    ...activity,
    activityName: pick(d.name, activity.activityName),
    description: pick(d.description, activity.description),
    startTimeLocal: pick(d.start_date_local, activity.startTimeLocal),
    duration: pick(d.elapsed_time, activity.duration),
    movingDuration: pick(d.moving_time, activity.movingDuration),
    distance: pick(d.distance, activity.distance),
    elevationGain: pick(d.total_elevation_gain, activity.elevationGain),
    calories,
    averageHR: pick(d.average_heartrate, d.icu_average_heartrate, activity.averageHR),
    maxHR: pick(streamPeaks.maxHR, d.max_heartrate, d.icu_max_heartrate, activity.maxHR),
    averagePower,
    normalizedPower,
    maxPower,
    weightAtTime,
    avgWkg: activity.avgWkg ?? wkg(averagePower),
    npWkg: activity.npWkg ?? wkg(normalizedPower),
    maxWkg: activity.maxWkg ?? wkg(maxPower),
    averageCadence: pick(d.average_cadence, activity.averageCadence),
    averageSpeed: pick(d.average_speed, activity.averageSpeed),
    maxSpeed: pick(d.max_speed, activity.maxSpeed),
    tss: pick(d.icu_training_load, activity.tss),
    intensityFactor: pick(d.icu_intensity, activity.intensityFactor),
    deviceName: pick(d.device_name, activity.deviceName),
    sourceClient: pick(d.oauth_client_name, activity.sourceClient),
  };
}

function Stat({ label, value, sub }) {
  return (
    <div className="glass-card p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono font-semibold text-white mt-1">{value}</p>
      {sub && <p className="text-[10px] text-cyan-400 font-mono mt-0.5">{sub}</p>}
    </div>
  );
}
