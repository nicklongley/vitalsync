// ══════════════════════════════════════════════════════
// VITALSYNC — Dashboard Tab
// Today's snapshot: gauges, weekly trends, activities, AI
// Design ref: vitalsync-dashboard.jsx lines 296-360
// ══════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db } from '@/lib/firebase';
import { useGarminToday, useGarminWeek, useGarminSync, useRecentActivities } from '@/hooks/useGarminData';
import { useAuth } from '@/contexts/AuthContext';
import { GaugeRing, MetricCard, ActionPrompt, InterventionCard } from '@/components/shared';
import GarminSyncProgress from '@/components/GarminSyncProgress';

export default function DashboardTab() {
  const { user, userSettings } = useAuth();
  const { data: todayData, loading } = useGarminToday();
  const { data: weekData } = useGarminWeek();
  const { connected, backfillStatus, backfillProgress, syncing, syncNow, lastSyncAt } = useGarminSync();
  const { activities } = useRecentActivities(5);
  const [dismissedPrompts, setDismissedPrompts] = useState([]);
  const [interventions, setInterventions] = useState([]);
  const [loadingInterventions, setLoadingInterventions] = useState(true);

  // Listen to interventions
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'interventions'),
      orderBy('createdAt', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      setInterventions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingInterventions(false);
    }, (err) => {
      console.error('Error loading interventions:', err);
      setLoadingInterventions(false);
    });
    return () => unsub();
  }, [user]);

  // Compute trends from week data
  const trends = useMemo(() => {
    if (!weekData || weekData.length < 4) return {};
    const recent = weekData.slice(-3);
    const earlier = weekData.slice(0, 4);

    function avg(arr, fn) {
      const vals = arr.map(fn).filter(v => v > 0);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }

    const recentRHR = avg(recent, d => d.heartRates?.restingHeartRate || 0);
    const earlierRHR = avg(earlier, d => d.heartRates?.restingHeartRate || 0);
    const rhrDiff = earlierRHR > 0 ? Math.round(recentRHR - earlierRHR) : 0;

    return { rhrDiff };
  }, [weekData]);

  // HR 7-day chart data
  const hrChartData = useMemo(() => {
    if (!weekData || weekData.length === 0) return [];
    return weekData.map(day => {
      const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return {
        day: dayLabel,
        resting: day.heartRates?.restingHeartRate || null,
        avg: day.heartRates?.averageHeartRate || null,
      };
    });
  }, [weekData]);

  // HRV average from week data
  const weekHRV = useMemo(() => {
    if (!weekData) return 0;
    const vals = weekData.map(d => d.heartRates?.hrvStatus || d.sleep?.averageHRV || 0).filter(v => v > 0);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }, [weekData]);

  // FTP from user settings
  const ftp = userSettings?.profile?.ftp || userSettings?.garmin?.ftp || 0;
  const weight = userSettings?.profile?.weight || 0;
  const wkg = ftp && weight ? (ftp / weight).toFixed(2) : null;

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.displayName?.split(' ')[0] || 'Athlete';

  const bbValue = stress.bodyBatteryHigh || bodyBattery.bodyBatteryHigh || 0;
  const sleepScore = sleep.sleepScores?.overall?.value || 0;
  // Readiness: composite of body battery + sleep score
  const readiness = bbValue && sleepScore ? Math.round((bbValue + sleepScore) / 2) : bbValue || sleepScore || 0;

  function dismiss(key) {
    setDismissedPrompts(prev => [...prev, key]);
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Greeting + Sync ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">{greeting}, {firstName}</h2>
          <p className="text-xs text-slate-400">
            {connected
              ? `Last synced ${lastSyncAt ? formatTimeAgo(lastSyncAt) : 'recently'}`
              : 'Connect Garmin to see your data'}
          </p>
        </div>
        {connected && (
          <button
            onClick={syncNow}
            disabled={syncing}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 border border-emerald-800/40 text-emerald-400
                       hover:bg-emerald-600/30 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        )}
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

      {/* ── Gauge Rings: Body Battery / Sleep Score / Readiness ── */}
      <div className="glass-card p-5">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Today's Snapshot</p>
        <div className="flex justify-around items-center">
          <GaugeRing value={bbValue} max={100} color="#34d399" size={76} label="Body Battery" />
          <GaugeRing value={sleepScore} max={100} color="#818cf8" size={76} label="Sleep Score" />
          <GaugeRing value={readiness} max={100} color="#f59e0b" size={76} label="Readiness" />
        </div>
      </div>

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={"\u2764\uFE0F"}
          title="Resting HR"
          value={hr.restingHeartRate || '--'}
          unit="bpm"
          subtitle={trends.rhrDiff
            ? `${trends.rhrDiff > 0 ? '\u2191' : '\u2193'}${Math.abs(trends.rhrDiff)} from last week`
            : ''}
        />
        <MetricCard
          icon={"\uD83D\uDC9A"}
          title="HRV"
          value={weekHRV || hr.hrvStatus || '--'}
          unit="ms"
          subtitle={weekHRV ? `Weekly avg: ${weekHRV}ms` : ''}
        />
        <MetricCard
          icon={"\uD83D\uDC63"}
          title="Steps"
          value={(stats.totalSteps || 0).toLocaleString()}
          subtitle={`Target: ${(stats.dailyStepGoal || 10000).toLocaleString()}`}
        />
        <MetricCard
          icon={"\u26A1"}
          title="FTP"
          value={ftp ? `${ftp}W` : '--'}
          subtitle={wkg ? `${wkg} W/kg` : 'Set in Settings'}
        />
      </div>

      {/* ── HR 7-Day Line Chart ── */}
      {hrChartData.some(d => d.resting || d.avg) && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Heart Rate \u2014 7 Days</p>
          <div className="h-32 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hrChartData}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line type="monotone" dataKey="resting" stroke="#34d399" strokeWidth={2} dot={false} name="Resting" connectNulls />
                <Line type="monotone" dataKey="avg" stroke="#818cf8" strokeWidth={2} dot={false} name="Average" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Action Prompts ── */}
      {connected && (
        <div className="space-y-2">
          {!dismissedPrompts.includes('weight') && (
            <ActionPrompt
              icon={"\u2696\uFE0F"}
              title="Log your weight"
              subtitle="Keeping weight up-to-date improves W/kg accuracy and body composition trends."
              cta="Log now"
              accent="emerald"
              onDismiss={() => dismiss('weight')}
            />
          )}
          {!dismissedPrompts.includes('mood') && (
            <ActionPrompt
              icon={"\uD83D\uDE0A"}
              title="How are you feeling?"
              subtitle="A quick check-in helps the AI spot patterns between stress and recovery."
              cta="Check in"
              accent="violet"
              onDismiss={() => dismiss('mood')}
            />
          )}
          {!dismissedPrompts.includes('sleep') && sleep.sleepTimeSeconds && sleep.sleepTimeSeconds < 25200 && (
            <ActionPrompt
              icon={"\uD83C\uDF19"}
              title="Sleep trending low"
              subtitle={`${Math.floor(sleep.sleepTimeSeconds / 3600)}h ${Math.round((sleep.sleepTimeSeconds % 3600) / 60)}m last night. Aim for 7+ hours for better recovery.`}
              cta="See sleep"
              accent="rose"
              onDismiss={() => dismiss('sleep')}
            />
          )}
        </div>
      )}

      {/* ── Today's Interventions ── */}
      {connected && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Today's Interventions</p>
          {loadingInterventions ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="glass-card h-24 animate-pulse" />
              ))}
            </div>
          ) : interventions.length > 0 ? (
            <div className="space-y-2">
              {interventions.slice(0, 3).map(interv => (
                <InterventionCard
                  key={interv.id}
                  priority={interv.priority || 'low'}
                  category={interv.category || 'training'}
                  title={interv.title}
                  summary={interv.summary}
                  actions={interv.actions || []}
                />
              ))}
            </div>
          ) : (
            <div className="glass-card p-4 text-center">
              <p className="text-xs text-slate-500">Run a daily analysis from the Insights tab to see AI-powered interventions.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Recent Activities ── */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Recent Activities</p>
        {activities.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No activities yet. Sync your Garmin to see recent workouts.</p>
        ) : null}
        {activities.map((act, i) => {
          const typeKey = act.activityType?.typeKey || act.sport || '';
          const sportIcon = SPORT_ICONS[typeKey] || '\uD83C\uDFC3';
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
    </div>
  );
}

// ── Helpers ──

const SPORT_ICONS = {
  running: '\uD83C\uDFC3', trail_running: '\uD83C\uDFC3', treadmill_running: '\uD83C\uDFC3', track_running: '\uD83C\uDFC3',
  cycling: '\uD83D\uDEB4', road_biking: '\uD83D\uDEB4', indoor_cycling: '\uD83D\uDEB4', virtual_ride: '\uD83D\uDEB4',
  mountain_biking: '\uD83D\uDEB4', gravel_cycling: '\uD83D\uDEB4',
  swimming: '\uD83C\uDFCA', open_water_swimming: '\uD83C\uDFCA', lap_swimming: '\uD83C\uDFCA',
  strength_training: '\uD83C\uDFCB\uFE0F', walking: '\uD83D\uDEB6', hiking: '\u26F0\uFE0F', yoga: '\uD83E\uDDD8',
  elliptical: '\uD83C\uDFCB\uFE0F', stair_climbing: '\uD83E\uDDD7', rowing: '\uD83D\uDEA3', other: '\uD83C\uDFAF',
};

function formatTimeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
