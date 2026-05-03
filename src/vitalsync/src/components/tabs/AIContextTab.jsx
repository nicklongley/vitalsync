// ══════════════════════════════════════════════════════
// VITALSYNC — AI Context Tab
// Phase 1a: capture surfaces for training + health context.
// Phase 1b: focus-file compilation, view/edit/export.
// Phase 1c: me-file compilation (still pending).
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  TRAINING_QUESTIONS,
  HEALTH_QUESTIONS,
  countAnswered,
} from '@/lib/aiContextQuestions';

const DOMAINS = [
  {
    id: 'training',
    label: 'Training',
    icon: '🏃',
    sections: TRAINING_QUESTIONS,
    files: [
      { id: 'training_focus', label: 'training.focus.md', kind: 'focus', fn: 'ai_compile_training_focus', enabled: true },
      { id: 'training_me', label: 'training.me.md', kind: 'me', fn: 'ai_compile_training_me', enabled: false },
    ],
  },
  {
    id: 'health',
    label: 'Health',
    icon: '❤',
    sections: HEALTH_QUESTIONS,
    files: [
      { id: 'health_focus', label: 'health.focus.md', kind: 'focus', fn: 'ai_compile_health_focus', enabled: true },
      { id: 'health_me', label: 'health.me.md', kind: 'me', fn: 'ai_compile_health_me', enabled: false },
    ],
  },
];

