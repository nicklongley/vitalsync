// ══════════════════════════════════════════════════════
// VITALSYNC — History Tab
// Training volume, Year-over-Year comparisons, sport breakdown
// Filterable by period (week/month/year) and sport
// ══════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useActivityStats, useGarminSync } from '@/hooks/useGarminData';
import { ActionPrompt } from '@/components/shared';

const PERIODS = ['week', 'month', 'year'];
const SPORTS = [
  { id: 'all', label: 'All Sports' },
  { id: 'running', label: 'Running' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'strength', label: 'Strength' },
  { id: 'other', label: 'Other' },
];

const SPORT_TYPE_MAP = {
  running: ['running', 'trail_running', 'treadmill_running', 'track_running'],
  cycling: ['cycling', 'road_biking', 'indoor_cycling', 'virtual_ride', 'mountain_biking', 'gravel_cycling'],
  swimming: ['swimming', 'open_water_swimming', 'lap_swimming'],
  strength: ['strength_training'],
};

const SPORT_COLORS = {
  running: '#34d399', cycling: '#3b82f6', swimming: '#22d3ee', strength: '#a78bfa', other: '#94a3b8',
};

const KNOWN_TYPES = new Set(Object.values(SPORT_TYPE_MAP).flat());

// ── Helpers ──

