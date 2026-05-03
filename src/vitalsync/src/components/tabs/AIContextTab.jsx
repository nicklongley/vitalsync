// ══════════════════════════════════════════════════════
// VITALSYNC — AI Context Tab
// Phase 1a: capture surfaces for training + health context.
// Compilation + view/edit/export of .me/.focus files lands in 1b/1c.
// ══════════════════════════════════════════════════════

import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  TRAINING_QUESTIONS,
  HEALTH_QUESTIONS,
  countAnswered,
} from '@/lib/aiContextQuestions';

const DOMAINS = [
  { id: 'training', label: 'Training', icon: '🏃', sections: TRAINING_QUESTIONS },
  { id: 'health', label: 'Health', icon: '❤', sections: HEALTH_QUESTIONS },
];

export default function AIContextTab() {
  const [activeDomain, setActiveDomain] = useState('training');
  const domain = DOMAINS.find(d => d.id === activeDomain);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">AI Context</h2>
        <p className="text-xs text-slate-400 mt-1">
          Answers feed Claude when generating your <code className="text-emerald-400">.me</code> and{' '}
          <code className="text-emerald-400">.focus</code> files. Compilation lands soon —
          for now, capture what only you know.
        </p>
      </div>

      {/* Domain switcher */}
      <div className="flex gap-2">
        {DOMAINS.map(d => (
          <DomainButton key={d.id} domain={d} active={activeDomain === d.id} onClick={() => setActiveDomain(d.id)} />
        ))}
      </div>

      <DomainCapture domain={domain} />
    </div>
  );
}

function DomainButton({ domain, active, onClick }) {
  const { userSettings } = useAuth();
  const capture = userSettings?.aiContextCapture?.[domain.id] || {};
  const { answered, total } = countAnswered(domain.sections, capture);
  const pct = Math.round((answered / total) * 100);
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-3 rounded-xl text-xs font-medium transition-colors min-h-[44px] text-left ${
        active
          ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
          : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-base">{domain.icon}</span>
        <span className="font-semibold">{domain.label}</span>
      </div>
      <div className="text-[10px] text-slate-500 mt-1">{answered} / {total} answered · {pct}%</div>
    </button>
  );
}

function DomainCapture({ domain }) {
  const { user, userSettings } = useAuth();
  const capture = userSettings?.aiContextCapture?.[domain.id] || {};

  async function saveAnswer(questionId, value) {
    if (!user) return;
    const trimmed = (value || '').trim();
    const path = `aiContextCapture.${domain.id}.${questionId}`;
    if (!trimmed) {
      // Treat empty as "clear" by setting answer to empty string + updatedAt
      await setDoc(doc(db, 'users', user.uid), {
        aiContextCapture: {
          [domain.id]: { [questionId]: { answer: '', updatedAt: serverTimestamp() } },
        },
      }, { merge: true });
      return;
    }
    await setDoc(doc(db, 'users', user.uid), {
      aiContextCapture: {
        [domain.id]: { [questionId]: { answer: trimmed, updatedAt: serverTimestamp() } },
      },
    }, { merge: true });
  }

  return (
    <div className="space-y-5">
      {domain.sections.map((section, i) => (
        <div key={i} className="space-y-3">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">{section.section}</p>
            {section.sectionDesc && <p className="text-[10px] text-slate-600 mt-0.5">{section.sectionDesc}</p>}
          </div>
          {section.items.map(item => (
            <QuestionCard
              key={item.id}
              item={item}
              entry={capture[item.id]}
              onSave={(val) => saveAnswer(item.id, val)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function QuestionCard({ item, entry, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry?.answer || '');
  const [saving, setSaving] = useState(false);
  const hasAnswer = !!entry?.answer?.trim?.();

  function startEdit() {
    setDraft(entry?.answer || '');
    setEditing(true);
  }

  async function commit() {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      console.error('Failed to save answer:', err);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(entry?.answer || '');
    setEditing(false);
  }

  const updatedAt = entry?.updatedAt?.toDate?.() || null;

  return (
    <div className={`glass-card p-4 transition-colors ${hasAnswer ? '' : 'opacity-90'}`}>
      <p className="text-sm text-white font-medium leading-snug">{item.prompt}</p>

      {!editing ? (
        <>
          {hasAnswer ? (
            <p className="text-xs text-slate-300 whitespace-pre-line mt-2 leading-relaxed">{entry.answer}</p>
          ) : (
            <p className="text-xs text-slate-600 italic mt-2">Not answered yet</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <p className="text-[10px] text-slate-600">
              {updatedAt ? `Updated ${updatedAt.toLocaleDateString()}` : ''}
            </p>
            <button
              onClick={startEdit}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors px-2 py-1 min-h-[32px]"
            >
              {hasAnswer ? '✎ Edit' : '+ Answer'}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={item.placeholder || ''}
            rows={4}
            disabled={saving}
            autoFocus
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm
                       placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors
                       resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={cancel}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700
                         text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[36px]"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white
                         hover:bg-emerald-500 disabled:opacity-50 transition-colors min-h-[36px]"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
