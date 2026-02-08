import { useState, lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Dashboard loads eagerly (first tab seen)
import DashboardTab from '@/components/tabs/DashboardTab';

// Lazy-load all other tabs for code splitting
const HealthLogTab = lazy(() => import('@/components/tabs/HealthLogTab'));
const TrainingTab = lazy(() => import('@/components/tabs/TrainingTab'));
const CyclingTab = lazy(() => import('@/components/tabs/CyclingTab'));
const HistoryTab = lazy(() => import('@/components/tabs/HistoryTab'));
const InsightsTab = lazy(() => import('@/components/tabs/InsightsTab'));
const SettingsTab = lazy(() => import('@/components/tabs/SettingsTab'));

const TABS = [
  { id: 'Dashboard', icon: '\u2302' },
  { id: 'Health Log', icon: '\u2764' },
  { id: 'Training', icon: '\uD83C\uDFC3' },
  { id: 'Cycling', icon: '\uD83D\uDEB4' },
  { id: 'History', icon: '\uD83D\uDCC5' },
  { id: 'Insights', icon: '\uD83D\uDCC8' },
  { id: 'Settings', icon: '\u2699' },
];

const TAB_COMPONENTS = {
  Dashboard: DashboardTab,
  'Health Log': HealthLogTab,
  Training: TrainingTab,
  Cycling: CyclingTab,
  History: HistoryTab,
  Insights: InsightsTab,
  Settings: SettingsTab,
};

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );
}

export default function AppShell() {
  const [activeTab, setActiveTab] = useState('Dashboard');
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
      <main className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-lg mx-auto px-4 py-4">
          <Suspense fallback={<TabFallback />}>
            <TabContent />
          </Suspense>
        </div>
      </main>

      {/* ── Bottom Tab Bar (scrollable for 7 tabs) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800/50 safe-area-pb">
        <div className="max-w-lg mx-auto flex overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-2 pt-2.5 transition-colors ${
                activeTab === tab.id
                  ? 'text-emerald-400'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[10px] mt-0.5 font-medium whitespace-nowrap">{tab.id}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
