// ══════════════════════════════════════════════════════
// VITALSYNC — Shared UI Components
// ══════════════════════════════════════════════════════

import { useState } from 'react';

// ── SVG Gauge Ring ──
export function GaugeRing({ value, max, color, size = 80, label }) {
  const safeValue = value ?? 0;
  const safeMax = max || 1;
  const pct = Math.min(safeValue / safeMax, 1);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#334155" strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <p className="text-lg font-bold text-white font-mono mt-1">{safeValue.toLocaleString()}</p>
      {label && <p className="text-[10px] text-slate-400">{label}</p>}
    </div>
  );
}

// ── Date Entry Picker (health log) ──
export function DateEntryPicker({ value, onChange }) {
  const today = new Date().toISOString().split('T')[0];
  const isToday = value === today;
  const label = isToday
    ? 'Today'
    : new Date(value + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  function shiftDay(delta) {
    const d = new Date(value + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    if (d <= new Date()) onChange(d.toISOString().split('T')[0]);
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => shiftDay(-1)}
        className="w-7 h-7 rounded-lg bg-slate-700 text-slate-400 text-xs hover:bg-slate-600 flex items-center justify-center">
        {"\u25C0"}
      </button>
      <span className="text-sm text-white font-medium min-w-[120px] text-center">{label}</span>
      <button onClick={() => shiftDay(1)}
        className={`w-7 h-7 rounded-lg text-xs flex items-center justify-center ${
          isToday ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
        }`} disabled={isToday}>
        {"\u25B6"}
      </button>
    </div>
  );
}

// ── Action Prompt Card (contextual nudges) ──
export function ActionPrompt({ icon, title, subtitle, cta, ctaAction, accent = 'emerald', dismissible = true, onDismiss }) {
  const accents = {
    emerald: { border: 'border-emerald-800/40', bg: 'bg-emerald-950/30', text: 'text-emerald-400', btn: 'bg-emerald-600 hover:bg-emerald-500' },
    amber: { border: 'border-amber-800/40', bg: 'bg-amber-950/30', text: 'text-amber-400', btn: 'bg-amber-600 hover:bg-amber-500' },
    cyan: { border: 'border-cyan-800/40', bg: 'bg-cyan-950/30', text: 'text-cyan-400', btn: 'bg-cyan-600 hover:bg-cyan-500' },
    rose: { border: 'border-rose-800/40', bg: 'bg-rose-950/30', text: 'text-rose-400', btn: 'bg-rose-600 hover:bg-rose-500' },
    violet: { border: 'border-violet-800/40', bg: 'bg-violet-950/30', text: 'text-violet-400', btn: 'bg-violet-600 hover:bg-violet-500' },
  };
  const a = accents[accent];
  return (
    <div className={`glass-card ${a.border} ${a.bg} p-4 animate-fade-in`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${a.text}`}>{title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          {cta && (
            <button onClick={ctaAction}
              className={`mt-2 px-3 py-1.5 rounded-lg text-xs text-white font-medium ${a.btn} transition-colors`}>
              {cta}
            </button>
          )}
        </div>
        {dismissible && (
          <button onClick={onDismiss} className="text-slate-600 hover:text-slate-400 text-xs">{"\u2715"}</button>
        )}
      </div>
    </div>
  );
}

// ── Metric Card ──
export function MetricCard({ icon, title, value, unit, subtitle, trend, children }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-sm">{icon}</span>}
        <p className="text-xs text-slate-400 uppercase tracking-wider">{title}</p>
      </div>
      {value !== undefined && (
        <div className="flex items-baseline gap-1">
          <span className="metric-lg">{value}</span>
          {unit && <span className="text-slate-400 text-xs">{unit}</span>}
        </div>
      )}
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
      {trend && (
        <p className={`text-xs mt-1 ${trend > 0 ? 'text-emerald-400' : trend < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
          {trend > 0 ? '\u2191' : trend < 0 ? '\u2193' : '\u2194'} {Math.abs(trend)}% vs prior
        </p>
      )}
      {children}
    </div>
  );
}

// ── AI Intervention Card ──
export function InterventionCard({ priority, category, title, summary, actions }) {
  const [expanded, setExpanded] = useState(false);
  const colors = {
    high: 'border-l-red-400 bg-red-950/30',
    medium: 'border-l-amber-400 bg-amber-950/30',
    low: 'border-l-emerald-400 bg-emerald-950/30',
  };
  const icons = {
    training: '\uD83C\uDFC3', recovery: '\uD83E\uDDD8', cycling: '\uD83D\uDEB4',
    sleep: '\uD83D\uDE34', health_alert: '\u26A0\uFE0F', nutrition: '\uD83C\uDF4E',
  };
  return (
    <div className={`rounded-xl p-4 border-l-4 ${colors[priority] || colors.low} animate-fade-in`}
      onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-3">
        <span className="text-xl">{icons[category] || '\uD83D\uDCA1'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className={`text-xs text-slate-400 mt-1 ${expanded ? '' : 'line-clamp-2'}`}>{summary}</p>
          {expanded && actions && actions.length > 0 && (
            <div className="flex gap-2 mt-3">
              {actions.map((a, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); a.onPress?.(); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors">
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cycling Power Zone Bar ──
export function PowerZoneBar({ zones }) {
  const colors = { z1: '#94a3b8', z2: '#3b82f6', z3: '#22c55e', z4: '#eab308', z5: '#f97316', z6: '#ef4444', z7: '#dc2626' };
  const labels = { z1: 'Recovery', z2: 'Endurance', z3: 'Tempo', z4: 'Threshold', z5: 'VO2', z6: 'Anaerobic', z7: 'NM' };
  const total = Object.values(zones).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  return (
    <div>
      <div className="flex h-4 rounded-full overflow-hidden">
        {Object.entries(zones).map(([z, pct]) => pct > 0 && (
          <div key={z} style={{ width: `${(pct / total) * 100}%`, backgroundColor: colors[z] }}
            title={`${labels[z]}: ${pct}%`} />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {Object.entries(zones).map(([z, pct]) => pct > 0 && (
          <span key={z} className="text-[9px] text-slate-500">{labels[z]}</span>
        ))}
      </div>
    </div>
  );
}

// ── Coggan Power Profile Reference Data ──
export const cogganMaleTable = [
  { cat: 'World Class', min: 5.83, max: 6.40, color: '#dc2626', percentile: '99th+' },
  { cat: 'Exceptional', min: 5.28, max: 5.82, color: '#f97316', percentile: '95-99th' },
  { cat: 'Excellent', min: 4.71, max: 5.27, color: '#eab308', percentile: '85-95th' },
  { cat: 'Very Good', min: 4.13, max: 4.70, color: '#22c55e', percentile: '70-85th' },
  { cat: 'Good', min: 3.55, max: 4.12, color: '#3b82f6', percentile: '50-70th' },
  { cat: 'Moderate', min: 3.05, max: 3.54, color: '#6366f1', percentile: '35-50th' },
  { cat: 'Fair', min: 2.50, max: 3.04, color: '#8b5cf6', percentile: '20-35th' },
  { cat: 'Untrained', min: 2.00, max: 2.49, color: '#94a3b8', percentile: '0-20th' },
];

export const cogganFemaleTable = [
  { cat: 'World Class', min: 4.65, max: 5.69, color: '#dc2626', percentile: '99th+' },
  { cat: 'Exceptional', min: 4.13, max: 4.64, color: '#f97316', percentile: '95-99th' },
  { cat: 'Excellent', min: 3.60, max: 4.12, color: '#eab308', percentile: '85-95th' },
  { cat: 'Very Good', min: 3.28, max: 3.59, color: '#22c55e', percentile: '70-85th' },
  { cat: 'Good', min: 2.82, max: 3.27, color: '#3b82f6', percentile: '50-70th' },
  { cat: 'Moderate', min: 2.36, max: 2.81, color: '#6366f1', percentile: '35-50th' },
  { cat: 'Fair', min: 1.91, max: 2.35, color: '#8b5cf6', percentile: '20-35th' },
  { cat: 'Untrained', min: 1.58, max: 1.90, color: '#94a3b8', percentile: '0-20th' },
];

// Full Power Profile Durations (Male W/kg) for radar chart
export const cogganPowerProfileMale = {
  'World Class':   { '5s': [24.04, 26.07], '1min': [11.50, 12.91], '5min': [7.60, 8.47], 'FTP': [5.83, 6.40] },
  'Exceptional':   { '5s': [22.36, 23.68], '1min': [10.44, 11.32], '5min': [6.81, 7.50], 'FTP': [5.28, 5.82] },
  'Excellent':     { '5s': [20.57, 22.13], '1min': [9.29, 10.33],  '5min': [6.04, 6.72], 'FTP': [4.71, 5.27] },
  'Very Good':     { '5s': [18.27, 20.35], '1min': [8.06, 9.18],   '5min': [5.26, 5.96], 'FTP': [4.13, 4.70] },
  'Good':          { '5s': [15.83, 18.04], '1min': [6.80, 7.94],   '5min': [4.52, 5.18], 'FTP': [3.55, 4.12] },
  'Moderate':      { '5s': [13.14, 15.61], '1min': [5.48, 6.69],   '5min': [3.77, 4.44], 'FTP': [3.05, 3.54] },
  'Fair':          { '5s': [10.44, 12.92], '1min': [4.16, 5.37],   '5min': [3.02, 3.69], 'FTP': [2.50, 3.04] },
  'Untrained':     { '5s': [7.52, 10.22],  '1min': [2.82, 4.04],   '5min': [2.27, 2.94], 'FTP': [2.00, 2.49] },
};

// ── Helper: Classify W/kg into Coggan category ──
export function classifyWkg(wkg, gender = 'male') {
  const table = gender === 'female' ? cogganFemaleTable : cogganMaleTable;
  for (const row of table) {
    if (wkg >= row.min) return row;
  }
  return table[table.length - 1];
}

// ── Helper: Age-adjusted FTP ──
// Decline rate: ~5-8% per decade from age 35 (using 6% average)
export function ageAdjustedFTP(ftp, age) {
  if (age <= 35) return ftp;
  const decadesOver35 = (age - 35) / 10;
  const adjustmentFactor = 1 + (decadesOver35 * 0.06);
  return Math.round(ftp * adjustmentFactor);
}
