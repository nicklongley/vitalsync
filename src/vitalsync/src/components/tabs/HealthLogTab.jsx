// ══════════════════════════════════════════════════════
// VITALSYNC — Health Log Tab
// Manual health entries: weight, blood pressure, mood, notes
// ══════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useHealthLog, useGarminWeightHistory } from '@/hooks/useGarminData';
import { DateEntryPicker } from '@/components/shared';

const ENTRY_TYPES = [
  { id: 'weight', label: 'Weight', icon: '\u2696\uFE0F' },
  { id: 'blood_pressure', label: 'BP', icon: '\uD83E\uDE78' },
  { id: 'glucose', label: 'Glucose', icon: '\uD83E\uDE78' },
  { id: 'cholesterol', label: 'Chol.', icon: '\uD83E\uDDEA' },
  { id: 'mood', label: 'Mood', icon: '\uD83D\uDE0A' },
  { id: 'notes', label: 'Notes', icon: '\uD83D\uDCDD' },
];

const MOOD_OPTIONS = [
  { value: 1, label: 'Terrible', emoji: '\uD83D\uDE29' },
  { value: 2, label: 'Bad', emoji: '\uD83D\uDE1E' },
  { value: 3, label: 'Okay', emoji: '\uD83D\uDE10' },
  { value: 4, label: 'Good', emoji: '\uD83D\uDE0A' },
  { value: 5, label: 'Great', emoji: '\uD83E\uDD29' },
];

