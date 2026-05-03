// ══════════════════════════════════════════════════════
// VITALSYNC — Dashboard Tab
// Today's snapshot: gauges, weekly trends, activities, AI
// Backed by intervals.icu wellness + activity data.
// ══════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db } from '@/lib/firebase';
import { useTodayWellness, useWeekWellness, useIntervalsSync, useRecentActivities } from '@/hooks/useIntervalsData';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { GaugeRing, MetricCard, ActionPrompt, InterventionCard } from '@/components/shared';
import SyncProgress from '@/components/SyncProgress';
import ActivityDetail from '@/components/ActivityDetail';

// ── Wellness field readers (intervals.icu native, with garminDailies fallback) ──
function readRestingHR(d) {
  if (!d) return null;
  return d.restingHR
    || d.heartRates?.restingHeartRate
    || null;
}
function readHRV(d) {
  if (!d) return null;
  return d.hrv
    || d.hrvSDNN
    || d.hrv?.hrvSummary?.lastNightAvg
    || d.hrv?.lastNightAvg
    || d.hrv?.weeklyAvg
    || d.heartRates?.hrvStatus
    || null;
}
function readSteps(d) {
  if (!d) return null;
  return d.steps
    || d.stats?.totalSteps
    || null;
}
function readSleepSecs(d) {
  if (!d) return null;
  return d.sleepSecs
    || d.sleep?.sleepTimeSeconds
    || null;
}
function readSleepScore(d) {
  if (!d) return null;
  return d.sleepScore
    || d.sleep?.sleepScores?.overall?.value
    || d.sleep?.sleepScores?.overallScore
    || d.sleep?.overallScore
    || d.sleep?.sleepScore
    || null;
}
function readWeight(d) {
  if (!d) return { weight: null, bodyFat: null };
  if (d.weight) return { weight: Math.round(d.weight * 10) / 10, bodyFat: d.bodyFat || null };
  // Historical garminDailies bodyComp
  const wList = d.bodyComp?.dateWeightList;
  if (Array.isArray(wList) && wList.length > 0) {
    const latest = wList[wList.length - 1];
    if (latest?.weight) {
      return {
        weight: Math.round(latest.weight / 100) / 10,
        bodyFat: latest.bodyFat || null,
      };
    }
  }
  return { weight: null, bodyFat: null };
}

