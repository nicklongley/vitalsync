// ══════════════════════════════════════════════════════
// VITALSYNC — Training Tab
// AI weekly training plan display + generation
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export default function TrainingTab() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Listen to training plans
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'trainingPlans'),
      orderBy('createdAt', 'desc'),
      limit(4)
    );

    const unsub = onSnapshot(q, (snap) => {
      setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingPlans(false);
    }, (err) => {
      console.error('Error loading training plans:', err);
      setLoadingPlans(false);
    });

    return () => unsub();
  }, [user]);

  async function generatePlan() {
    setGenerating(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'ai_weekly_plan');
      await fn();
    } catch (err) {
      console.error('Plan generation failed:', err);
      setError(err.message || 'Failed to generate plan.');
    } finally {
      setGenerating(false);
    }
  }

  async function toggleSession(planId, sessionIndex, completed) {
    try {
      const plan = plans.find(p => p.id === planId);
      if (!plan) return;
      const updatedSessions = [...plan.sessions];
      updatedSessions[sessionIndex] = { ...updatedSessions[sessionIndex], completed };
      await updateDoc(doc(db, 'users', user.uid, 'trainingPlans', planId), {
        sessions: updatedSessions,
      });
    } catch (err) {
      console.error('Failed to update session:', err);
    }
  }

  const currentPlan = plans[0];
  const pastPlans = plans.slice(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Training Plan</h2>
        <button
          onClick={generatePlan}
          disabled={generating}
          className="px-4 py-2 rounded-xl text-xs font-medium bg-emerald-600/20 border border-emerald-700/50
                     text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
        >
          {generating ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
              Generating...
            </span>
          ) : 'Generate Plan'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {loadingPlans ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      ) : currentPlan ? (
        <>
          {/* Current plan header */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-white">This Week's Plan</p>
                <p className="text-[10px] text-slate-500">
                  {currentPlan.weekStartDate} to {currentPlan.weekEndDate}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Planned</p>
                <p className="text-lg font-mono font-bold text-emerald-400">
                  {currentPlan.totalPlannedMinutes ? `${Math.round(currentPlan.totalPlannedMinutes / 60)}h` : '--'}
                </p>
              </div>
            </div>
            {currentPlan.summary && (
              <p className="text-xs text-slate-300 leading-relaxed">{currentPlan.summary}</p>
            )}
            {currentPlan.focusAreas?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {currentPlan.focusAreas.map((area, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-900/30 text-cyan-400 border border-cyan-800/40">
                    {area}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Sessions */}
          <div className="space-y-2">
            {(currentPlan.sessions || []).map((session, i) => (
              <div key={i} className={`glass-card p-4 transition-all ${session.completed ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleSession(currentPlan.id, i, !session.completed)}
                    className={`w-6 h-6 rounded-lg border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors ${
                      session.completed
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-600 hover:border-emerald-600'
                    }`}
                  >
                    {session.completed && '\u2713'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{getSessionIcon(session.type || session.sport)}</span>
                      <p className={`text-sm font-medium ${session.completed ? 'text-slate-500 line-through' : 'text-white'}`}>
                        {session.title || session.name || 'Session'}
                      </p>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {session.day && (DAY_LABELS[session.day.toLowerCase()] || session.day)}
                      {session.duration && ` \u00B7 ${session.duration}`}
                      {session.durationMinutes && ` \u00B7 ${session.durationMinutes}min`}
                      {session.intensity && ` \u00B7 ${session.intensity}`}
                    </p>
                    {session.description && (
                      <p className="text-xs text-slate-400 mt-1">{session.description}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Progress */}
          {currentPlan.sessions?.length > 0 && (
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400">Week Progress</p>
                <p className="text-xs font-mono text-white">
                  {currentPlan.sessions.filter(s => s.completed).length}/{currentPlan.sessions.length} sessions
                </p>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${(currentPlan.sessions.filter(s => s.completed).length / currentPlan.sessions.length) * 100}%` }}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        /* No plan yet */
        <div className="glass-card p-8 text-center space-y-3">
          <p className="text-3xl">{"\uD83C\uDFCB\uFE0F"}</p>
          <p className="text-sm text-slate-300 font-medium">No training plan yet</p>
          <p className="text-xs text-slate-500">
            Generate an AI-powered weekly training plan based on your Garmin data, goals, and availability.
          </p>
          <button
            onClick={generatePlan}
            disabled={generating}
            className="px-6 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white
                       hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating...' : 'Generate My Plan'}
          </button>
        </div>
      )}

      {/* Past plans */}
      {pastPlans.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Previous Plans</p>
          <div className="space-y-2">
            {pastPlans.map(plan => (
              <div key={plan.id} className="glass-card p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-white font-medium">
                      {plan.weekStartDate} - {plan.weekEndDate}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {plan.sessions?.filter(s => s.completed).length || 0}/{plan.sessions?.length || 0} completed
                    </p>
                  </div>
                  {plan.totalPlannedMinutes && (
                    <p className="text-xs font-mono text-slate-400">{Math.round(plan.totalPlannedMinutes / 60)}h</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getSessionIcon(type) {
  const icons = {
    running: '\uD83C\uDFC3', run: '\uD83C\uDFC3',
    cycling: '\uD83D\uDEB4', ride: '\uD83D\uDEB4', bike: '\uD83D\uDEB4',
    swimming: '\uD83C\uDFCA', swim: '\uD83C\uDFCA',
    strength: '\uD83C\uDFCB\uFE0F', gym: '\uD83C\uDFCB\uFE0F',
    rest: '\uD83D\uDECC', recovery: '\uD83E\uDDD8',
    yoga: '\uD83E\uDDD8', stretch: '\uD83E\uDDD8',
  };
  return icons[type?.toLowerCase()] || '\uD83C\uDFC3';
}
