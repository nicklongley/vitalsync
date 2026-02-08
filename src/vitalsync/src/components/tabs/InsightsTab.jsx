// ══════════════════════════════════════════════════════
// VITALSYNC — Insights Tab
// Monthly scorecard, AI analysis, interventions, Q&A, trends
// Design ref: vitalsync-dashboard.jsx lines 545-549
// ══════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useGarminWeek, useGarminSync } from '@/hooks/useGarminData';
import { GaugeRing, InterventionCard, ActionPrompt } from '@/components/shared';

export default function InsightsTab() {
  const { user } = useAuth();
  const { connected } = useGarminSync();
  const { data: weekData } = useGarminWeek();
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

  // Compute real trends from week data
  const trends = useMemo(() => {
    if (!weekData || weekData.length < 7) return [];
    const result = [];

    // Sleep trend (last 3 days vs first 4 days)
    const recentSleep = weekData.slice(4).filter(d => d.sleep?.sleepTimeSeconds);
    const earlierSleep = weekData.slice(0, 4).filter(d => d.sleep?.sleepTimeSeconds);
    if (recentSleep.length > 0 && earlierSleep.length > 0) {
      const recentAvg = recentSleep.reduce((s, d) => s + d.sleep.sleepTimeSeconds, 0) / recentSleep.length;
      const earlierAvg = earlierSleep.reduce((s, d) => s + d.sleep.sleepTimeSeconds, 0) / earlierSleep.length;
      const diffMin = Math.round((recentAvg - earlierAvg) / 60);
      result.push({
        icon: '\uD83D\uDE34',
        title: diffMin > 0 ? 'Sleep improving' : diffMin < 0 ? 'Sleep declining' : 'Sleep stable',
        description: diffMin !== 0
          ? `Average sleep ${diffMin > 0 ? 'increased' : 'decreased'} by ${Math.abs(diffMin)} mins over the last 7 days.`
          : 'Sleep duration is consistent this week.',
        trend: diffMin > 0 ? 'up' : diffMin < 0 ? 'down' : 'stable',
      });
    }

    // RHR trend
    const recentHR = weekData.slice(4).filter(d => d.heartRates?.restingHeartRate);
    const earlierHR = weekData.slice(0, 4).filter(d => d.heartRates?.restingHeartRate);
    if (recentHR.length > 0 && earlierHR.length > 0) {
      const recentRHR = Math.round(recentHR.reduce((s, d) => s + d.heartRates.restingHeartRate, 0) / recentHR.length);
      const earlierRHR = Math.round(earlierHR.reduce((s, d) => s + d.heartRates.restingHeartRate, 0) / earlierHR.length);
      const diff = recentRHR - earlierRHR;
      result.push({
        icon: '\u2764\uFE0F',
        title: diff < 0 ? 'RHR improving' : diff > 0 ? 'RHR elevated' : 'RHR stable',
        description: `Resting heart rate ${diff === 0 ? 'holding steady' : (diff < 0 ? 'dropped' : 'rose')} at ${recentRHR} bpm${diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff} bpm)` : ''}.`,
        trend: diff < 0 ? 'up' : diff > 0 ? 'down' : 'stable',
      });
    }

    // Steps trend
    const recentSteps = weekData.slice(4).filter(d => d.stats?.totalSteps);
    const earlierSteps = weekData.slice(0, 4).filter(d => d.stats?.totalSteps);
    if (recentSteps.length > 0 && earlierSteps.length > 0) {
      const recentAvg = Math.round(recentSteps.reduce((s, d) => s + d.stats.totalSteps, 0) / recentSteps.length);
      const earlierAvg = Math.round(earlierSteps.reduce((s, d) => s + d.stats.totalSteps, 0) / earlierSteps.length);
      const pct = Math.round(((recentAvg - earlierAvg) / (earlierAvg || 1)) * 100);
      result.push({
        icon: '\uD83D\uDC63',
        title: pct > 0 ? 'Activity increasing' : pct < 0 ? 'Activity decreasing' : 'Activity steady',
        description: `Daily steps averaging ${recentAvg.toLocaleString()} (${pct > 0 ? '+' : ''}${pct}% vs start of week).`,
        trend: pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable',
      });
    }

    return result;
  }, [weekData]);

  // Compute sleep chart from week data
  const sleepChart = useMemo(() => {
    if (!weekData || weekData.length === 0) return [];
    return weekData.map(day => {
      const sleep = day.sleep || {};
      const deepSec = sleep.deepSleepSeconds || 0;
      const lightSec = sleep.lightSleepSeconds || 0;
      const remSec = sleep.remSleepSeconds || 0;
      const dayLabel = day.date ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }) : '';
      return {
        day: dayLabel,
        deep: parseFloat((deepSec / 3600).toFixed(1)),
        light: parseFloat((lightSec / 3600).toFixed(1)),
        rem: parseFloat((remSec / 3600).toFixed(1)),
      };
    });
  }, [weekData]);

  // Compute scorecard from week data
  const scorecard = useMemo(() => {
    if (!weekData || weekData.length === 0) return null;
    const daysWithData = weekData.filter(d => d.stats || d.heartRates || d.sleep);
    if (daysWithData.length === 0) return null;

    const avgSteps = Math.round(daysWithData.filter(d => d.stats?.totalSteps).reduce((s, d) => s + (d.stats?.totalSteps || 0), 0) / (daysWithData.length || 1));
    const avgSleep = daysWithData.filter(d => d.sleep?.sleepTimeSeconds).reduce((s, d) => s + (d.sleep?.sleepTimeSeconds || 0), 0) / (daysWithData.filter(d => d.sleep?.sleepTimeSeconds).length || 1);
    const avgRHR = Math.round(daysWithData.filter(d => d.heartRates?.restingHeartRate).reduce((s, d) => s + (d.heartRates?.restingHeartRate || 0), 0) / (daysWithData.filter(d => d.heartRates?.restingHeartRate).length || 1));
    const avgBattery = Math.round(daysWithData.filter(d => d.bodyBattery?.bodyBatteryHigh || d.stress?.bodyBatteryHigh).reduce((s, d) => s + (d.bodyBattery?.bodyBatteryHigh || d.stress?.bodyBatteryHigh || 0), 0) / (daysWithData.filter(d => d.bodyBattery?.bodyBatteryHigh || d.stress?.bodyBatteryHigh).length || 1));

    // Simple scoring: 0-100 scale
    const stepsScore = Math.min(100, Math.round((avgSteps / 10000) * 100));
    const sleepScore = Math.min(100, Math.round((avgSleep / (8 * 3600)) * 100));
    const rhrScore = avgRHR > 0 ? Math.min(100, Math.round(((100 - avgRHR) / 40) * 100)) : 0;
    const batteryScore = avgBattery;
    const overallScore = Math.round((stepsScore + sleepScore + rhrScore + batteryScore) / 4);

    return [
      { label: 'Overall', score: overallScore, color: '#10b981' },
      { label: 'Activity', score: stepsScore, color: '#818cf8' },
      { label: 'Sleep', score: sleepScore, color: '#a78bfa' },
      { label: 'Recovery', score: batteryScore, color: '#f59e0b' },
      { label: 'Heart', score: rhrScore, color: '#ef4444' },
    ];
  }, [weekData]);

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

      {/* Garmin not connected */}
      {!connected && (
        <ActionPrompt
          icon={"\uD83E\uDDE0"}
          title="AI insights require Garmin data"
          subtitle="Connect your Garmin account to unlock AI-powered health analysis and coaching."
          cta="Go to Settings"
          accent="cyan"
          dismissible={false}
        />
      )}

      {/* Weekly Scorecard */}
      {scorecard && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Weekly Scorecard</p>
          <div className="flex justify-around">
            {scorecard.map((m, i) => (
              <GaugeRing key={i} value={m.score} max={100} color={m.color} size={60} label={m.label} />
            ))}
          </div>
        </div>
      )}

      {/* Sleep Stages Chart */}
      {sleepChart.some(d => d.deep > 0 || d.light > 0) && (
        <div className="glass-card p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Sleep Stages - 7 Days</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={sleepChart}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, fontSize: 12 }}
                formatter={(v) => [`${v}h`, '']} />
              <Bar dataKey="deep" stackId="a" fill="#4338ca" name="Deep" />
              <Bar dataKey="light" stackId="a" fill="#818cf8" name="Light" />
              <Bar dataKey="rem" stackId="a" fill="#c4b5fd" radius={[4, 4, 0, 0]} name="REM" />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-700" /> Deep</span>
            <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-indigo-400" /> Light</span>
            <span className="text-[10px] text-slate-400 flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-300" /> REM</span>
          </div>
        </div>
      )}

      {/* Daily Analysis */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Daily Analysis</p>
            <p className="text-[10px] text-slate-500">AI reviews your Garmin data and generates insights</p>
          </div>
          <button
            onClick={runDailyAnalysis}
            disabled={analysing || !connected}
            className="px-4 py-2.5 rounded-xl text-xs font-medium bg-emerald-600/20 border border-emerald-700/50
                       text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {analysing ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                Analysing...
              </span>
            ) : 'Analyze Today'}
          </button>
        </div>

        {analysisSummary && (
          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 animate-fade-in">
            <p className="text-xs text-emerald-400 font-medium mb-1">Today's Summary</p>
            <p className="text-sm text-slate-300 leading-relaxed">{analysisSummary}</p>
          </div>
        )}

        {error && !analysisSummary && !answer && (
          <p className="text-xs text-rose-400">{error}</p>
        )}
      </div>

      {/* Interventions */}
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Active Interventions</p>
        {loadingInterventions ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="glass-card h-24 animate-pulse" />
            ))}
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
          <ActionPrompt
            icon={"\uD83E\uDDE0"}
            title="No insights yet"
            subtitle="Run a daily analysis to generate AI-powered interventions based on your Garmin health data."
            cta="Run Analysis"
            ctaAction={runDailyAnalysis}
            accent="emerald"
            dismissible={false}
          />
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
            disabled={!connected}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm
                       placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors
                       disabled:opacity-50"
          />
          <button
            onClick={askQuestion}
            disabled={asking || !question.trim() || !connected}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-cyan-600 text-white
                       hover:bg-cyan-500 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {asking ? (
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin inline-block" />
            ) : 'Ask'}
          </button>
        </div>

        {/* Quick questions */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUESTIONS.map((q, i) => (
            <button key={i} onClick={() => { setQuestion(q); }}
              className="px-3 py-2 rounded-full text-xs bg-slate-800 text-slate-400 border border-slate-700
                         hover:border-slate-600 hover:text-slate-300 transition-colors min-h-[36px]">
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

        {error && !answer && !asking && (
          <p className="text-xs text-rose-400">{error}</p>
        )}
      </div>

      {/* Real Trends */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Trend Highlights</p>
        {trends.length > 0 ? (
          <div className="space-y-3">
            {trends.map((trend, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-lg">{trend.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-white font-medium">{trend.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      trend.trend === 'up' ? 'bg-emerald-900/60 text-emerald-300' :
                      trend.trend === 'down' ? 'bg-rose-900/60 text-rose-300' :
                      'bg-slate-700/60 text-slate-300'
                    }`}>
                      {trend.trend === 'up' ? '\u2191' : trend.trend === 'down' ? '\u2193' : '\u2192'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{trend.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 text-center py-4">
            Trends will appear once we have a few days of Garmin data to analyse.
          </p>
        )}
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