export default function DashboardTab() {
  const { user, userSettings } = useAuth();
  const { goToHealthLog, setActiveTab } = useNavigation();
  const { data: todayData, loading } = useTodayWellness();
  const { data: weekData } = useWeekWellness();
  const { connected, backfillStatus, backfillProgress, syncing, syncNow, lastSyncAt } = useIntervalsSync();
  const { activities } = useRecentActivities(50);
  const [dismissedPrompts, setDismissedPrompts] = useState([]);
  const [interventions, setInterventions] = useState([]);
  const [loadingInterventions, setLoadingInterventions] = useState(true);
  const [selectedActivityId, setSelectedActivityId] = useState(null);

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

  // Recent vs earlier resting HR trend
  const trends = useMemo(() => {
    if (!weekData || weekData.length < 4) return {};
    const recent = weekData.slice(-3);
    const earlier = weekData.slice(0, 4);
    function avg(arr, fn) {
      const vals = arr.map(fn).filter(v => v > 0);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    const recentRHR = avg(recent, d => readRestingHR(d) || 0);
    const earlierRHR = avg(earlier, d => readRestingHR(d) || 0);
    const rhrDiff = earlierRHR > 0 ? Math.round(recentRHR - earlierRHR) : 0;
    return { rhrDiff };
  }, [weekData]);

  const hrChartData = useMemo(() => {
    if (!weekData || weekData.length === 0) return [];
    return weekData.map(day => {
      const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return {
        day: dayLabel,
        resting: readRestingHR(day) || null,
      };
    });
  }, [weekData]);

  const weekHRV = useMemo(() => {
    if (!weekData) return 0;
    const vals = weekData.map(d => readHRV(d) || 0).filter(v => v > 0);
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }, [weekData]);

  const weightChartData = useMemo(() => {
    if (!weekData || weekData.length === 0) return [];
    return weekData.map(day => {
      const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      const { weight: wKg, bodyFat: fat } = readWeight(day);
      return { day: dayLabel, weight: wKg, bodyFat: fat };
    });
  }, [weekData]);

  const profileWeight = userSettings?.profile?.weight || 0;

  // This-week totals from recent activities (real-time; not waiting for nightly aggregate)
  const weekTotals = useMemo(() => {
    const now = new Date();
    const daysFromMon = (now.getDay() + 6) % 7;  // Mon=0..Sun=6
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysFromMon);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartISO = weekStart.toISOString().slice(0, 10);
    let secs = 0;
    let cals = 0;
    let count = 0;
    for (const a of activities) {
      const d = (a.startTimeLocal || '').slice(0, 10);
      if (d >= weekStartISO) {
        secs += a.duration || a.movingDuration || 0;
        cals += a.calories || 0;
        count += 1;
      }
    }
    return { minutes: Math.round(secs / 60), calories: Math.round(cals), count };
  }, [activities]);

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  const restingHR = readRestingHR(todayData);
  const todayHRV = readHRV(todayData);
  const steps = readSteps(todayData);
  const sleepSecs = readSleepSecs(todayData);
  const sleepScore = readSleepScore(todayData) || 0;
  const { weight: todayWeight, bodyFat: todayBodyFat } = readWeight(todayData);

  // intervals.icu training load — Fitness, Fatigue, Form
  const ctl = todayData?.ctl ? Math.round(todayData.ctl) : 0; // Fitness
  const atl = todayData?.atl ? Math.round(todayData.atl) : 0; // Fatigue
  const form = ctl - atl; // TSB / Form (positive = fresh)
  // Map Form (-30..+20) → 0..100 for the gauge ring
  const formGauge = Math.max(0, Math.min(100, Math.round(((form + 30) / 50) * 100)));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.displayName?.split(' ')[0] || 'Athlete';

  const currentWeight = todayWeight || profileWeight || 0;
  const activeDisplay = weekTotals.minutes >= 60
    ? { value: (weekTotals.minutes / 60).toFixed(1), unit: 'h' }
    : { value: weekTotals.minutes || 0, unit: 'min' };

  function dismiss(key) {
    setDismissedPrompts(prev => [...prev, key]);
  }

  if (selectedActivityId) {
    return <ActivityDetail activityId={selectedActivityId} onBack={() => setSelectedActivityId(null)} />;
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
              : 'Connect intervals.icu to see your data'}
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
        <SyncProgress progress={backfillProgress} />
      )}

      {/* intervals.icu not connected */}
      {!connected && (
        <ActionPrompt
          icon={"⌚"}
          title="Connect intervals.icu"
          subtitle="Link your intervals.icu account (which already syncs your Garmin and Hammerhead data) to pull activities and wellness automatically."
          cta="Go to Settings"
          accent="amber"
          dismissible={false}
        />
      )}

      {/* ── Gauge Rings: Fitness (CTL) / Sleep / Form (TSB) ── */}
      <div className="glass-card p-5">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Today's Snapshot</p>
        <div className="flex justify-around items-center">
          <GaugeRing value={Math.min(100, ctl)} max={100} color="#34d399" size={76} label={`Fitness ${ctl}`} />
          <GaugeRing value={sleepScore} max={100} color="#818cf8" size={76} label="Sleep Score" />
          <GaugeRing value={formGauge} max={100} color="#f59e0b" size={76} label={`Form ${form > 0 ? '+' : ''}${form}`} />
        </div>
      </div>

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={"❤️"}
          title="Resting HR"
          value={restingHR || '--'}
          unit="bpm"
          subtitle={trends.rhrDiff
            ? `${trends.rhrDiff > 0 ? '↑' : '↓'}${Math.abs(trends.rhrDiff)} from last week`
            : ''}
        />
        <MetricCard
          icon={"💚"}
          title="HRV"
          value={todayHRV || weekHRV || '--'}
          unit="ms"
          subtitle={weekHRV ? `Weekly avg: ${weekHRV}ms` : ''}
        />
        <MetricCard
          icon={"👣"}
          title="Steps"
          value={(steps || 0).toLocaleString()}
          subtitle={steps ? '' : 'Not synced today'}
        />
        <MetricCard
          icon={"🔥"}
          title="Fatigue"
          value={atl || '--'}
          subtitle={ctl ? `Fitness: ${ctl}` : ''}
        />
        <MetricCard
          icon={"⏱️"}
          title="Active This Week"
          value={activeDisplay.value}
          unit={activeDisplay.unit}
          subtitle={weekTotals.count ? `${weekTotals.count} session${weekTotals.count === 1 ? '' : 's'}` : 'No activities yet'}
        />
        <MetricCard
          icon={"🍔"}
          title="Calories This Week"
          value={weekTotals.calories ? weekTotals.calories.toLocaleString() : '--'}
          unit="kcal"
          subtitle="From activities"
        />
      </div>

      {/* ── Resting HR 7-Day Line Chart ── */}
      {hrChartData.some(d => d.resting) && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Resting HR — 7 Days</p>
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
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Weight 7-Day Line Chart ── */}
      {weightChartData.some(d => d.weight) && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Weight {weightChartData.some(d => d.bodyFat) ? '& Body Fat ' : ''}— 7 Days</p>
          <div className="h-32 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weightChartData}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(val, name) => name === 'weight' ? [`${val} kg`, 'Weight'] : [`${val}%`, 'Body Fat']}
                />
                <Line type="monotone" dataKey="weight" stroke="#f59e0b" strokeWidth={2} dot={false} name="weight" connectNulls />
                {weightChartData.some(d => d.bodyFat) && (
                  <Line type="monotone" dataKey="bodyFat" stroke="#f472b6" strokeWidth={2} dot={false} name="bodyFat" connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Action Prompts ── */}
      {connected && (
        <div className="space-y-2">
          {!currentWeight && !dismissedPrompts.includes('weight') && (
            <ActionPrompt
              icon={"⚖️"}
              title="Log your weight"
              subtitle="Keeping weight up-to-date improves W/kg accuracy and body composition trends."
              cta="Log now"
              ctaAction={() => goToHealthLog({ type: 'weight' })}
              accent="emerald"
              onDismiss={() => dismiss('weight')}
            />
          )}
          {!dismissedPrompts.includes('mood') && (
            <ActionPrompt
              icon={"😊"}
              title="How are you feeling?"
              subtitle="A quick check-in helps the AI spot patterns between stress and recovery."
              cta="Check in"
              ctaAction={() => goToHealthLog({ type: 'mood' })}
              accent="violet"
              onDismiss={() => dismiss('mood')}
            />
          )}
          {!dismissedPrompts.includes('sleep') && sleepSecs && sleepSecs < 25200 && (
            <ActionPrompt
              icon={"🌙"}
              title="Sleep trending low"
              subtitle={`${Math.floor(sleepSecs / 3600)}h ${Math.round((sleepSecs % 3600) / 60)}m last night. Aim for 7+ hours for better recovery.`}
              cta="See sleep"
              ctaAction={() => setActiveTab('Insights')}
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
          <p className="text-sm text-slate-500 text-center py-4">No activities yet. Connect intervals.icu to see recent workouts.</p>
        ) : null}
        {activities.slice(0, 5).map((act, i) => {
          const typeKey = act.activityType?.typeKey || act.sport || '';
          const sportIcon = SPORT_ICONS[typeKey] || '🏃';
          return (
            <button
              key={act.id || i}
              onClick={() => setSelectedActivityId(act.id)}
              className="w-full text-left flex items-center gap-3 py-2 border-b border-slate-800/50 last:border-0
                         hover:bg-slate-800/30 transition-colors -mx-2 px-2 rounded-lg min-h-[44px]"
            >
              <span className="text-lg">{sportIcon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{act.activityName || act.name}</p>
                <p className="text-[10px] text-slate-500">
                  {act.startTimeLocal || act.date || ''}
                  {act.distance ? ` · ${(act.distance / 1000).toFixed(1)} km` : ''}
                  {act.duration ? ` · ${Math.round(act.duration / 60)}min` : ''}
                </p>
              </div>
              {(act.averageHR || act.hr) && (
                <span className="text-[10px] text-slate-400 font-mono">{act.averageHR || act.hr} bpm</span>
              )}
              <span className="text-slate-600 text-xs">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ──

const SPORT_ICONS = {
  running: '🏃', trail_running: '🏃', treadmill_running: '🏃', track_running: '🏃',
  cycling: '🚴', road_biking: '🚴', indoor_cycling: '🚴', virtual_ride: '🚴',
  mountain_biking: '🚴', gravel_cycling: '🚴',
  swimming: '🏊', open_water_swimming: '🏊', lap_swimming: '🏊',
  strength_training: '🏋️', walking: '🚶', hiking: '⛰️', yoga: '🧘',
  elliptical: '🏋️', stair_climbing: '🧗', rowing: '🚣', other: '🎯',
};

function formatTimeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