export default function HealthLogTab() {
  const { user } = useAuth();
  const { entries, loading } = useHealthLog(null, 20);
  const { entries: garminWeights } = useGarminWeightHistory(30);
  const [activeType, setActiveType] = useState('weight');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // Merge manual entries with Garmin weight data for display
  const mergedEntries = useMemo(() => {
    const manualDates = new Set(entries.filter(e => e.type === 'weight').map(e => e.date));
    // Add Garmin weights for dates that don't have a manual weight entry
    const garminEntries = garminWeights
      .filter(gw => !manualDates.has(gw.date))
      .map(gw => ({
        id: `garmin-${gw.date}`,
        type: 'weight',
        date: gw.date,
        value: gw.value,
        unit: 'kg',
        bodyFat: gw.bodyFat,
        source: 'garmin',
      }));
    return [...entries, ...garminEntries].sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, garminWeights]);

  // Form state
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [mood, setMood] = useState(0);
  const [energy, setEnergy] = useState(3);
  const [noteText, setNoteText] = useState('');
  const [glucose, setGlucose] = useState('');
  const [glucoseTiming, setGlucoseTiming] = useState('fasting');
  const [totalChol, setTotalChol] = useState('');
  const [hdl, setHdl] = useState('');
  const [ldl, setLdl] = useState('');
  const [triglycerides, setTriglycerides] = useState('');

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setSuccess(false);

    try {
      let entry = { type: activeType, date, createdAt: serverTimestamp() };

      if (activeType === 'weight') {
        const w = parseFloat(weight);
        if (!w || w < 20 || w > 300) { setSaving(false); return; }
        entry.value = w;
        entry.unit = 'kg';
        if (waist) {
          const wc = parseFloat(waist);
          if (wc >= 30 && wc <= 200) entry.waistCm = wc;
        }
      } else if (activeType === 'blood_pressure') {
        const s = parseInt(systolic), d = parseInt(diastolic);
        if (!s || !d || s < 60 || s > 250 || d < 30 || d > 150) { setSaving(false); return; }
        entry.systolic = s;
        entry.diastolic = d;
        if (heartRate) entry.heartRate = parseInt(heartRate);
      } else if (activeType === 'glucose') {
        const g = parseFloat(glucose);
        if (!g || g < 1 || g > 40) { setSaving(false); return; }
        entry.value = g;
        entry.unit = 'mmol/L';
        entry.timing = glucoseTiming;
      } else if (activeType === 'cholesterol') {
        const tc = parseFloat(totalChol);
        if (!tc || tc < 1 || tc > 20) { setSaving(false); return; }
        entry.totalCholesterol = tc;
        if (hdl) entry.hdl = parseFloat(hdl);
        if (ldl) entry.ldl = parseFloat(ldl);
        if (triglycerides) entry.triglycerides = parseFloat(triglycerides);
        entry.unit = 'mmol/L';
      } else if (activeType === 'mood') {
        if (!mood) { setSaving(false); return; }
        entry.mood = mood;
        entry.energy = energy;
        if (noteText.trim()) entry.notes = noteText.trim();
      } else if (activeType === 'notes') {
        if (!noteText.trim()) { setSaving(false); return; }
        entry.text = noteText.trim();
      }

      await addDoc(collection(db, 'users', user.uid, 'healthLog'), entry);
      setSuccess(true);
      // Reset form
      setWeight(''); setWaist(''); setSystolic(''); setDiastolic(''); setHeartRate('');
      setGlucose(''); setGlucoseTiming('fasting'); setTotalChol(''); setHdl(''); setLdl(''); setTriglycerides('');
      setMood(0); setEnergy(3); setNoteText('');
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save health log entry:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header + Date Picker */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Health Log</h2>
        <DateEntryPicker value={date} onChange={setDate} />
      </div>

      {/* Entry type selector */}
      <div className="flex gap-2">
        {ENTRY_TYPES.map(t => (
          <button key={t.id} onClick={() => setActiveType(t.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeType === t.id
                ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                : 'bg-slate-800 border border-slate-700 text-slate-400'
            }`}>
            <span className="text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Entry form */}
      <div className="glass-card p-4 space-y-4">
        {activeType === 'weight' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                placeholder="e.g. 75.5"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-lg font-mono
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Waist Circumference (cm) — optional</label>
              <input
                type="number"
                step="0.5"
                value={waist}
                onChange={e => setWaist(e.target.value)}
                placeholder="e.g. 82"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
          </div>
        )}

        {activeType === 'blood_pressure' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Systolic (mmHg)</label>
                <input
                  type="number"
                  value={systolic}
                  onChange={e => setSystolic(e.target.value)}
                  placeholder="120"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                             placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Diastolic (mmHg)</label>
                <input
                  type="number"
                  value={diastolic}
                  onChange={e => setDiastolic(e.target.value)}
                  placeholder="80"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                             placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Heart Rate (optional)</label>
              <input
                type="number"
                value={heartRate}
                onChange={e => setHeartRate(e.target.value)}
                placeholder="72"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
          </div>
        )}

        {activeType === 'glucose' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Blood Glucose (mmol/L)</label>
              <input
                type="number"
                step="0.1"
                value={glucose}
                onChange={e => setGlucose(e.target.value)}
                placeholder="e.g. 5.5"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-lg font-mono
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-2">Timing</label>
              <div className="grid grid-cols-2 gap-2">
                {['fasting', 'before meal', 'after meal', 'random'].map(t => (
                  <button key={t} onClick={() => setGlucoseTiming(t)}
                    className={`py-2 rounded-xl text-xs font-medium transition-colors ${
                      glucoseTiming === t
                        ? 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400'
                        : 'bg-slate-800 border border-slate-700 text-slate-400'
                    }`}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeType === 'cholesterol' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Total Cholesterol (mmol/L)</label>
              <input
                type="number"
                step="0.1"
                value={totalChol}
                onChange={e => setTotalChol(e.target.value)}
                placeholder="e.g. 5.2"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-lg font-mono
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">HDL</label>
                <input
                  type="number"
                  step="0.1"
                  value={hdl}
                  onChange={e => setHdl(e.target.value)}
                  placeholder="1.5"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                             placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">LDL</label>
                <input
                  type="number"
                  step="0.1"
                  value={ldl}
                  onChange={e => setLdl(e.target.value)}
                  placeholder="3.0"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                             placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Trig.</label>
                <input
                  type="number"
                  step="0.1"
                  value={triglycerides}
                  onChange={e => setTriglycerides(e.target.value)}
                  placeholder="1.7"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono
                             placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
                />
              </div>
            </div>
          </div>
        )}

        {activeType === 'mood' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-2">How are you feeling?</label>
              <div className="flex justify-between">
                {MOOD_OPTIONS.map(m => (
                  <button key={m.value} onClick={() => setMood(m.value)}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all ${
                      mood === m.value ? 'bg-emerald-600/20 scale-110' : 'hover:bg-slate-700'
                    }`}>
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="text-[10px] text-slate-400">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-2">Energy Level: {energy}/5</label>
              <input
                type="range" min="1" max="5" value={energy}
                onChange={e => setEnergy(parseInt(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-600 px-1">
                <span>Low</span><span>High</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Notes (optional)</label>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="How do you feel today?"
                rows={2}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm
                           placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors resize-none"
              />
            </div>
          </div>
        )}

        {activeType === 'notes' && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Health Notes</label>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Log symptoms, supplements, injuries, or anything health-related..."
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm
                         placeholder:text-slate-600 focus:outline-none focus:border-emerald-600 transition-colors resize-none"
            />
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
            success
              ? 'bg-emerald-600 text-white'
              : 'bg-emerald-600/20 border border-emerald-700/50 text-emerald-400 hover:bg-emerald-600/30'
          } disabled:opacity-50`}
        >
          {saving ? 'Saving...' : success ? 'Saved!' : 'Save Entry'}
        </button>
      </div>

      {/* Recent entries */}
      <div className="glass-card p-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-3">Recent Entries</p>
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          </div>
        ) : mergedEntries.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No entries yet. Start logging above.</p>
        ) : (
          <div className="space-y-2">
            {mergedEntries.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-slate-800/50 last:border-0">
                <span className="text-lg">{getEntryIcon(entry.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{formatEntry(entry)}</p>
                  <p className="text-[10px] text-slate-500">
                    {entry.date}
                    {entry.source === 'garmin' && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 text-[9px] font-medium">Garmin</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getEntryIcon(type) {
  const icons = { weight: '\u2696\uFE0F', blood_pressure: '\uD83E\uDE78', glucose: '\uD83E\uDE78', cholesterol: '\uD83E\uDDEA', mood: '\uD83D\uDE0A', notes: '\uD83D\uDCDD' };
  return icons[type] || '\uD83D\uDCCB';
}

function formatEntry(entry) {
  switch (entry.type) {
    case 'weight': {
      let s = `${entry.value} kg`;
      if (entry.bodyFat) s += ` \u00B7 ${entry.bodyFat}% body fat`;
      if (entry.waistCm) s += ` \u00B7 Waist: ${entry.waistCm} cm`;
      return s;
    }
    case 'blood_pressure': return `${entry.systolic}/${entry.diastolic} mmHg${entry.heartRate ? ` \u00B7 ${entry.heartRate} bpm` : ''}`;
    case 'mood': {
      const emoji = MOOD_OPTIONS.find(m => m.value === entry.mood)?.emoji || '';
      return `${emoji} ${MOOD_OPTIONS.find(m => m.value === entry.mood)?.label || ''} \u00B7 Energy: ${entry.energy}/5`;
    }
    case 'glucose': return `${entry.value} mmol/L \u00B7 ${entry.timing || 'random'}`;
    case 'cholesterol': {
      let s = `Total: ${entry.totalCholesterol} mmol/L`;
      if (entry.hdl) s += ` \u00B7 HDL: ${entry.hdl}`;
      if (entry.ldl) s += ` \u00B7 LDL: ${entry.ldl}`;
      return s;
    }
    case 'notes': return entry.text?.slice(0, 60) + (entry.text?.length > 60 ? '...' : '');
    default: return entry.type;
  }
}

const MOOD_OPTIONS_REF = MOOD_OPTIONS;
