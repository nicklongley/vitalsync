// ══════════════════════════════════════════════════════
// VITALSYNC — History Tab
// Training hours, calories, distance, activities
// Filterable by period (week/month/year) and sport
// Year-over-Year comparison
// Reference: Architecture Section 4A.5
// ══════════════════════════════════════════════════════

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useActivityStats, useGarminSync } from '@/hooks/useGarminData';

const PERIODS = ['week', 'month', 'year'];
const SPORTS = [
  { id: 'all', label: 'All Sports' },
  { id: 'running', label: 'Running' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'strength', label: 'Strength' },
  { id: 'other', label: 'Other' },
];

export default function HistoryTab() {
  const [period, setPeriod] = useState('week');
  const [sport, setSport] = useState('all');
  const [metric, setMetric] = useState('hours');
  const { stats, loading } = useActivityStats(period, sport, 12);
  const { connected } = useGarminSync();

  // Use real stats if available, otherwise show mock only when Garmin is not connected
  const hasStats = stats && stats.length > 0;
  const mockData = (!connected && !hasStats) ? getMockData(period, sport) : null;

  return (
    <div className="space-y-3">
      {/* Period filter */}
      <div className="flex gap-2 mb-1">
        {PERIODS.map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-xs capitalize font-medium transition-colors ${
              period === p ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
            {p}
          </button>
        ))}
      </div>

      {/* Sport filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {SPORTS.map(s => (
          <button key={s.id} onClick={() => setSport(s.id)}
            className={`px-3 py-1 rounded-full text-xs capitalize whitespace-nowrap transition-colors ${
              sport === s.id ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Empty state when connected but no data yet */}
      {connected && !hasStats && !loading && (
        <div className="glass-card p-8 text-center space-y-2">
          <p className="text-2xl">{"\uD83D\uDCCA"}</p>
          <p className="text-sm text-slate-300 font-medium">No activity stats yet</p>
          <p className="text-xs text-slate-500">Stats are computed nightly from your synced Garmin activities. Check back tomorrow.</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      )}

      {/* Show data: real stats or mock (only when not connected) */}
      {mockData && (
        <>
          {/* Period navigation */}
          <div className="flex items-center justify-between">
            <button className="text-xs text-slate-400 px-2 py-1 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors">
              {"\u25C0"} Prev
            </button>
            <span className="text-sm font-semibold text-white">{mockData.periodLabel}</span>
            <button className="text-xs text-slate-400 px-2 py-1 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors">
              Next {"\u25B6"}
            </button>
          </div>

          {/* Hero stats grid */}
          <div className="grid grid-cols-2 gap-2">
            {mockData.heroStats.map((stat, i) => (
              <div key={i} className={`bg-gradient-to-br ${stat.gradient} rounded-2xl p-4 border ${stat.border}`}>
                <p className={`text-xs ${stat.accentText}`}>{stat.label}</p>
                <p className="text-3xl font-bold text-white tracking-tight font-mono">{stat.value}
                  {stat.unit && <span className="text-sm text-slate-400 ml-1">{stat.unit}</span>}
                </p>
                <p className={`text-xs ${stat.accentText} mt-1`}>{stat.vsLabel}</p>
                <p className="text-xs text-slate-500">{stat.yoyLabel}</p>
              </div>
            ))}
          </div>

          {/* Year-over-Year comparison table */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold mb-2">
              {"\uD83D\uDD04"} Year-over-Year: {mockData.yoyTitle}
            </h3>
            <div className="space-y-2">
              {mockData.yoyRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-20">{row.metric}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-xs font-mono text-white w-12 text-right">{row.current}</span>
                    <span className="text-[10px] text-slate-600">vs</span>
                    <span className="text-xs font-mono text-slate-500 w-12">{row.prior}</span>
                  </div>
                  <span className={`text-xs font-mono font-bold ${row.pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {row.pct >= 0 ? '+' : ''}{row.pct}%
                  </span>
                  <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.min(Math.abs(row.pct), 100)}%`,
                      backgroundColor: row.color,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sport breakdown */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold mb-2">{"\uD83C\uDFC5"} By Sport</h3>
            <div className="space-y-2">
              {mockData.sportBreakdown.map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-1">
                  <span className="text-xs w-24">{s.label}</span>
                  <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" style={{ width: `${s.pctOfTotal}%` }} />
                  </div>
                  <span className="text-xs font-mono text-white w-12 text-right">{s.current}</span>
                  <span className={`text-[10px] font-mono ${s.vsPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {s.vsPct >= 0 ? '+' : ''}{s.vsPct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Daily/Weekly/Monthly breakdown chart */}
          <div className="glass-card p-4">
            <p className="text-xs text-slate-400 mb-3">
              {"\uD83D\uDCC5"} {period === 'week' ? 'Daily' : period === 'month' ? 'Weekly' : 'Monthly'} Breakdown
            </p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={mockData.breakdownChart}>
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={25} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="hours" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[10px] text-slate-600 text-center">
            Showing sample data. Connect Garmin to see your real stats.
          </p>
        </>
      )}
    </div>
  );
}

// ── Mock data generator (matches architecture Section 4A.5) ──
const SPORT_DATA = {
  running:  { label: 'Running',  icon: '\uD83C\uDFC3' },
  cycling:  { label: 'Cycling',  icon: '\uD83D\uDEB4' },
  swimming: { label: 'Swimming', icon: '\uD83C\uDFCA' },
  strength: { label: 'Strength', icon: '\uD83C\uDFCB\uFE0F' },
  other:    { label: 'Other',    icon: '\uD83E\uDDD8' },
};

function getBaseData(period) {
  if (period === 'week') {
    return {
      periodLabel: 'W6 \u00B7 3-9 Feb 2026',
      yoyTitle: 'W6 2026 vs W6 2025',
      heroStats: [
        { label: 'Training Hours', rawValue: 8.2, unit: 'h', gradient: 'from-emerald-900/40 to-slate-800', border: 'border-emerald-800/40', accentText: 'text-emerald-400', vsLabel: '\u2191 12% vs last week', yoyLabel: "W6 '25: 6.5h \u2191 26%" },
        { label: 'Calories Burned', rawValue: 4820, gradient: 'from-orange-900/40 to-slate-800', border: 'border-orange-800/40', accentText: 'text-orange-400', vsLabel: '\u2191 6% vs last week', yoyLabel: "W6 '25: 3,980 \u2191 21%" },
        { label: 'Distance', rawValue: 82, unit: 'km', gradient: 'from-blue-900/40 to-slate-800', border: 'border-blue-800/40', accentText: 'text-blue-400', vsLabel: '\u2191 15% vs last week', yoyLabel: "W6 '25: 58km \u2191 41%" },
        { label: 'Activities', rawValue: 6, gradient: 'from-purple-900/40 to-slate-800', border: 'border-purple-800/40', accentText: 'text-purple-400', vsLabel: 'Same as last week', yoyLabel: "W6 '25: 4 \u2191 50%" },
      ],
      yoyRows: [
        { metric: 'Hours', rawCurrent: 8.2, rawPrior: 6.5, suffix: 'h', pct: 26, color: '#34d399' },
        { metric: 'Calories', rawCurrent: 4820, rawPrior: 3980, suffix: '', pct: 21, color: '#f97316' },
        { metric: 'Distance', rawCurrent: 82, rawPrior: 58, suffix: 'km', pct: 41, color: '#3b82f6' },
        { metric: 'Activities', rawCurrent: 6, rawPrior: 4, suffix: '', pct: 50, color: '#a78bfa' },
      ],
      sportBreakdown: [
        { id: 'running', hours: 2.8, pctOfTotal: 34, vsPct: 33 },
        { id: 'cycling', hours: 4.9, pctOfTotal: 60, vsPct: 40 },
        { id: 'strength', hours: 0.5, pctOfTotal: 6, vsPct: -10 },
      ],
      breakdownChart: [
        { label: 'Mon', hours: 1.5 }, { label: 'Tue', hours: 1.0 }, { label: 'Wed', hours: 1.5 },
        { label: 'Thu', hours: 0 }, { label: 'Fri', hours: 1.2 }, { label: 'Sat', hours: 2.0 }, { label: 'Sun', hours: 1.0 },
      ],
    };
  } else if (period === 'month') {
    return {
      periodLabel: 'February 2026',
      yoyTitle: 'Feb 2026 vs Feb 2025',
      heroStats: [
        { label: 'Training Hours', rawValue: 34.5, unit: 'h', gradient: 'from-emerald-900/40 to-slate-800', border: 'border-emerald-800/40', accentText: 'text-emerald-400', vsLabel: '\u2191 8% vs Jan', yoyLabel: "Feb '25: 28.0h \u2191 23%" },
        { label: 'Calories Burned', rawValue: 19400, gradient: 'from-orange-900/40 to-slate-800', border: 'border-orange-800/40', accentText: 'text-orange-400', vsLabel: '\u2191 11% vs Jan', yoyLabel: "Feb '25: 15,200 \u2191 28%" },
        { label: 'Distance', rawValue: 340, unit: 'km', gradient: 'from-blue-900/40 to-slate-800', border: 'border-blue-800/40', accentText: 'text-blue-400', vsLabel: '\u2193 3% vs Jan', yoyLabel: "Feb '25: 260km \u2191 31%" },
        { label: 'Activities', rawValue: 24, gradient: 'from-purple-900/40 to-slate-800', border: 'border-purple-800/40', accentText: 'text-purple-400', vsLabel: '\u2191 2 vs Jan', yoyLabel: "Feb '25: 18 \u2191 33%" },
      ],
      yoyRows: [
        { metric: 'Hours', rawCurrent: 34.5, rawPrior: 28.0, suffix: 'h', pct: 23, color: '#34d399' },
        { metric: 'Calories', rawCurrent: 19400, rawPrior: 15200, suffix: '', pct: 28, color: '#f97316' },
        { metric: 'Distance', rawCurrent: 340, rawPrior: 260, suffix: 'km', pct: 31, color: '#3b82f6' },
        { metric: 'Activities', rawCurrent: 24, rawPrior: 18, suffix: '', pct: 33, color: '#a78bfa' },
      ],
      sportBreakdown: [
        { id: 'running', hours: 12.5, pctOfTotal: 36, vsPct: 39 },
        { id: 'cycling', hours: 18.5, pctOfTotal: 54, vsPct: 32 },
        { id: 'strength', hours: 3.5, pctOfTotal: 10, vsPct: 17 },
      ],
      breakdownChart: [
        { label: 'W1', hours: 7.5 }, { label: 'W2', hours: 9.0 }, { label: 'W3', hours: 8.2 }, { label: 'W4', hours: 9.8 },
      ],
    };
  } else {
    return {
      periodLabel: '2026',
      yoyTitle: '2026 vs 2025',
      heroStats: [
        { label: 'Training Hours', rawValue: 312, unit: 'h', gradient: 'from-emerald-900/40 to-slate-800', border: 'border-emerald-800/40', accentText: 'text-emerald-400', vsLabel: '\u2191 8% vs 2025', yoyLabel: "2025: 289h \u2191 8%" },
        { label: 'Calories Burned', rawValue: 168000, gradient: 'from-orange-900/40 to-slate-800', border: 'border-orange-800/40', accentText: 'text-orange-400', vsLabel: '\u2191 12% vs 2025', yoyLabel: "2025: 150k \u2191 12%" },
        { label: 'Distance', rawValue: 3120, unit: 'km', gradient: 'from-blue-900/40 to-slate-800', border: 'border-blue-800/40', accentText: 'text-blue-400', vsLabel: '\u2191 14% vs 2025', yoyLabel: "2025: 2,740km \u2191 14%" },
        { label: 'Activities', rawValue: 268, gradient: 'from-purple-900/40 to-slate-800', border: 'border-purple-800/40', accentText: 'text-purple-400', vsLabel: '\u2191 18 vs 2025', yoyLabel: "2025: 250 \u2191 7%" },
      ],
      yoyRows: [
        { metric: 'Hours', rawCurrent: 312, rawPrior: 289, suffix: 'h', pct: 8, color: '#34d399' },
        { metric: 'Calories', rawCurrent: 168000, rawPrior: 150000, suffix: '', pct: 12, color: '#f97316' },
        { metric: 'Distance', rawCurrent: 3120, rawPrior: 2740, suffix: 'km', pct: 14, color: '#3b82f6' },
        { metric: 'Activities', rawCurrent: 268, rawPrior: 250, suffix: '', pct: 7, color: '#a78bfa' },
      ],
      sportBreakdown: [
        { id: 'running', hours: 110, pctOfTotal: 35, vsPct: 15 },
        { id: 'cycling', hours: 170, pctOfTotal: 54, vsPct: 22 },
        { id: 'strength', hours: 32, pctOfTotal: 11, vsPct: 5 },
      ],
      breakdownChart: [
        { label: 'Jan', hours: 28 }, { label: 'Feb', hours: 34.5 }, { label: 'Mar', hours: 30 },
        { label: 'Apr', hours: 32 }, { label: 'May', hours: 35 }, { label: 'Jun', hours: 38 },
      ],
    };
  }
}

function fmtNum(n) {
  if (n >= 1000) return n.toLocaleString();
  return String(Math.round(n * 10) / 10);
}

function getMockData(period, sport) {
  const base = getBaseData(period);

  // Format sport breakdown for display
  const formatBreakdown = (items) =>
    items.map((s) => ({
      ...s,
      label: `${SPORT_DATA[s.id]?.icon || ''} ${SPORT_DATA[s.id]?.label || s.id}`,
      current: `${s.hours}h`,
    }));

  // Format hero stats and yoy rows
  const formatHero = (stats) =>
    stats.map((s) => ({ ...s, value: fmtNum(s.rawValue) }));
  const formatYoy = (rows) =>
    rows.map((r) => ({ ...r, current: fmtNum(r.rawCurrent) + r.suffix, prior: fmtNum(r.rawPrior) + r.suffix }));

  if (sport === 'all') {
    return {
      ...base,
      heroStats: formatHero(base.heroStats),
      yoyRows: formatYoy(base.yoyRows),
      sportBreakdown: formatBreakdown(base.sportBreakdown),
    };
  }

  // Filter to a specific sport
  const sportInfo = base.sportBreakdown.find((s) => s.id === sport);
  if (!sportInfo) {
    return {
      ...base,
      heroStats: formatHero(base.heroStats.map((s) => ({ ...s, rawValue: 0 }))),
      yoyRows: formatYoy(base.yoyRows.map((r) => ({ ...r, rawCurrent: 0, rawPrior: 0, pct: 0 }))),
      sportBreakdown: [],
      breakdownChart: base.breakdownChart.map((d) => ({ ...d, hours: 0 })),
    };
  }

  const ratio = sportInfo.pctOfTotal / 100;
  return {
    ...base,
    heroStats: formatHero(base.heroStats.map((s) => ({
      ...s,
      rawValue: Math.round(s.rawValue * ratio * 10) / 10,
    }))),
    yoyRows: formatYoy(base.yoyRows.map((r) => ({
      ...r,
      rawCurrent: Math.round(r.rawCurrent * ratio * 10) / 10,
      rawPrior: Math.round(r.rawPrior * ratio * 10) / 10,
    }))),
    sportBreakdown: formatBreakdown([{ ...sportInfo, pctOfTotal: 100 }]),
    breakdownChart: base.breakdownChart.map((d) => ({
      ...d,
      hours: Math.round(d.hours * ratio * 10) / 10,
    })),
  };
}
