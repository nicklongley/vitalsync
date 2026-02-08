// ══════════════════════════════════════════════════════
// VITALSYNC — Insights Tab
// AI daily analysis, interventions, on-demand Q&A
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { InterventionCard } from '@/components/shared';

export default function InsightsTab() {
  const { user } = useAuth();
  const [interventions, setInterventions] = useState([]);
  const [loadingInterventions, setLoadingInterventions] = useState(true);
  const [analysing, setAnalysing] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

  // Listen to interventions
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'interventions'),
      orderBy('createdAt', 'desc'),
      limit(10)
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

  async function runDailyAnalysis() {
    setAnalysing(true);
    setError('');
    setAnalysisSummary('');
    try {
      const fn = httpsCallable(functions, 'ai_daily_analysis');
      const result = await fn();
      setAnalysisSummary(result.data.summary || 'Analysis complete.');
    } catch (err) {
      console.error('AI analysis failed:', err);
      setError(err.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalysing(false);
    }
  }

  async function askQuestion() {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer('');
    setError('');
    try {
      const fn = httpsCallable(functions, 'ai_on_demand');
      const result = await fn({ question: question.trim() });
      setAnswer(result.data.answer || 'No answer received.');
    } catch (err) {
      console.error('AI Q&A failed:', err);
      setError(err.message || 'Failed to get answer. Please try again.');
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-white">AI Insights</h2>

      {/* Daily Analysis */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Daily Analysis</p>
            <p className="text-[10px] text-slate-500">AI reviews your Garmin data and generates insights</p>
          </div>
          <button
            onClick={runDailyAnalysis}
            disabled={analysing}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-emerald-600/20 border border-emerald-700/50
                       text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
          >
            {analysing ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                Analysing...
              </span>
            ) : 'Run Analysis'}
          </button>
        </div>

        {analysisSummary && (
          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 animate-fade-in">
            <p className="text-xs text-emerald-400 font-medium mb-1">Today's Summary</p>
            <p className="text-sm text-slate-300 leading-relaxed">{analysisSummary}</p>
          </div>
        )}

        {error && !answer && (
          <p className="text-xs text-rose-400">{error}</p>
        )}
      </div>

      {/* Interventions */}
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Active Interventions</p>
        {loadingInterventions ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : interventions.length > 0 ? (
          <div className="space-y-2">
            {interventions.map(interv => (
              <InterventionCard
                key={interv.id}
                priority={interv.priority || 'low'}
                category={interv.category || 'training'}
                title={interv.title || 'Insight'}
                summary={interv.summary || interv.description || ''}
                actions={interv.actionItems?.map(a => ({ label: a })) || []}
              />
            ))}
          </div>
        ) : (
          <div className="glass-card p-6 text-center space-y-2">
            <p className="text-2xl">{"\uD83E\uDDE0"}</p>
            <p className="text-sm text-slate-400">No interventions yet</p>
            <p className="text-xs text-slate-500">Run a daily analysis to generate AI-powered insights based on your health data.</p>
          </div>
        )}
      </div>

      {/* Ask AI */}
      <div className="glass-card p-4 space-y-3">
        <p className="text-sm font-semibold text-white">Ask Your AI Coach</p>
        <p className="text-[10px] text-slate-500">
          Ask about your training, recovery, health trends, or get personalised advice.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && askQuestion()}
            placeholder="e.g. Should I rest today?"
            maxLength={2000}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm
                       placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
          />
          <button
            onClick={askQuestion}
            disabled={asking || !question.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-cyan-600 text-white
                       hover:bg-cyan-500 disabled:opacity-50 transition-colors"
          >
            {asking ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin inline-block" />
            ) : 'Ask'}
          </button>
        </div>

        {/* Quick questions */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUESTIONS.map((q, i) => (
            <button key={i} onClick={() => setQuestion(q)}
              className="px-2.5 py-1 rounded-full text-[10px] bg-slate-800 text-slate-400 border border-slate-700
                         hover:border-slate-600 hover:text-slate-300 transition-colors">
              {q}
            </button>
          ))}
        </div>

        {answer && (
          <div className="bg-cyan-950/30 border border-cyan-800/40 rounded-xl p-4 animate-fade-in">
            <p className="text-xs text-cyan-400 font-medium mb-2">AI Coach</p>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{answer}</p>
          </div>
        )}

        {error && answer === '' && asking === false && (
          <p className="text-xs text-rose-400">{error}</p>
        )}
      </div>

      {/* Trends placeholder */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Trend Highlights</p>
        <div className="space-y-3">
          {MOCK_TRENDS.map((trend, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-lg">{trend.icon}</span>
              <div>
                <p className="text-sm text-white font-medium">{trend.title}</p>
                <p className="text-xs text-slate-400">{trend.description}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-3 text-center">
          Trends update automatically as more data is collected.
        </p>
      </div>
    </div>
  );
}

const QUICK_QUESTIONS = [
  'Should I rest today?',
  'How is my sleep trending?',
  'Am I overtraining?',
  'What should I focus on this week?',
];

const MOCK_TRENDS = [
  { icon: '\uD83D\uDE34', title: 'Sleep improving', description: 'Your average sleep duration increased by 22 mins over the last 2 weeks.' },
  { icon: '\u2764\uFE0F', title: 'RHR stable', description: 'Resting heart rate holding steady at 58-60 bpm. Good cardiovascular fitness.' },
  { icon: '\uD83C\uDFC3', title: 'Training load rising', description: 'Weekly training hours up 12% vs last month. Monitor recovery closely.' },
];
