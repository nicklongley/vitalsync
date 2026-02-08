// ══════════════════════════════════════════════════════
// VITALSYNC — Cycling Power Analytics Tab
// Sub-views: Overview, Profile, PMC, Rides, Compare
// ══════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart, Line, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useRecentActivities, useGarminSync } from '@/hooks/useGarminData';
import {
  GaugeRing, MetricCard, ActionPrompt, PowerZoneBar,
  cogganMaleTable, cogganFemaleTable, cogganPowerProfileMale,
  classifyWkg, ageAdjustedFTP,
} from '@/components/shared';
import { useAuth } from '@/contexts/AuthContext';

// ── Cycling type keys from Garmin ──
const CYCLING_TYPES = [
  'cycling', 'road_biking', 'indoor_cycling', 'virtual_ride',
  'mountain_biking', 'gravel_cycling', 'recumbent_cycling', 'track_cycling',
];

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
  const { activities, loading } = useRecentActivities(100);
  const { connected, syncing, syncNow, lastSyncAt } = useGarminSync();
  const { userSettings } = useAuth();

  // Filter cycling activities
  const rides = useMemo(() =>
    activities.filter(a => {
      const typeKey = a.activityType?.typeKey || '';
      return CYCLING_TYPES.includes(typeKey) || (a.sportTypeId === 2);
    }),
  [activities]);

  // Skeleton loading
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  // No Garmin connected
  if (!connected && rides.length === 0) {
    return (
      <div className="space-y-4">
        <ActionPrompt
          icon={"\uD83D\uDEB4"}
          title="Connect Garmin for cycling analytics"
          subtitle="Link your Garmin account to unlock FTP tracking, power zones, performance charts, and ride analysis."
          cta="Go to Settings"
          accent="cyan"
          dismissible={false}
        />
      </div>
    );
  }

  // Connected but no cycling data
  if (connected && rides.length === 0) {
    return (
      <div className="space-y-4">
        <ActionPrompt
          icon={"\uD83D\uDEB4"}
          title="No cycling data yet"
          subtitle="Cycling analytics will appear once you sync rides with power data from your Garmin device."
          cta="Sync Now"
          ctaAction={syncNow}
          accent="cyan"
          dismissible={false}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with sync status */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Cycling</h2>
          <p className="text-[10px] text-slate-500">
            {lastSyncAt ? `Synced ${formatTimeAgo(lastSyncAt)}` : 'Garmin connected'}
          </p>
        </div>
        {connected && (
          <button
            onClick={syncNow}
            disabled={syncing}
            className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 transition-colors min-h-[44px] px-3"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        )}
      </div>

      {/* Sub-view pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-4 py-2.5 rounded-full text-xs whitespace-nowrap font-medium transition-colors min-h-[44px] flex items-center ${
              view === v.id ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === 'overview' && <OverviewView rides={rides} userSettings={userSettings} />}
      {view === 'profile' && <ProfileView rides={rides} userSettings={userSettings} />}
      {view === 'pmc' && <PMCView rides={rides} />}
      {view === 'rides' && <RidesView rides={rides} />}
      {view === 'compare' && <CompareView rides={rides} userSettings={userSettings} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// OVERVIEW — FTP, W/kg, Category, Key Stats, Volume
// ══════════════════════════════════════════════════════

function OverviewView({ rides, userSettings }) {
  const profile = useMemo(() => computeCyclingProfile(rides, userSettings), [rides, userSettings]);
  const weeklyVolume = useMemo(() => computeWeeklyVolume(rides, 8), [rides]);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Hero: FTP + W/kg */}
      <div className="glass-card p-5">
        <p className="text-slate-400 text-xs uppercase tracking-wider mb-3">Functional Threshold Power</p>
        <div className="flex justify-around items-center py-2">
          <GaugeRing
            value={profile.ftp}
            max={400}
            color="#06b6d4"
            size={80}
            label="FTP"
          />
          <GaugeRing
            value={Math.round(profile.wkg * 100)}
            max={600}
            color="#8b5cf6"
            size={80}
            label={`${profile.wkg} W/kg`}
          />
          <GaugeRing
            value={profile.ctl}
            max={120}
            color="#10b981"
            size={80}
            label="Fitness"
          />
        </div>
        {profile.category && (
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ backgroundColor: profile.category.color + '30', color: profile.category.color }}>
              {profile.category.cat}
            </span>
            <span className="text-xs text-slate-500">{profile.category.percentile}</span>
          </div>
        )}
        {profile.ftp === 0 && (
          <p className="text-xs text-slate-500 mt-3 text-center">Sync rides with power data to estimate FTP and W/kg.</p>
        )}
      </div>

      {/* Aggregate Stats */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={"\uD83D\uDEB4"}
          title="Total Rides"
          value={rides.length}
          subtitle={`${rides.filter(r => r.trainingStressScore > 0).length} with power`}
        />
        <MetricCard
          icon={"\uD83D\uDCCF"}
          title="Total Distance"
          value={`${Math.round(rides.reduce((s, r) => s + (r.distance || 0), 0) / 1000)}`}
          unit="km"
        />
        <MetricCard
          icon={"\u23F1\uFE0F"}
          title="Total Duration"
          value={formatDuration(rides.reduce((s, r) => s + (r.duration || r.movingDuration || 0), 0))}
        />
        <MetricCard
          icon={"\u26A1"}
          title="Avg Power"
          value={Math.round(rides.filter(r => r.averagePower > 0).reduce((s, r) => s + r.averagePower, 0) / (rides.filter(r => r.averagePower > 0).length || 1))}
          unit="w"
        />
      </div>

      {/* CTL/ATL/TSB */}
      <div className="grid grid-cols-3 gap-2">
        <MetricCard title="Fitness" value={profile.ctl} subtitle="CTL (42d)" />
        <MetricCard title="Fatigue" value={profile.atl} subtitle="ATL (7d)" />
        <MetricCard
          title="Form"
          value={`${profile.tsb > 0 ? '+' : ''}${profile.tsb}`}
          subtitle={profile.tsb >= 5 ? 'Fresh' : profile.tsb >= -10 ? 'Optimal' : 'Fatigued'}
        />
      </div>

      {/* Weekly Volume Chart */}
      {weeklyVolume.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Weekly Ride Volume</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeklyVolume}>
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                formatter={(v) => [`${v.toFixed(1)}h`, 'Duration']}
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {weeklyVolume.map((entry, i) => (
                  <Cell key={i} fill={i === weeklyVolume.length - 1 ? '#06b6d4' : '#06b6d440'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* FTP note */}
      {profile.ftp > 0 && profile.best20min > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 mb-2">FTP Estimate</p>
          <p className="text-xs text-slate-300">
            Based on your best 20-minute power ({Math.round(profile.best20min)}W) across synced rides.
            FTP = 95% of 20-min best = <span className="font-mono font-bold text-cyan-400">{profile.ftp}W</span>.
          </p>
        </div>
      )}

      {/* Coggan Category Scale */}
      {profile.category && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 mb-2">Where You Sit</p>
          <div className="space-y-1">
            {cogganMaleTable.map(row => {
              const isYou = row.cat === profile.category.cat;
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
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// PROFILE — Power Profile from real ride data
// ══════════════════════════════════════════════════════

function ProfileView({ rides, userSettings }) {
  const profile = useMemo(() => computeCyclingProfile(rides, userSettings), [rides, userSettings]);
  const powerProfile = useMemo(() => computePowerProfile(rides, userSettings), [rides, userSettings]);

  if (rides.length === 0) {
    return (
      <ActionPrompt
        icon={"\uD83D\uDEB4"}
        title="No ride data for power profile"
        subtitle="Sync rides with power data to build your Coggan power profile and see where you rank."
        accent="cyan"
        dismissible={false}
      />
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Coggan Power Profile (Percentile)</p>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={powerProfile.radar}>
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
        <p className="text-xs text-slate-400 mb-2">Your Power Data</p>
        {powerProfile.radar.map(p => (
          <div key={p.metric} className="flex items-center gap-3 py-2">
            <span className="text-xs text-slate-300 w-24">{p.metric}</span>
            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${Math.min(p.you, 100)}%` }} />
            </div>
            <span className="text-xs font-mono text-white w-16 text-right">
              {p.watts > 0 ? `${p.watts}W` : '--'}
            </span>
          </div>
        ))}
        {powerProfile.hasLimitedData && (
          <p className="text-[10px] text-slate-600 mt-2">
            Some durations estimated from available data. More rides = more accurate profile.
          </p>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// PMC — Performance Management Chart from real rides
// ══════════════════════════════════════════════════════

function PMCView({ rides }) {
  const pmcData = useMemo(() => computePMC(rides), [rides]);

  if (rides.length < 3) {
    return (
      <ActionPrompt
        icon={"\uD83D\uDCCA"}
        title="Need more ride data"
        subtitle="The Performance Management Chart needs at least 3 rides with TSS data. Keep syncing!"
        accent="cyan"
        dismissible={false}
      />
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-3">Performance Management Chart</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={pmcData}>
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="ctl" stroke="#10b981" strokeWidth={2} name="Fitness (CTL)" dot={false} />
            <Line type="monotone" dataKey="atl" stroke="#f59e0b" strokeWidth={2} name="Fatigue (ATL)" dot={false} />
            <Bar dataKey="tsb" name="Form (TSB)" radius={[4, 4, 0, 0]}>
              {pmcData.map((entry, i) => (
                <Cell key={i} fill={entry.tsb >= 0 ? '#10b98150' : '#f4365e50'} />
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
        {(() => {
          const latest = pmcData[pmcData.length - 1];
          if (!latest) return null;
          const tsb = latest.tsb;
          let advice;
          if (tsb >= 15) advice = { text: 'You are very fresh. Great time for a race or hard effort.', color: 'text-emerald-400' };
          else if (tsb >= 5) advice = { text: 'Good form. Ready for quality training or racing.', color: 'text-emerald-400' };
          else if (tsb >= -10) advice = { text: 'Productive training zone. Building fitness through controlled fatigue.', color: 'text-amber-400' };
          else advice = { text: 'High fatigue. Consider rest or easy rides to recover.', color: 'text-rose-400' };
          return (
            <p className="text-xs text-slate-300">
              Your current form (TSB) is <span className={`font-mono font-bold ${advice.color}`}>{tsb > 0 ? '+' : ''}{tsb}</span>.{' '}
              {advice.text}
            </p>
          );
        })()}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// RIDES — Recent ride list with expanded metrics
// ══════════════════════════════════════════════════════

function RidesView({ rides }) {
  if (rides.length === 0) {
    return (
      <ActionPrompt
        icon={"\uD83D\uDEB4"}
        title="No cycling rides found"
        subtitle="Sync your Garmin to see detailed ride analysis with power, heart rate, and more."
        cta="Sync Now"
        accent="cyan"
        dismissible={false}
      />
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {rides.map((ride, i) => {
        const np = ride.normPower || ride.normalisedPower || 0;
        const avgP = ride.avgPower || ride.averagePower || 0;
        const tss = ride.trainingStressScore || 0;
        const ifVal = ride.intensityFactor || 0;
        const cal = ride.calories ? Math.round(ride.calories) : 0;
        const avgHR = ride.averageHR || ride.averageHeartRate || 0;
        const maxHR = ride.maxHeartRate || ride.maxHR || 0;
        const avgSpeed = ride.averageSpeed ? (ride.averageSpeed * 3.6).toFixed(1) : 0;
        const elev = ride.elevationGain ? Math.round(ride.elevationGain) : 0;
        const cadence = ride.averageBikingCadenceInRevPerMinute || ride.avgCadence || 0;
        const durSec = ride.duration || ride.movingDuration || 0;
        const hours = Math.floor(durSec / 3600);
        const mins = Math.round((durSec % 3600) / 60);
        const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        const dist = ride.distance ? `${(ride.distance / 1000).toFixed(1)} km` : '';
        const dateStr = (ride.startTimeLocal || '').slice(0, 10);
        const aTE = ride.aerobicTrainingEffect || 0;
        const anTE = ride.anaerobicTrainingEffect || 0;

        const zones = {};
        for (let z = 1; z <= 7; z++) {
          const val = ride[`powerTimeInZone_${z}`];
          zones[`z${z}`] = val ? Math.round((val / durSec) * 100) : 0;
        }

        return (
          <div key={ride.activityId || i} className="glass-card p-4 space-y-3 animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{ride.activityName || 'Cycling'}</p>
                <p className="text-[10px] text-slate-500">{dateStr} · {duration}{dist ? ` · ${dist}` : ''}</p>
              </div>
              {tss > 0 && (
                <div className="text-right">
                  <p className="text-[10px] text-slate-400">TSS</p>
                  <p className="text-lg font-mono font-bold text-cyan-400">{Math.round(tss)}</p>
                </div>
              )}
            </div>

            {/* Power metrics row */}
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="NP" value={np ? `${Math.round(np)}w` : '--'} />
              <MiniStat label="Avg" value={avgP ? `${Math.round(avgP)}w` : '--'} />
              <MiniStat label="IF" value={ifVal ? ifVal.toFixed(2) : '--'} />
              <MiniStat label="Cal" value={cal ? cal.toLocaleString() : '--'} />
            </div>

            {/* HR/Speed/Elevation row */}
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="Avg HR" value={avgHR ? `${avgHR}` : '--'} />
              <MiniStat label="Max HR" value={maxHR ? `${maxHR}` : '--'} />
              <MiniStat label="Speed" value={avgSpeed ? `${avgSpeed}` : '--'} unit="km/h" />
              <MiniStat label="Elev" value={elev ? `${elev}` : '--'} unit="m" />
            </div>

            {/* Cadence + Training Effect */}
            {(cadence > 0 || aTE > 0) && (
              <div className="grid grid-cols-4 gap-2">
                <MiniStat label="Cadence" value={cadence ? `${Math.round(cadence)}` : '--'} unit="rpm" />
                {aTE > 0 && <MiniStat label="Aerobic TE" value={aTE.toFixed(1)} />}
                {anTE > 0 && <MiniStat label="Anaerobic TE" value={anTE.toFixed(1)} />}
              </div>
            )}

            {Object.values(zones).some(v => v > 0) && <PowerZoneBar zones={zones} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Mini stat cell for ride cards ──
function MiniStat({ label, value, unit }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="text-sm font-mono font-bold text-white">
        {value}{unit && <span className="text-[9px] text-slate-500 ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// COMPARE — Real data comparison
// ══════════════════════════════════════════════════════

function CompareView({ rides, userSettings }) {
  const profile = useMemo(() => computeCyclingProfile(rides, userSettings), [rides, userSettings]);
  const age = userSettings?.profile?.age || 0;
  const gender = userSettings?.profile?.gender || 'male';
  const table = gender === 'female' ? cogganFemaleTable : cogganMaleTable;

  if (profile.ftp === 0) {
    return (
      <ActionPrompt
        icon={"\uD83D\uDCCA"}
        title="Need power data to compare"
        subtitle="Sync rides with power meter data to see how you compare to the cycling population."
        accent="cyan"
        dismissible={false}
      />
    );
  }

  const adjFTP = age > 0 ? ageAdjustedFTP(profile.ftp, age) : null;

  // Compute percentile position within Coggan table
  const computePercentile = (wkg) => {
    for (const row of table) {
      if (wkg >= row.min) {
        const range = row.max - row.min;
        const position = (wkg - row.min) / range;
        // Map position within category to percentile range
        const pctRange = row.percentile.split('-').map(s => parseInt(s));
        if (pctRange.length === 2) return pctRange[0] + position * (pctRange[1] - pctRange[0]);
        return 99;
      }
    }
    return 10;
  };

  const ftpPct = Math.round(computePercentile(profile.wkg));

  const metrics = [
    { label: 'FTP (W/kg)', value: profile.wkg, percentile: ftpPct, color: '#06b6d4' },
    ...(profile.peakPower > 0 ? [{
      label: 'Peak Power',
      value: profile.weight > 0 ? (profile.peakPower / profile.weight).toFixed(1) : '--',
      percentile: Math.min(95, Math.round(ftpPct * 1.1)),
      color: '#8b5cf6',
    }] : []),
  ];

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 mb-2">Your FTP vs Population</p>
        <p className="text-xs text-slate-300 mb-3">
          {gender === 'female' ? 'Female' : 'Male'}{age > 0 ? `, ${age}` : ''} — Coggan classification
        </p>

        <div className="space-y-3">
          {metrics.map(m => (
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

      {adjFTP && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 mb-2">Age-Adjusted Performance</p>
          <p className="text-xs text-slate-300">
            Your raw FTP of <span className="font-mono font-bold">{profile.ftp}W</span> adjusts to{' '}
            <span className="font-mono font-bold text-emerald-400">{adjFTP}W</span> when accounting for
            age-related decline (~6%/decade from 35).
          </p>
        </div>
      )}

      {!age && (
        <div className="glass-card p-3">
          <p className="text-[10px] text-slate-500 text-center">
            Add your age and weight in Settings for age-adjusted comparisons and more accurate W/kg.
          </p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// COMPUTATION HELPERS
// ══════════════════════════════════════════════════════

// Compute cycling profile with EWMA CTL/ATL/TSB
function computeCyclingProfile(rides, userSettings) {
  const best20min = Math.max(0, ...rides.map(r => r.max20MinPower || r.maxAvgPower_1200 || 0));
  const ftp = best20min > 0 ? Math.round(best20min * 0.95) : 0;
  const peakPower = Math.max(0, ...rides.map(r => r.maxPower || 0));

  const weight = userSettings?.profile?.weight || rides.find(r => r.weight)?.weight || 0;
  const wkg = ftp && weight ? parseFloat((ftp / weight).toFixed(2)) : 0;
  const category = wkg > 0 ? classifyWkg(wkg) : null;

  // EWMA CTL (42-day) and ATL (7-day)
  const { ctl, atl, tsb } = computeEWMA(rides);

  return { ftp, best20min, peakPower, weight, wkg, category, ctl, atl, tsb };
}

// EWMA-based CTL/ATL/TSB calculation
function computeEWMA(rides) {
  if (rides.length === 0) return { ctl: 0, atl: 0, tsb: 0 };

  // Build daily TSS map
  const tssMap = {};
  rides.forEach(r => {
    const date = (r.startTimeLocal || '').slice(0, 10);
    if (!date) return;
    tssMap[date] = (tssMap[date] || 0) + (r.trainingStressScore || 0);
  });

  // Get date range (last 90 days)
  const today = new Date();
  let ctl = 0;
  let atl = 0;

  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayTSS = tssMap[dateStr] || 0;

    ctl = ctl + (dayTSS - ctl) / 42;
    atl = atl + (dayTSS - atl) / 7;
  }

  return {
    ctl: Math.round(ctl),
    atl: Math.round(atl),
    tsb: Math.round(ctl - atl),
  };
}

// Compute weekly volume for bar chart
function computeWeeklyVolume(rides, numWeeks) {
  const today = new Date();
  const weeks = [];

  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() - (w * 7));
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);

    const weekRides = rides.filter(r => {
      const d = new Date(r.startTimeLocal);
      return d >= weekStart && d <= weekEnd;
    });

    const totalSec = weekRides.reduce((s, r) => s + (r.duration || r.movingDuration || 0), 0);
    const label = `W${numWeeks - w}`;

    weeks.push({
      label,
      hours: parseFloat((totalSec / 3600).toFixed(1)),
      rides: weekRides.length,
    });
  }

  return weeks;
}

// Compute power profile percentiles from real ride data
function computePowerProfile(rides, userSettings) {
  const weight = userSettings?.profile?.weight || rides.find(r => r.weight)?.weight || 75;

  // Extract best efforts from ride data
  const peakPower = Math.max(0, ...rides.map(r => r.maxPower || 0));
  const best20min = Math.max(0, ...rides.map(r => r.max20MinPower || r.maxAvgPower_1200 || 0));
  const ftp = best20min > 0 ? Math.round(best20min * 0.95) : 0;

  // Estimate 1min and 5min if not directly available
  const best1min = Math.max(0, ...rides.map(r => r.maxAvgPower_60 || r.max1MinPower || 0));
  const best5min = Math.max(0, ...rides.map(r => r.maxAvgPower_300 || r.max5MinPower || 0));

  // Convert to W/kg
  const efforts = {
    '5s Sprint': peakPower > 0 ? peakPower / weight : 0,
    '1min Anaerobic': best1min > 0 ? best1min / weight : (ftp > 0 ? (ftp * 1.4) / weight : 0),
    '5min VO2max': best5min > 0 ? best5min / weight : (ftp > 0 ? (ftp * 1.2) / weight : 0),
    'FTP': ftp > 0 ? ftp / weight : 0,
  };

  // Convert W/kg to percentile using Coggan reference
  const toPercentile = (wkg, duration) => {
    if (wkg === 0) return 0;
    const worldClass = cogganPowerProfileMale['World Class'][duration];
    const untrained = cogganPowerProfileMale['Untrained'][duration];
    if (!worldClass || !untrained) return 50;
    const min = untrained[0];
    const max = worldClass[1];
    return Math.min(100, Math.max(0, Math.round(((wkg - min) / (max - min)) * 100)));
  };

  const durationMap = { '5s Sprint': '5s', '1min Anaerobic': '1min', '5min VO2max': '5min', 'FTP': 'FTP' };

  const radar = Object.entries(efforts).map(([metric, wkg]) => ({
    metric,
    you: toPercentile(wkg, durationMap[metric]),
    watts: Math.round(wkg * weight),
    good: 50,
    veryGood: 70,
    excellent: 88,
  }));

  const hasLimitedData = best1min === 0 || best5min === 0;

  return { radar, hasLimitedData };
}

// Compute PMC chart data from real rides (weekly aggregation)
function computePMC(rides) {
  if (rides.length === 0) return [];

  const today = new Date();
  const numWeeks = 12;
  const result = [];
  let ctl = 0;
  let atl = 0;

  // Build daily TSS map
  const tssMap = {};
  rides.forEach(r => {
    const date = (r.startTimeLocal || '').slice(0, 10);
    if (!date) return;
    tssMap[date] = (tssMap[date] || 0) + (r.trainingStressScore || 0);
  });

  // Calculate EWMA day by day for last numWeeks*7 days
  const totalDays = numWeeks * 7;
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayTSS = tssMap[dateStr] || 0;

    ctl = ctl + (dayTSS - ctl) / 42;
    atl = atl + (dayTSS - atl) / 7;

    // Record weekly snapshots
    if (i % 7 === 0) {
      const weekNum = Math.floor((totalDays - i) / 7);
      result.push({
        label: `W${weekNum}`,
        ctl: Math.round(ctl),
        atl: Math.round(atl),
        tsb: Math.round(ctl - atl),
      });
    }
  }

  return result;
}

// ── Utility helpers ──
function formatDuration(totalSec) {
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.round((totalSec % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatTimeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
