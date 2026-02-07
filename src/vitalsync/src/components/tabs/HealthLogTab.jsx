import { useState } from 'react';
import { useHealthLog, useHealthLogMutations } from '@/hooks/useGarminData';
import { format } from 'date-fns';

const ENTRY_TYPES = [
  { value: 'weight', label: 'Weight', icon: '\u2696\uFE0F' },
  { value: 'blood_pressure', label: 'Blood Pressure', icon: '\u2764\uFE0F' },
  { value: 'blood_glucose', label: 'Blood Glucose', icon: '\uD83E\uDE78' },
  { value: 'cholesterol', label: 'Cholesterol', icon: '\uD83E\uDDEA' },
  { value: 'mood', label: 'Mood', icon: '\uD83D\uDE0A' },
  { value: 'energy', label: 'Energy', icon: '\u26A1' },
  { value: 'hydration', label: 'Hydration', icon: '\uD83D\uDCA7' },
  { value: 'medication', label: 'Medication', icon: '\uD83D\uDC8A' },
  { value: 'symptom', label: 'Symptom', icon: '\uD83E\uDE7A' },
  { value: 'body_measurements', label: 'Body Measurements', icon: '\uD83D\uDCCF' },
  { value: 'lab_result', label: 'Lab Result', icon: '\uD83C\uDFE5' },
  { value: 'custom', label: 'Custom', icon: '\uD83D\uDCDD' },
];

const MOOD_OPTIONS = ['Great', 'Good', 'Okay', 'Low', 'Bad'];
const ENERGY_OPTIONS = ['High', 'Medium', 'Low', 'Very Low'];

function EntryForm({ onClose }) {
  const { createEntry } = useHealthLogMutations();
  const [type, setType] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateField(key, value) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!type) return;
    setSaving(true);
    setError('');
    try {
      await createEntry(type, date, formData);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">New Entry</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-lg">&times;</button>
      </div>

      {/* Type selector */}
      <div className="grid grid-cols-3 gap-2">
        {ENTRY_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => { setType(t.value); setFormData({}); }}
            className={`text-xs rounded-lg px-2 py-2 transition-colors border ${
              type === t.value
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                : 'bg-slate-700/50 border-slate-600/50 text-slate-400 hover:border-slate-500'
            }`}
          >
            <span className="block text-base mb-0.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Date picker */}
      {type && (
        <>
          <div>
            <label className="text-slate-400 text-xs block mb-1">Date</label>
            <input
              type="date"
              value={date}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => setDate(e.target.value)}
              className="input-field w-full"
            />
          </div>

          {/* Dynamic fields per type */}
          <TypeFields type={type} data={formData} onChange={updateField} />

          {error && <p className="text-rose-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="btn-cta-sm w-full disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </>
      )}
    </form>
  );
}