export default function AIContextTab() {
  const [activeDomain, setActiveDomain] = useState('training');
  const [viewedFileId, setViewedFileId] = useState(null);
  const domain = DOMAINS.find(d => d.id === activeDomain);

  if (viewedFileId) {
    const file = DOMAINS.flatMap(d => d.files).find(f => f.id === viewedFileId);
    if (file) {
      return <ContextFileViewer file={file} onBack={() => setViewedFileId(null)} />;
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">AI Context</h2>
        <p className="text-xs text-slate-400 mt-1">
          Captured answers feed Claude when generating your <code className="text-emerald-400">.me</code> and{' '}
          <code className="text-emerald-400">.focus</code> files. Export the files into your local helper folder.
        </p>
      </div>

      {/* Domain switcher */}
      <div className="flex gap-2">
        {DOMAINS.map(d => (
          <DomainButton key={d.id} domain={d} active={activeDomain === d.id} onClick={() => setActiveDomain(d.id)} />
        ))}
      </div>

      {/* Generated files */}
      <FilesSection domain={domain} onView={setViewedFileId} />

      {/* Capture questions */}
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

function FilesSection({ domain, onView }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400 uppercase tracking-wider">Generated files</p>
      {domain.files.map(file => (
        <FileRow key={file.id} file={file} onView={() => onView(file.id)} />
      ))}
    </div>
  );
}

function FileRow({ file, onView }) {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid, 'aiContext', file.id), (snap) => {
      setMeta(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [user, file.id]);

  const generatedAt = meta?.generatedAt?.toDate?.() || null;
  const editedAt = meta?.editedAt?.toDate?.() || null;
  const lastTouched = editedAt && (!generatedAt || editedAt > generatedAt) ? editedAt : generatedAt;

  return (
    <div className="glass-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">📄</span>
            <p className={`text-sm font-medium ${file.enabled ? 'text-white' : 'text-slate-500'}`}>{file.label}</p>
            {!file.enabled && <span className="text-[10px] text-slate-600">— coming soon</span>}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {meta
              ? `${editedAt && (!generatedAt || editedAt > generatedAt) ? 'Edited' : 'Generated'} ${lastTouched?.toLocaleString() || ''}`
              : 'Not generated yet'}
          </p>
        </div>
        {file.enabled && (
          <button
            onClick={onView}
            className="px-3 py-2 rounded-lg text-[11px] font-medium bg-emerald-600/20 border border-emerald-700/50
                       text-emerald-400 hover:bg-emerald-600/30 transition-colors min-h-[36px]"
          >
            {meta ? 'Open' : 'Generate'}
          </button>
        )}
      </div>
    </div>
  );
}

function ContextFileViewer({ file, onBack }) {
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [generatedSummary, setGeneratedSummary] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid, 'aiContext', file.id), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setMeta(data);
      if (!editing) setDraft(data?.content || '');
      setLoading(false);
    });
    return () => unsub();
  }, [user, file.id, editing]);

  async function handleGenerate() {
    setWorking(true);
    setError('');
    setGeneratedSummary('');
    try {
      const fn = httpsCallable(functions, file.fn);
      const res = await fn();
      const chars = res?.data?.characters;
      setGeneratedSummary(chars ? `Regenerated · ${chars} characters` : 'Regenerated');
      setTimeout(() => setGeneratedSummary(''), 4000);
    } catch (err) {
      console.error('Compile failed:', err);
      setError(err.message || 'Compilation failed.');
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveEdit() {
    if (!user) return;
    setWorking(true);
    setError('');
    try {
      await setDoc(doc(db, 'users', user.uid, 'aiContext', file.id), {
        content: draft,
        editedAt: serverTimestamp(),
      }, { merge: true });
      setEditing(false);
    } catch (err) {
      console.error('Save failed:', err);
      setError(err.message || 'Save failed.');
    } finally {
      setWorking(false);
    }
  }

  function handleExport() {
    const blob = new Blob([meta?.content || draft || ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.label;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors min-h-[36px] -ml-1 px-1"
      >
        <span>{'‹'}</span> Back to AI Context
      </button>

      <div className="glass-card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white">{file.label}</p>
            <p className="text-[10px] text-slate-500 mt-1">
              {meta?.generatedAt?.toDate?.() ? `Generated ${meta.generatedAt.toDate().toLocaleString()}` : 'Not generated yet'}
              {meta?.editedAt?.toDate?.() && ` · edited ${meta.editedAt.toDate().toLocaleString()}`}
            </p>
            {generatedSummary && <p className="text-[10px] text-emerald-400 mt-1">{generatedSummary}</p>}
            {error && <p className="text-[10px] text-rose-400 mt-1">{error}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleGenerate}
              disabled={working}
              className="px-3 py-2 rounded-lg text-[11px] font-medium bg-cyan-600/20 border border-cyan-700/50
                         text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-50 transition-colors min-h-[36px]
                         flex items-center gap-2"
            >
              {working && !editing && <div className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />}
              {meta ? 'Regenerate' : 'Generate'}
            </button>
            {meta && (
              <>
                <button
                  onClick={() => editing ? setEditing(false) : setEditing(true)}
                  disabled={working}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium bg-slate-800 border border-slate-700
                             text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[36px]"
                >
                  {editing ? 'View' : 'Edit'}
                </button>
                <button
                  onClick={handleExport}
                  disabled={working}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium bg-slate-800 border border-slate-700
                             text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[36px]"
                >
                  Export .md
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="glass-card h-48 animate-pulse" />
      ) : !meta && !working ? (
        <div className="glass-card p-8 text-center space-y-2">
          <p className="text-sm text-slate-300 font-medium">No file generated yet</p>
          <p className="text-xs text-slate-500">
            Click Generate to compile from your captured answers and recent training data.
          </p>
        </div>
      ) : working && !meta ? (
        <div className="glass-card p-8 text-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Compiling…</p>
        </div>
      ) : editing ? (
        <div className="glass-card p-4 space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={working}
            rows={24}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-slate-200 text-sm font-mono
                       placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors
                       resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setDraft(meta?.content || ''); setEditing(false); }}
              disabled={working}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 border border-slate-700
                         text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[36px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={working}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white
                         hover:bg-emerald-500 disabled:opacity-50 transition-colors min-h-[36px]"
            >
              {working ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-card p-4">
          <pre className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed font-mono">{meta?.content || ''}</pre>
        </div>
      )}
    </div>
  );
}

function DomainCapture({ domain }) {
  const { user, userSettings } = useAuth();
  const capture = userSettings?.aiContextCapture?.[domain.id] || {};

  async function saveAnswer(questionId, value) {
    if (!user) return;
    const trimmed = (value || '').trim();
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
