// ══════════════════════════════════════════════════════
// VITALSYNC — Plan Adjustment Modal
// Free-text request for a small change to an existing plan.
// ══════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';

const EXAMPLES = [
  'Move Tuesday\'s intervals to Thursday',
  'Make Saturday\'s long ride 30 min shorter',
  'Swap Wednesday\'s rest for an easy 45 min spin',
  'Add a recovery day Friday',
  'Replace Thursday\'s run with strength',
];

export default function WeeklyPlanAdjustModal({ open, onCancel, onSubmit, working, lastResult }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  function handleSubmit() {
    if (!text.trim() || working) return;
    onSubmit(text.trim());
  }

  function applyExample(ex) {
    setText(ex);
    textareaRef.current?.focus();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 pt-16 sm:p-6"
         onClick={(e) => { if (e.target === e.currentTarget && !working) onCancel(); }}>
      <div className="glass-card w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4 animate-fade-in">
        <div>
          <p className="text-base font-semibold text-white">Adjust this week's plan</p>
          <p className="text-xs text-slate-400 mt-1">
            Describe one small change. The rest of the plan stays the same. If your plan is synced to intervals.icu, the calendar updates automatically.
          </p>
        </div>

        {/* Examples */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Examples</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => applyExample(ex)}
                disabled={working}
                className="px-3 py-1.5 rounded-full text-[11px] bg-slate-800 border border-slate-700
                           text-slate-300 hover:bg-slate-700 hover:border-slate-600 disabled:opacity-50
                           transition-colors min-h-[32px] text-left"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Free-text */}
        <div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={working}
            rows={4}
            placeholder="What would you like to change?"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm
                       placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors
                       resize-none"
          />
        </div>

        {lastResult && (
          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 text-xs">
            <p className="text-emerald-400 font-medium">Updated</p>
            <p className="text-slate-300 mt-1">{lastResult}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={working}
            className="flex-1 py-3 rounded-xl text-sm font-medium bg-slate-800 border border-slate-700
                       text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {lastResult ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={working || !text.trim()}
            className="flex-1 py-3 rounded-xl text-sm font-medium bg-cyan-600 text-white
                       hover:bg-cyan-500 disabled:opacity-50 transition-colors min-h-[44px]
                       flex items-center justify-center gap-2"
          >
            {working && <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            {working ? 'Adjusting...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