function extractSportStats(stat, sport) {
  if (!stat) return { count: 0, hours: 0, km: 0, calories: 0 };
  if (sport === 'all') {
    return {
      count: stat.activityCount || 0,
      hours: (stat.totalDurationSeconds || 0) / 3600,
      km: (stat.totalDistanceMeters || 0) / 1000,
      calories: stat.totalCalories || 0,
    };
  }
  const byType = stat.byType || {};
  const types = SPORT_TYPE_MAP[sport];
  let count = 0, duration = 0, distance = 0, calories = 0;
  if (types) {
    for (const t of types) {
      const d = byType[t];
      if (d) { count += d.count || 0; duration += d.duration || 0; distance += d.distance || 0; calories += d.calories || 0; }
    }
  } else {
    for (const [type, data] of Object.entries(byType)) {
      if (!KNOWN_TYPES.has(type)) { count += data.count || 0; duration += data.duration || 0; distance += data.distance || 0; calories += data.calories || 0; }
    }
  }
  return { count, hours: duration / 3600, km: distance / 1000, calories };
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function fmtNum(n) {
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return n.toLocaleString();
  if (n >= 100) return Math.round(n).toString();
  return (Math.round(n * 10) / 10).toString();
}

function formatPeriodLabel(stat, periodType) {
  if (!stat?.periodStart) return '';
  const start = new Date(stat.periodStart + 'T12:00:00');
  if (periodType === 'week') {
    const end = new Date(stat.periodEnd + 'T12:00:00');
    const weekNum = Math.ceil(((start - new Date(start.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
    return `W${weekNum}: ${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} \u2013 ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  } else if (periodType === 'month') {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } else {
    return stat.periodStart.slice(0, 4);
  }
}

function findYoYMatch(stats, currentStat, periodType) {
  if (!currentStat?.periodStart) return null;
  const currentStart = new Date(currentStat.periodStart + 'T12:00:00');
  if (periodType === 'year') {
    const targetYear = currentStart.getFullYear() - 1;
    return stats.find(s => s.periodStart?.startsWith(String(targetYear)));
  } else if (periodType === 'month') {
    const targetDate = new Date(currentStart);
    targetDate.setFullYear(targetDate.getFullYear() - 1);
    const targetKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    return stats.find(s => s.periodStart?.startsWith(targetKey));
  } else {
    const targetMs = currentStart.getTime() - (52 * 7 * 24 * 60 * 60 * 1000);
    let closest = null, closestDiff = Infinity;
    for (const s of stats) {
      if (s === currentStat) continue;
      const diff = Math.abs(new Date(s.periodStart + 'T12:00:00').getTime() - targetMs);
      if (diff < closestDiff && diff < 14 * 24 * 60 * 60 * 1000) {
        closest = s;
        closestDiff = diff;
      }
    }
    return closest;
  }
}

// ── Component ──

export default function HistoryTab() {
  const [period, setPeriod] = useState('week');
  const [sport, setSport] = useState('all');
  const [periodIndex, setPeriodIndex] = useState(0);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState('');

  const count = period === 'week' ? 60 : period === 'month' ? 25 : 20;
  const { stats, loading } = useActivityStats(period, count);
  const { connected, backfillActivities, computeStats } = useGarminSync();

  const handlePeriodChange = (p) => { setPeriod(p); setPeriodIndex(0); };

  const current = stats[periodIndex];
  const prev = stats[periodIndex + 1];
  const yoy = useMemo(() => findYoYMatch(stats, current, period), [stats, current, period]);

  const currentVals = useMemo(() => extractSportStats(current, sport), [current, sport]);
  const prevVals = useMemo(() => extractSportStats(prev, sport), [prev, sport]);
  const yoyVals = useMemo(() => extractSportStats(yoy, sport), [yoy, sport]);

  const prevLabel = period === 'week' ? 'last week' : period === 'month' ? 'last month' : 'last year';
  const yoyLabel = yoy ? formatPeriodLabel(yoy, period) : '';
  const periodLabel = formatPeriodLabel(current, period);

  // Chart data
  const chartData = useMemo(() => {
    const n = period === 'week' ? 12 : period === 'month' ? 12 : 10;
    const slice = stats.slice(0, n);
    return [...slice].reverse().map((s, i) => {
      const vals = extractSportStats(s, sport);
      const label = period === 'week'
        ? s.periodStart?.slice(5)
        : period === 'month'
        ? new Date(s.periodStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })
        : s.periodStart?.slice(0, 4);
      const isSelected = stats.indexOf(s) === periodIndex;
      return { label, hours: parseFloat(vals.hours.toFixed(1)), km: parseFloat(vals.km.toFixed(0)), count: vals.count, isSelected };
    });
  }, [stats, sport, period, periodIndex]);

  // Sport breakdown for current period
  const sportBreakdown = useMemo(() => {
    if (!current?.byType) return [];
    const byType = current.byType;
    const totalDuration = current.totalDurationSeconds || 1;
    const groups = [];
    for (const [sportId, types] of Object.entries(SPORT_TYPE_MAP)) {
      let duration = 0, cnt = 0;
      for (const t of types) {
        if (byType[t]) { duration += byType[t].duration || 0; cnt += byType[t].count || 0; }
      }
      if (cnt > 0) {
        const info = SPORTS.find(s => s.id === sportId);
        groups.push({ id: sportId, label: info?.label || sportId, hours: duration / 3600, pct: Math.round((duration / totalDuration) * 100), count: cnt, color: SPORT_COLORS[sportId] || '#94a3b8' });
      }
    }
    let otherDur = 0, otherCnt = 0;
    for (const [type, data] of Object.entries(byType)) {
      if (!KNOWN_TYPES.has(type)) { otherDur += data.duration || 0; otherCnt += data.count || 0; }
    }
    if (otherCnt > 0) groups.push({ id: 'other', label: 'Other', hours: otherDur / 3600, pct: Math.round((otherDur / totalDuration) * 100), count: otherCnt, color: SPORT_COLORS.other });
    return groups.sort((a, b) => b.pct - a.pct);
  }, [current]);

  const handleBackfill = useCallback(async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillMsg('Loading activity history...');
    try {
      let page = 0, totalActivities = 0, hasMore = true;
      while (hasMore) {
        const result = await backfillActivities(page);
        const data = result?.data || {};
        totalActivities += data.totalActivities || 0;
        hasMore = data.hasMore || false;
        page = data.nextPage || 0;
        setBackfillMsg(`Loaded ${totalActivities} activities...`);
      }
      setBackfillMsg(`Computing stats for ${totalActivities} activities...`);
      await computeStats();
      setBackfillMsg(`Done! ${totalActivities} activities synced.`);
    } catch (err) {
      console.error('Backfill failed:', err);
      setBackfillMsg('Backfill failed. Please try again.');
    } finally {
      setBackfilling(false);
      setTimeout(() => setBackfillMsg(''), 5000);
    }
  }, [backfilling, backfillActivities, computeStats]);

  const hasStats = stats.length > 0;
  const sportLabel = SPORTS.find(s => s.id === sport)?.label || sport;

  // Hero stat cards — show only vs previous period (YoY is in the dedicated table)
  const heroStats = [
    { label: 'Training Hours', value: fmtNum(currentVals.hours), unit: 'h',
      prevPct: pctChange(currentVals.hours, prevVals.hours),
      gradient: 'from-emerald-900/40 to-slate-800', border: 'border-emerald-800/40', accent: 'text-emerald-400' },
    { label: 'Calories', value: fmtNum(currentVals.calories), unit: '',
      prevPct: pctChange(currentVals.calories, prevVals.calories),
      gradient: 'from-orange-900/40 to-slate-800', border: 'border-orange-800/40', accent: 'text-orange-400' },
    { label: 'Distance', value: fmtNum(currentVals.km), unit: 'km',
      prevPct: pctChange(currentVals.km, prevVals.km),
      gradient: 'from-blue-900/40 to-slate-800', border: 'border-blue-800/40', accent: 'text-blue-400' },
    { label: 'Activities', value: currentVals.count, unit: '',
      prevPct: pctChange(currentVals.count, prevVals.count),
      gradient: 'from-purple-900/40 to-slate-800', border: 'border-purple-800/40', accent: 'text-purple-400' },
  ];

  // YoY comparison rows
  const yoyRows = yoy ? [
    { metric: 'Hours', current: `${fmtNum(currentVals.hours)}h`, prior: `${fmtNum(yoyVals.hours)}h`, pct: pctChange(currentVals.hours, yoyVals.hours), color: '#34d399' },
    { metric: 'Calories', current: fmtNum(currentVals.calories), prior: fmtNum(yoyVals.calories), pct: pctChange(currentVals.calories, yoyVals.calories), color: '#f97316' },
    { metric: 'Distance', current: `${fmtNum(currentVals.km)}km`, prior: `${fmtNum(yoyVals.km)}km`, pct: pctChange(currentVals.km, yoyVals.km), color: '#3b82f6' },
    { metric: 'Activities', current: String(currentVals.count), prior: String(yoyVals.count), pct: pctChange(currentVals.count, yoyVals.count), color: '#a78bfa' },
  ] : [];

  return (
    <div className="space-y-4">
      {/* Period filter */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Period</p>
        <div className="flex gap-2">
          {PERIODS.map(p => (
            <button key={p} onClick={() => handlePeriodChange(p)}
              className={`px-4 py-2.5 rounded-full text-xs capitalize font-medium transition-colors min-h-[44px] ${
                period === p ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Sport filter */}
      <div>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Sport</p>
        <div className="flex gap-2 overflow-x-auto pb-2 relative">
          {SPORTS.map(s => (
            <button key={s.id} onClick={() => setSport(s.id)}
              className={`px-3 py-2.5 rounded-full text-xs whitespace-nowrap transition-colors min-h-[44px] ${
                sport === s.id ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading — skeleton cards */}
      {loading && (
        <div className="space-y-4">
          <div className="glass-card h-10 animate-pulse" />
          <div className="glass-card h-[200px] animate-pulse" />
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="glass-card h-24 animate-pulse" />)}
          </div>
        </div>
      )}

      {/* Empty state — not connected */}
      {!connected && !loading && (
        <ActionPrompt
          icon={"\u231A"}
          title="Connect your Garmin"
          subtitle="Link your Garmin account in Settings to see your training history, stats, and year-over-year comparisons."
          cta="Go to Settings"
          accent="amber"
          dismissible={false}
        />
      )}

      {/* Empty state — connected, no data yet */}
      {!loading && !hasStats && connected && !backfilling && (
        <ActionPrompt
          icon={"\uD83D\uDCCA"}
          title="No activity stats yet"
          subtitle="Load your full Garmin activity history to see weekly, monthly, and yearly training stats."
          cta="Load History"
          ctaAction={handleBackfill}
          accent="emerald"
          dismissible={false}
        />
      )}

      {/* Main content */}
      {hasStats && !loading && (
        <>
          {/* Period navigation */}
          <div className="flex items-center justify-between">
            <button onClick={() => setPeriodIndex(i => Math.min(i + 1, stats.length - 1))}
              disabled={periodIndex >= stats.length - 1}
              className="px-4 py-2.5 min-h-[44px] text-xs text-slate-400 bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-30 transition-colors">
              {"\u25C0"} Older
            </button>
            <div className="text-center px-2">
              <span className="text-sm font-semibold text-white block">{periodLabel}</span>
              {sport !== 'all' && <span className="text-[10px] text-cyan-400">{sportLabel}</span>}
            </div>
            {periodIndex > 0 ? (
              <button onClick={() => setPeriodIndex(i => Math.max(i - 1, 0))}
                className="px-4 py-2.5 min-h-[44px] text-xs text-slate-400 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors">
                Newer {"\u25B6"}
              </button>
            ) : <div className="w-[80px]" />}
          </div>

          {/* Sport-specific empty state */}
          {sport !== 'all' && currentVals.count === 0 && (
            <div className="glass-card p-6 text-center space-y-2">
              <p className="text-sm text-slate-300">No {sportLabel.toLowerCase()} activities this {period}</p>
              <button onClick={() => setSport('all')} className="text-xs text-cyan-400 hover:text-cyan-300">
                View all sports
              </button>
            </div>
          )}

          {/* Trend chart — placed first for immediate story-telling */}
          {chartData.length > 1 && (
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">
                {period === 'week' ? 'Weekly' : period === 'month' ? 'Monthly' : 'Yearly'} Training Hours
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} interval={chartData.length > 8 ? 1 : 0} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={25} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                    formatter={(value, name) => [`${value}h`, 'Hours']}
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.isSelected ? '#34d399' : '#10b981'} fillOpacity={entry.isSelected ? 1 : 0.6} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Hero stats grid */}
          {(sport === 'all' || currentVals.count > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {heroStats.map((stat, i) => (
                <div key={i} className={`bg-gradient-to-br ${stat.gradient} rounded-2xl p-4 border ${stat.border}`}>
                  <p className={`text-xs ${stat.accent}`}>{stat.label}</p>
                  <p className="metric-lg mt-1">
                    {stat.value}
                    {stat.unit && <span className="text-sm text-slate-400 ml-1">{stat.unit}</span>}
                  </p>
                  {stat.prevPct !== null && (
                    <p className={`text-xs mt-1 ${stat.prevPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {stat.prevPct >= 0 ? '\u2191' : '\u2193'} {Math.abs(stat.prevPct)}% vs {prevLabel}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* YoY comparison table */}
          {yoyRows.length > 0 && (sport === 'all' || currentVals.count > 0) && (
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">
                Year-over-Year: vs {yoyLabel}
              </p>
              <div className="space-y-2.5">
                {yoyRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-16">{row.metric}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs font-mono text-white w-12 text-right">{row.current}</span>
                      <span className="text-[10px] text-slate-600">vs</span>
                      <span className="text-xs font-mono text-slate-500 w-12">{row.prior}</span>
                    </div>
                    <span className={`text-xs font-mono font-bold min-w-[40px] text-right ${row.pct != null && row.pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {row.pct != null ? `${row.pct >= 0 ? '+' : ''}${row.pct}%` : '--'}
                    </span>
                    <div className="w-14 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(Math.abs(row.pct || 0), 100)}%`,
                        backgroundColor: row.pct >= 0 ? '#34d399' : '#f43f5e',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sport breakdown — interactive, per-sport colors */}
          {sport === 'all' && sportBreakdown.length > 0 && (
            <div className="glass-card p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">By Sport</p>
              <div className="space-y-1">
                {sportBreakdown.map((s, i) => (
                  <button key={i} onClick={() => setSport(s.id)}
                    className="flex items-center gap-3 py-2.5 w-full text-left hover:bg-slate-700/30 rounded-lg transition-colors min-h-[44px] px-1">
                    <span className="text-xs w-20 truncate text-slate-300">{s.label}</span>
                    <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-8 text-right">{s.pct}%</span>
                    <span className="text-xs font-mono text-white w-10 text-right">{s.hours.toFixed(1)}h</span>
                    <span className="text-[10px] text-slate-500 w-6 text-right">{s.count}x</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Backfill button — at bottom, less prominent */}
      {connected && hasStats && (
        <div className="glass-card p-3 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500">Sync & Refresh</p>
            {backfillMsg && <p className="text-xs text-emerald-400 mt-0.5 line-clamp-2">{backfillMsg}</p>}
          </div>
          <button onClick={handleBackfill} disabled={backfilling}
            className="px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-medium bg-emerald-600/20 border border-emerald-800/40 text-emerald-400
                       hover:bg-emerald-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-3 whitespace-nowrap">
            {backfilling ? 'Loading...' : 'Refresh History'}
          </button>
        </div>
      )}

      {/* Backfill progress bar */}
      {backfilling && (
        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full animate-pulse" style={{ width: '100%' }} />
        </div>
      )}
    </div>
  );
}
