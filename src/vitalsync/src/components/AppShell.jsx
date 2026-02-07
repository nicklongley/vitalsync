import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Tab content components (lazy placeholders for now)
import DashboardTab from '@/components/tabs/DashboardTab';
import HealthLogTab from '@/components/tabs/HealthLogTab';
import TrainingTab from '@/components/tabs/TrainingTab';
import InsightsTab from '@/components/tabs/InsightsTab';
import SettingsTab from '@/components/tabs/SettingsTab';

const TABS = [
  { id: 'dashboard', label: 'Today', icon: '\u2302' },      // ⌂
  { id: 'health', label: 'Health', icon: '\u2764' },         // ❤
  { id: 'training', label: 'Training', icon: '\uD83C\uDFC3' }, // 🏃
  { id: 'insights', label: 'Insights', icon: '\uD83D\uDCC8' }, // 📈
  { id: 'settings', label: 'Settings', icon: '\u2699' },     // ⚙
];

const TAB_COMPONENTS = {
  dashboard: DashboardTab,
  health: HealthLogTab,
  training: TrainingTab,
  insights: InsightsTab,
  settings: SettingsTab,
};

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { user } = useAuth();

  const TabContent = TAB_COMPONENTS[activeTab];

  return (
    <div className="min-h-screen bg-midnight flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-midnight/80 backdrop-blur-xl border-b border-slate-800/50 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-white tracking-tight">
            Vital<span className="text-emerald-400">Sync</span>
          </h1>
          <div className="flex items-center gap-2">
            {user?.photoURL && (
              <img
                src={user.photoURL}
                alt=""
                className="w-7 h-7 rounded-full border border-slate-700"
              />
            )}
          </div>
        </div>
      </header>

      {/* ── Tab Content ── */}
      <main className="flex-1 overflow-y-auto pb-20">
        <div className="max-w-lg mx-auto px-4 py-4">
          <TabContent />
        </div>
      </main>

      {/* ── Bottom Tab Bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800/50 safe-area-pb">
        <div className="max-w-lg mx-auto flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center py-2 pt-2.5 transition-colors ${
                activeTab === tab.id
                  ? 'text-emerald-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[10px] mt-0.5 font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
