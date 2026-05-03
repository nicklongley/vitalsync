// ══════════════════════════════════════════════════════
// VITALSYNC — Weekly Plan Context Modal
// Captures ad-hoc constraints (travel, races, illness, etc.) before plan
// generation. Quick-pick chips append templated lines to the textarea.
// ══════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';

const QUICK_CHIPS = [
  { label: 'Travel', text: 'Traveling — only have hotel gym / bodyweight on those days.' },
  { label: 'Race', text: 'Race on Saturday — taper through the week, easy day Friday.' },
  { label: 'Long ride', text: 'Long ride planned for Sunday (3+ hours).' },
  { label: 'Sleep deprived', text: 'Poor sleep this week — keep intensity low.' },
  { label: 'Illness recovery', text: 'Recovering from illness — easy aerobic only, no intervals.' },
  { label: 'High work stress', text: 'Heavy work week — prioritise recovery, shorter sessions.' },
  { label: 'Strength focus', text: 'Want extra strength sessions this week.' },
  { label: 'Rest week', text: 'Recovery week — reduce volume by ~30% across the board.' },
];

// Compute the Monday of "this week" and "next week" relative to now.
function computeWeeks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dowFromMon = (today.getDay() + 6) % 7;  // 0=Mon..6=Sun
  const thisMon = new Date(today);
  thisMon.setDate(today.getDate() - dowFromMon);
  const nextMon = new Date(thisMon);
  nextMon.setDate(thisMon.getDate() + 7);
  return { thisMon, nextMon, dowFromMon };
}

function fmtRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function isoDate(d) {
  // Local-tz YYYY-MM-DD (avoids the toISOString UTC drift problem)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function WeeklyPlanContextModal({ open, initialContext = '', onCancel, onSubmit, generating }) {
  const [text, setText] = useState('');
  // Default: Mon-Wed → this week; Thu-Sun → next week
  const { thisMon, nextMon, dowFromMon } = computeWeeks();
  const [forNextWeek, setForNextWeek] = useState(dowFromMon >= 3);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open) {
      setText(initialContext || '');
      setForNextWeek(dowFromMon >= 3);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, initialContext, dowFromMon]);

  if (!open) return null;

  function appendChip(chipText) {
    setText(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return chipText;
      if (trimmed.includes(chipText)) return trimmed;  // avoid duplicates
      return `${trimmed}\n${chipText}`;
    });
    textareaRef.current?.focus();
  }

  function handleSubmit() {
    const targetMon = forNextWeek ? nextMon : thisMon;
    onSubmit(text.trim(), isoDate(targetMon));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 pt-16 sm:p-6"
         onClick={(e) => { if (e.target === e.currentTarget && !generating) onCancel(); }}>
      <div className="glass-card w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4 animate-fade-in">
        <div>
          <p className="text-base font-semibold text-white">Plan for which week?</p>
          <p className="text-xs text-slate-400 mt-1">
            Pick the target week and add any ad-hoc constraints (travel, races, illness, work stress). The AI treats notes as hard rules.
          </p>
        </div>

        {/* Week selector */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Target week</p>
          <div className="flex gap-2">
            <button
              onClick={() => setForNextWeek(false)}
              disabled={generating}
              className={`flex-1 px-3 py-3 rounded-xl text-xs font-medium transition-colors min-h-[44px] text-center ${
                !forNextWeek
                  ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <span className="block font-semibold">This week</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">{fmtRange(thisMon)}</span>
            </button>
            <button
              onClick={() => setForNextWeek(true)}
              disabled={generating}
              className={`flex-1 px-3 py-3 rounded-xl text-xs font-medium transition-colors min-h-[44px] text-center ${
                forNextWeek
                  ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                  : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <span className="block font-semibold">Next week</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">{fmtRange(nextMon)}</span>
            </button>
          </div>
        </div>

        {/* Quick-pick chips */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Quick add</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CHIPS.map((chip, i) => (
              <button
                key={i}
                onClick={() => appendChip(chip.text)}
                disabled={generating}
                className="px-3 py-1.5 rounded-full text-[11px] bg-slate-800 border border-slate-700
                           text-slate-300 hover:bg-slate-700 hover:border-slate-600 disabled:opacity-50
                           transition-colors min-h-[32px]"
              >
                + {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Free-text */}
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">Notes</label>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={generating}
            rows={6}
            placeholder="e.g. Traveling Wed–Fri, race Saturday, sleep has been poor."
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm
                       placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors
                       resize-none"
          />
          <p className="text-[10px] text-slate-600 mt-1">Leave empty to generate from base data only.</p>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={generating}
            className="flex-1 py-3 rounded-xl text-sm font-medium bg-slate-800 border border-slate-700
                       text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={generating}
            className="flex-1 py-3 rounded-xl text-sm font-medium bg-emerald-600 text-white
                       hover:bg-emerald-500 disabled:opacity-50 transition-colors min-h-[44px]
                       flex items-center justify-center gap-2"
          >
            {generating && <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            {generating ? 'Generating...' : 'Generate Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