function TypeFields({ type, data, onChange }) {
  switch (type) {
    case 'weight':
      return (
        <div>
          <label className="text-slate-400 text-xs block mb-1">Weight (kg)</label>
          <input type="number" step="0.1" value={data.kg || ''} onChange={(e) => onChange('kg', parseFloat(e.target.value))} className="input-field w-full" placeholder="e.g. 75.5" />
        </div>
      );
    case 'blood_pressure':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Systolic</label>
            <input type="number" value={data.systolic || ''} onChange={(e) => onChange('systolic', parseInt(e.target.value))} className="input-field w-full" placeholder="120" />
          </div>
          <div>
            <label className="text-slate-400 text-xs block mb-1">Diastolic</label>
            <input type="number" value={data.diastolic || ''} onChange={(e) => onChange('diastolic', parseInt(e.target.value))} className="input-field w-full" placeholder="80" />
          </div>
        </div>
      );
    case 'blood_glucose':
      return (
        <div>
          <label className="text-slate-400 text-xs block mb-1">Blood Glucose (mmol/L)</label>
          <input type="number" step="0.1" value={data.mmol || ''} onChange={(e) => onChange('mmol', parseFloat(e.target.value))} className="input-field w-full" placeholder="5.5" />
        </div>
      );
    case 'cholesterol':
      return (
        <div className="space-y-2">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Total (mmol/L)</label>
            <input type="number" step="0.1" value={data.total || ''} onChange={(e) => onChange('total', parseFloat(e.target.value))} className="input-field w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs block mb-1">HDL</label>
              <input type="number" step="0.1" value={data.hdl || ''} onChange={(e) => onChange('hdl', parseFloat(e.target.value))} className="input-field w-full" />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">LDL</label>
              <input type="number" step="0.1" value={data.ldl || ''} onChange={(e) => onChange('ldl', parseFloat(e.target.value))} className="input-field w-full" />
            </div>
          </div>
        </div>
      );
    case 'mood':
      return (
        <div>
          <label className="text-slate-400 text-xs block mb-1">How are you feeling?</label>
          <div className="flex gap-2 flex-wrap">
            {MOOD_OPTIONS.map((m) => (
              <button key={m} type="button" onClick={() => onChange('mood', m)}
                className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${data.mood === m ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-700/50 border-slate-600/50 text-slate-400'}`}>
                {m}
              </button>
            ))}
          </div>
          <label className="text-slate-400 text-xs block mb-1 mt-3">Notes (optional)</label>
          <textarea value={data.notes || ''} onChange={(e) => onChange('notes', e.target.value)} className="input-field w-full h-16 resize-none" placeholder="Any context..." />
        </div>
      );
    case 'energy':
      return (
        <div>
          <label className="text-slate-400 text-xs block mb-1">Energy level</label>
          <div className="flex gap-2">
            {ENERGY_OPTIONS.map((e) => (
              <button key={e} type="button" onClick={() => onChange('level', e)}
                className={`text-xs rounded-lg px-3 py-1.5 border transition-colors ${data.level === e ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-700/50 border-slate-600/50 text-slate-400'}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
      );
    case 'hydration':
      return (
        <div>
          <label className="text-slate-400 text-xs block mb-1">Water intake (litres)</label>
          <input type="number" step="0.1" value={data.litres || ''} onChange={(e) => onChange('litres', parseFloat(e.target.value))} className="input-field w-full" placeholder="2.5" />
        </div>
      );
    case 'medication':
      return (
        <div className="space-y-2">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Medication name</label>
            <input type="text" value={data.name || ''} onChange={(e) => onChange('name', e.target.value)} className="input-field w-full" />
          </div>
          <div>
            <label className="text-slate-400 text-xs block mb-1">Dosage</label>
            <input type="text" value={data.dosage || ''} onChange={(e) => onChange('dosage', e.target.value)} className="input-field w-full" placeholder="e.g. 10mg" />
          </div>
        </div>
      );
    case 'symptom':
      return (
        <div className="space-y-2">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Symptom</label>
            <input type="text" value={data.symptom || ''} onChange={(e) => onChange('symptom', e.target.value)} className="input-field w-full" placeholder="e.g. Headache" />
          </div>
          <div>
            <label className="text-slate-400 text-xs block mb-1">Severity (1-10)</label>
            <input type="number" min="1" max="10" value={data.severity || ''} onChange={(e) => onChange('severity', parseInt(e.target.value))} className="input-field w-full" />
          </div>
        </div>
      );
    case 'body_measurements':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Waist (cm)</label>
            <input type="number" step="0.1" value={data.waist || ''} onChange={(e) => onChange('waist', parseFloat(e.target.value))} className="input-field w-full" />
          </div>
          <div>
            <label className="text-slate-400 text-xs block mb-1">Body fat %</label>
            <input type="number" step="0.1" value={data.bodyFat || ''} onChange={(e) => onChange('bodyFat', parseFloat(e.target.value))} className="input-field w-full" />
          </div>
        </div>
      );
    case 'lab_result':
      return (
        <div className="space-y-2">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Test name</label>
            <input type="text" value={data.testName || ''} onChange={(e) => onChange('testName', e.target.value)} className="input-field w-full" placeholder="e.g. Vitamin D" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs block mb-1">Value</label>
              <input type="text" value={data.value || ''} onChange={(e) => onChange('value', e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">Unit</label>
              <input type="text" value={data.unit || ''} onChange={(e) => onChange('unit', e.target.value)} className="input-field w-full" placeholder="nmol/L" />
            </div>
          </div>
        </div>
      );
    case 'custom':
      return (
        <div className="space-y-2">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Title</label>
            <input type="text" value={data.title || ''} onChange={(e) => onChange('title', e.target.value)} className="input-field w-full" />
          </div>
          <div>
            <label className="text-slate-400 text-xs block mb-1">Notes</label>
            <textarea value={data.notes || ''} onChange={(e) => onChange('notes', e.target.value)} className="input-field w-full h-20 resize-none" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

function formatEntryValue(entry) {
  const d = entry.data || {};
  switch (entry.type) {
    case 'weight': return d.kg ? `${d.kg} kg` : '--';
    case 'blood_pressure': return d.systolic ? `${d.systolic}/${d.diastolic}` : '--';
    case 'blood_glucose': return d.mmol ? `${d.mmol} mmol/L` : '--';
    case 'cholesterol': return d.total ? `${d.total} mmol/L` : '--';
    case 'mood': return d.mood || '--';
    case 'energy': return d.level || '--';
    case 'hydration': return d.litres ? `${d.litres}L` : '--';
    case 'medication': return d.name ? `${d.name} ${d.dosage || ''}` : '--';
    case 'symptom': return d.symptom ? `${d.symptom} (${d.severity}/10)` : '--';
    case 'body_measurements': return [d.waist && `${d.waist}cm`, d.bodyFat && `${d.bodyFat}%`].filter(Boolean).join(', ') || '--';
    case 'lab_result': return d.testName ? `${d.testName}: ${d.value} ${d.unit || ''}` : '--';
    case 'custom': return d.title || '--';
    default: return '--';
  }
}

export default function HealthLogTab() {
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState(null);
  const { entries, loading } = useHealthLog(filterType);
  const { deleteEntry } = useHealthLogMutations();

  const typeInfo = (type) => ENTRY_TYPES.find((t) => t.value === type) || { icon: '', label: type };

  async function handleDelete(id) {
    if (!window.confirm('Delete this entry?')) return;
    try { await deleteEntry(id); } catch (err) { console.error(err); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Health Log</h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-cta-sm text-xs">
          {showForm ? 'Cancel' : '+ New Entry'}
        </button>
      </div>

      {showForm && <EntryForm onClose={() => setShowForm(false)} />}

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setFilterType(null)}
          className={`text-xs whitespace-nowrap rounded-full px-3 py-1 border transition-colors ${
            !filterType ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-slate-600 text-slate-400'
          }`}
        >
          All
        </button>
        {ENTRY_TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilterType(t.value)}
            className={`text-xs whitespace-nowrap rounded-full px-3 py-1 border transition-colors ${
              filterType === t.value ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'border-slate-600 text-slate-400'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Entry list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="glass-card h-16 animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-slate-400 text-sm">No entries yet</p>
          <p className="text-slate-500 text-xs mt-1">Tap "+ New Entry" to log your first health data point.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const info = typeInfo(entry.type);
            return (
              <div key={entry.id} className="glass-card p-3 flex items-center gap-3">
                <span className="text-lg">{info.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{info.label}</p>
                  <p className="text-slate-400 text-xs truncate">{formatEntryValue(entry)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-slate-500 text-xs">{entry.date}</p>
                  <button onClick={() => handleDelete(entry.id)} className="text-rose-400/60 hover:text-rose-400 text-xs mt-0.5 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
