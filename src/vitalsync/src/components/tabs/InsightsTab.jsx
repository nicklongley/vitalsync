import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminWeek } from '@/hooks/useGarminData';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

// ── Hooks ──

function useInterventions(count = 10) {
  const { user } = useAuth();
  const [interventions, setInterventions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'interventions'),
      orderBy('createdAt', 'desc'),
      limit(count)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setInterventions(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, count]);

  return { interventions, loading };
}

// ── Components ──

function InterventionCard({ intervention, uid }) {
  const { title, summary, actionItems, priority, category, status } = intervention;
  const isDismissed = status === 'dismissed';
  const isCompleted = status === 'completed';

  async function updateStatus(newStatus) {
    try {
      await updateDoc(doc(db, 'users', uid, 'interventions', intervention.id), { status: newStatus });
    } catch (err) {
      console.error('Failed to update intervention:', err);
    }
  }

  if (isDismissed) return null;

  const priorityColors = {
    high: 'border-rose-500/30 bg-rose-500/5',
    medium: 'border-amber-500/30 bg-amber-500/5',
    low: 'border-slate-600/30',
  };

  return (
    <div className={`glass-card p-4 border ${priorityColors[priority] || priorityColors.low} ${isCompleted ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {category && (
            <span className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">
              {category}
            </span>
          )}
          <p className="text-white text-sm font-medium">{title || 'Insight'}</p>
          {summary && <p className="text-slate-400 text-xs mt-1 leading-relaxed">{summary}</p>}
        </div>
        {priority === 'high' && (
          <span className="text-rose-400 text-[10px] font-medium flex-shrink-0">HIGH</span>
        )}
      </div>

      {actionItems && actionItems.length > 0 && (
        <ul className="mt-2 space-y-1">
          {actionItems.map((item, i) => (
            <li key={i} className="text-slate-300 text-xs flex items-start gap-2">
              <span className="text-emerald-500 mt-0.5">{'>'}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {!isCompleted && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => updateStatus('completed')}
            className="text-[10px] text-emerald-400 border border-emerald-500/30 rounded px-2 py-1 hover:bg-emerald-500/10 transition-colors"
          >
            Done
          </button>
          <button
            onClick={() => updateStatus('dismissed')}
            className="text-[10px] text-slate-500 border border-slate-700 rounded px-2 py-1 hover:text-slate-400 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function TrendChart({ data, dataKey, label, color = '#10B981', unit = '' }) {
  if (!data || data.length < 2) return null;

  return (
    <div className="glass-card p-4">
      <p className="text-slate-400 text-xs mb-2">{label}</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 2, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#1E293B', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
            labelStyle={{ color: '#94A3B8' }}
            formatter={(v) => [`${v}${unit}`, label]}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 2, fill: color }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HealthScoreCard({ label, score, color }) {
  const scoreColor = score >= 70 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-rose-400';
  const barColor = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="flex items-center gap-3">
      <span className="text-slate-400 text-xs w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-mono w-8 text-right ${scoreColor}`}>{score}</span>
    </div>
  );
}

export default function InsightsTab() {
  const { user } = useAuth();
  const [view, setView] = useState('interventions');
  const { interventions, loading: interventionsLoading } = useInterventions(15);
  const { data: weekData, loading: weekLoading } = useGarminWeek();

  const loading = interventionsLoading || weekLoading;

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  // Build trend data from week
  const hrTrend = weekData
    .map((d) => ({
      date: d.date?.slice(5),
      hr: d.heartRates?.restingHeartRate || null,
    }))
    .filter((d) => d.hr);

  const sleepTrend = weekData
    .map((d) => ({
      date: d.date?.slice(5),
      hours: d.sleep?.sleepTimeSeconds ? +(d.sleep.sleepTimeSeconds / 3600).toFixed(1) : null,
    }))
    .filter((d) => d.hours);

  const hrvTrend = weekData
    .map((d) => ({
      date: d.date?.slice(5),
      hrv: d.hrv?.hrvSummary?.lastNightAvg || d.hrv?.lastNightAvg || null,
    }))
    .filter((d) => d.hrv);

  const stressTrend = weekData
    .map((d) => ({
      date: d.date?.slice(5),
      stress: d.stress?.overallStressLevel || d.stress?.avgStressLevel || null,
    }))
    .filter((d) => d.stress);

  const activeInterventions = interventions.filter((i) => i.status !== 'dismissed' && i.status !== 'completed');
  const completedInterventions = interventions.filter((i) => i.status === 'completed');

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('interventions')}
          className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${
            view === 'interventions'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          Insights {activeInterventions.length > 0 && `(${activeInterventions.length})`}
        </button>
        <button
          onClick={() => setView('trends')}
          className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${
            view === 'trends'
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          Trends
        </button>
      </div>

      {view === 'interventions' ? (
        <>
          {activeInterventions.length === 0 && completedInterventions.length === 0 ? (
            <div className="glass-card p-6 text-center">
              <p className="text-slate-400 text-sm">No insights yet</p>
              <p className="text-slate-500 text-xs mt-1">
                AI-powered health insights will appear here once enough data is collected.
              </p>
            </div>
          ) : (
            <>
              {activeInterventions.length > 0 && (
                <div className="space-y-2">
                  {activeInterventions.map((intervention) => (
                    <InterventionCard key={intervention.id} intervention={intervention} uid={user.uid} />
                  ))}
                </div>
              )}

              {completedInterventions.length > 0 && (
                <div>
                  <p className="text-slate-500 text-xs mb-2">Completed</p>
                  <div className="space-y-2">
                    {completedInterventions.slice(0, 5).map((intervention) => (
                      <InterventionCard key={intervention.id} intervention={intervention} uid={user.uid} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {/* 7-day Trends */}
          <TrendChart data={hrTrend} dataKey="hr" label="Resting Heart Rate" color="#10B981" unit=" bpm" />
          <TrendChart data={sleepTrend} dataKey="hours" label="Sleep Duration" color="#8B5CF6" unit="h" />
          <TrendChart data={hrvTrend} dataKey="hrv" label="HRV (Last Night Avg)" color="#06B6D4" unit=" ms" />
          <TrendChart data={stressTrend} dataKey="stress" label="Stress Level" color="#F59E0B" />

          {hrTrend.length < 2 && sleepTrend.length < 2 && (
            <div className="glass-card p-6 text-center">
              <p className="text-slate-400 text-sm">Not enough data for trends</p>
              <p className="text-slate-500 text-xs mt-1">
                Keep syncing your Garmin data to see weekly trends.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
