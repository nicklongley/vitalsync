// ══════════════════════════════════════════════════════
// VITALSYNC — Cycling Power Analytics Tab
// Sub-views: Overview, Profile, PMC, Rides, Compare
// Reference: Architecture Section 4A
// ══════════════════════════════════════════════════════

import { useState } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useRecentActivities, useGarminSync } from '@/hooks/useGarminData';
import { MetricCard, PowerZoneBar, cogganMaleTable, cogganFemaleTable, classifyWkg } from '@/components/shared';

// ── Sub-view navigation ──
const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'profile', label: 'Profile' },
  { id: 'pmc', label: 'PMC' },
  { id: 'rides', label: 'Rides' },
  { id: 'compare', label: 'Compare' },
];

export default function CyclingTab() {
  const [view, setView] = useState('overview');
  const { activities, loading } = useRecentActivities(50);
  const { connected } = useGarminSync();

  // Filter cycling activities
  const rides = activities.filter(a =>
    a.activityType?.typeKey === 'cycling' || a.activityType?.typeKey === 'road_biking' ||
    a.activityType?.typeKey === 'indoor_cycling' || a.activityType?.typeKey === 'virtual_ride'
  );

  const hasRealData = rides.length > 0;

  // When Garmin is connected but no cycling data, show empty state
  if (connected && !hasRealData && !loading) {
    return (
      <div className="space-y-4">
        <div className="glass-card p-8 text-center space-y-2">
          <p className="text-3xl">{"\uD83D\uDEB4"}</p>
          <p className="text-sm text-slate-300 font-medium">No cycling data yet</p>
          <p className="text-xs text-slate-500">
            Cycling analytics will appear once you sync rides with power data from your Garmin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-view pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium transition-colors ${
              view === v.id ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {!connected && !hasRealData && (
        <p className="text-[10px] text-slate-600 text-center">
          Showing sample data. Connect Garmin and sync cycling activities to see your real metrics.
        </p>
      )}

      {view === 'overview' && <OverviewView rides={rides} />}
      {view === 'profile' && <ProfileView />}
      {view === 'pmc' && <PMCView />}
      {view === 'rides' && <RidesView rides={rides} loading={loading} />}
      {view === 'compare' && <CompareView />}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// OVERVIEW — FTP, W/kg, Category, Key Stats
// ══════════════════════════════════════════════════════

function OverviewView({ rides }) {
  // TODO: Pull from users/{uid}/cyclingProfile in Firestore
  // Using placeholder structure matching architecture Section 3.1
  const profile = {
    currentFTP: 268,
    currentWeight: 80.7,
    currentWattsPerKg: 3.32,
    ftpHistory: [
      { month: 'Sep', ftp: 235, wkg: 2.88 }, { month: 'Oct', ftp: 242, wkg: 2.96 },
      { month: 'Nov', ftp: 250, wkg: 3.07 }, { month: 'Dec', ftp: 255, wkg: 3.15 },
      { month: 'Jan', ftp: 262, wkg: 3.25 }, { month: 'Feb', ftp: 268, wkg: 3.33 },
    ],
    ctl: 56,
    atl: 48,
    tsb: 8,
  };

  const category = classifyWkg(profile.currentWattsPerKg);

  return (
    <div className="space-y-3">
      {/* Hero: FTP + W/kg */}
      <div className="glass-card p-5">
        <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Functional Threshold Power</p>
        <div className="flex items-baseline gap-3">
          <span className="metric-hero text-cyan-400">{profile.currentFTP}</span>
          <span className="text-slate-400 text-sm">watts</span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-lg font-mono font-bold text-white">{profile.currentWattsPerKg}</span>
          <span className="text-slate-400 text-xs">W/kg</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: category.color + '30', color: category.color }}>
            {category.cat}
          </span>
          <span className="text-xs text-slate-500">{category.percentile}</span>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-slate-400">Fitness (CTL)</p>
          <p className="text-lg font-mono font-bold text-emerald-400">{profile.ctl}</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-slate-400">Fatigue (ATL)</p>
          <p className="text-lg font-mono font-bold text-amber-400">{profile.atl}</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-[10px] text-slate-400">Form (TSB)</p>
          <p className={`text-lg font-mono font-bold ${profile.tsb >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {profile.tsb > 0 ? '+' : ''}{profile.tsb}
          </p>
        </div>
      </div>

      {/* FTP History Chart */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-3">FTP Progression</p>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={profile.ftpHistory}>
            <defs>
              <linearGradient id="ftpGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={35} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }} />
            <Area type="monotone" dataKey="ftp" stroke="#06b6d4" strokeWidth={2} fill="url(#ftpGrad)" dot={{ r: 3, fill: '#06b6d4' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Coggan Category Scale */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Where You Sit</p>
        <div className="space-y-1">
          {cogganMaleTable.map(row => {
            const isYou = row.cat === category.cat;
            return (
              <div key={row.cat} className={`flex items-center gap-2 px-2 py-1 rounded-lg ${isYou ? 'bg-slate-700' : ''}`}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                <span className={`text-xs flex-1 ${isYou ? 'text-white font-semibold' : 'text-slate-500'}`}>{row.cat}</span>
                <span className="text-xs text-slate-500 font-mono">{row.min.toFixed(2)} - {row.max.toFixed(2)}</span>
                {isYou && <span className="text-[10px] text-cyan-400">{"\u25C0"} you</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// PROFILE — Radar chart: Coggan Power Profile
// ══════════════════════════════════════════════════════

function ProfileView() {
  // TODO: Pull from cyclingProfile.powerProfile in Firestore
  const mockPowerProfile = [
    { metric: '5s Sprint', you: 78, good: 60, veryGood: 75, excellent: 88 },
    { metric: '1min Anaerobic', you: 55, good: 60, veryGood: 75, excellent: 88 },
    { metric: '5min VO2max', you: 68, good: 60, veryGood: 75, excellent: 88 },
    { metric: 'FTP', you: 72, good: 60, veryGood: 75, excellent: 88 },
  ];

  return (
    <div className="space-y-3">
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Coggan Power Profile (Percentile)</p>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={mockPowerProfile}>
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
            <Radar name="Excellent" dataKey="excellent" stroke="#eab30860" fill="#eab30820" />
            <Radar name="Very Good" dataKey="veryGood" stroke="#22c55e60" fill="#22c55e20" />
            <Radar name="Good" dataKey="good" stroke="#3b82f660" fill="#3b82f620" />
            <Radar name="You" dataKey="you" stroke="#06b6d4" strokeWidth={2} fill="#06b6d430" dot={{ r: 4, fill: '#06b6d4' }} />
          </RadarChart>
        </ResponsiveContainer>
        <div className="flex justify-center gap-4 mt-2">
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500" /> You</span>
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500/60" /> Good</span>
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/60" /> Very Good</span>
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500/60" /> Excellent</span>
        </div>
      </div>

      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Your Strengths & Weaknesses</p>
        {mockPowerProfile.map(p => (
          <div key={p.metric} className="flex items-center gap-3 py-2">
            <span className="text-xs text-slate-300 w-24">{p.metric}</span>
            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${p.you}%` }} />
            </div>
            <span className="text-xs font-mono text-white w-8 text-right">{p.you}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// PMC — Performance Management Chart
// ══════════════════════════════════════════════════════

function PMCView() {
  // TODO: Pull from cyclingProfile.pmcHistory in Firestore
  const mockPMC = [
    { day: 'W1', ctl: 42, atl: 38, tsb: 4 }, { day: 'W2', ctl: 44, atl: 52, tsb: -8 },
    { day: 'W3', ctl: 47, atl: 58, tsb: -11 }, { day: 'W4', ctl: 49, atl: 45, tsb: 4 },
    { day: 'W5', ctl: 51, atl: 55, tsb: -4 }, { day: 'W6', ctl: 53, atl: 62, tsb: -9 },
    { day: 'W7', ctl: 55, atl: 48, tsb: 7 }, { day: 'W8', ctl: 56, atl: 60, tsb: -4 },
  ];

  return (
    <div className="space-y-3">
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-3">Performance Management Chart</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={mockPMC}>
            <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="ctl" stroke="#10b981" strokeWidth={2} name="Fitness (CTL)" dot={false} />
            <Line type="monotone" dataKey="atl" stroke="#f59e0b" strokeWidth={2} name="Fatigue (ATL)" dot={false} />
            <Bar dataKey="tsb" name="Form (TSB)" radius={[4, 4, 0, 0]}>
              {mockPMC.map((entry, i) => (
                <rect key={i} fill={entry.tsb >= 0 ? '#10b98150' : '#f4365e50'} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex justify-center gap-4 mt-2">
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-0.5 bg-emerald-500 inline-block" /> Fitness</span>
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-0.5 bg-amber-500 inline-block" /> Fatigue</span>
          <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/30 inline-block" /> Form</span>
        </div>
      </div>

      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">What This Means</p>
        <p className="text-xs text-slate-300">
          TSB (Form) of <span className="font-mono font-bold text-emerald-400">+8</span> means you're fresh and ready to perform.
          Ideal race-day form is +15 to +25. Negative TSB means you're building fitness through fatigue.
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// RIDES — Recent ride list with power data
// ══════════════════════════════════════════════════════

function RidesView({ rides, loading }) {
  // TODO: Replace with real Garmin activity data from Firestore
  const mockRides = [
    { date: 'Sat 1 Feb', name: 'Endurance Ride', np: 195, avgP: 178, tss: 82, ifVal: 0.73, kj: 1420, duration: '2h 10m', zones: { z1: 8, z2: 62, z3: 18, z4: 8, z5: 3, z6: 1 } },
    { date: 'Wed 29 Jan', name: 'Sweet Spot Intervals', np: 238, avgP: 215, tss: 68, ifVal: 0.89, kj: 980, duration: '1h 15m', zones: { z1: 15, z2: 20, z3: 10, z4: 45, z5: 8, z6: 2 } },
    { date: 'Sun 26 Jan', name: 'Long Sunday Ride', np: 185, avgP: 172, tss: 105, ifVal: 0.69, kj: 2100, duration: '3h 05m', zones: { z1: 10, z2: 68, z3: 15, z4: 5, z5: 2, z6: 0 } },
  ];

  return (
    <div className="space-y-3">
      {mockRides.map((ride, i) => (
        <div key={i} className="glass-card p-4 space-y-3 animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{ride.name}</p>
              <p className="text-[10px] text-slate-500">{ride.date} · {ride.duration}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">TSS</p>
              <p className="text-lg font-mono font-bold text-cyan-400">{ride.tss}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <div><p className="text-[10px] text-slate-500">NP</p><p className="text-sm font-mono font-bold text-white">{ride.np}w</p></div>
            <div><p className="text-[10px] text-slate-500">Avg</p><p className="text-sm font-mono font-bold text-white">{ride.avgP}w</p></div>
            <div><p className="text-[10px] text-slate-500">IF</p><p className="text-sm font-mono font-bold text-white">{ride.ifVal}</p></div>
            <div><p className="text-[10px] text-slate-500">kJ</p><p className="text-sm font-mono font-bold text-white">{ride.kj.toLocaleString()}</p></div>
          </div>

          <PowerZoneBar zones={ride.zones} />
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// COMPARE — Demographic comparison
// ══════════════════════════════════════════════════════

function CompareView() {
  // TODO: Pull from cyclingProfile.demographic in Firestore
  return (
    <div className="space-y-3">
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Your FTP vs Age/Gender Group</p>
        <p className="text-xs text-slate-300 mb-3">Male, 35-44, comparing to global cycling population</p>

        <div className="space-y-3">
          {[
            { label: 'FTP (W/kg)', value: 3.33, percentile: 62, color: '#06b6d4' },
            { label: '5s Sprint', value: 14.8, percentile: 78, color: '#8b5cf6' },
            { label: '1min Power', value: 6.2, percentile: 55, color: '#f59e0b' },
            { label: '5min VO2max', value: 4.8, percentile: 68, color: '#10b981' },
          ].map(m => (
            <div key={m.label}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-slate-300">{m.label}</span>
                <span className="text-xs font-mono text-white">{m.value} W/kg · {m.percentile}th</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden relative">
                <div className="h-full rounded-full transition-all" style={{ width: `${m.percentile}%`, backgroundColor: m.color }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/50" style={{ left: '50%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Age-Adjusted Performance</p>
        <p className="text-xs text-slate-300">
          Your raw FTP of <span className="font-mono font-bold">268W</span> adjusts to{' '}
          <span className="font-mono font-bold text-emerald-400">284W</span> when accounting for age-related decline
          (~6%/decade from 35). This places you in the{' '}
          <span className="font-bold text-cyan-400">Good</span> category for your age group.
        </p>
      </div>
    </div>
  );
}
