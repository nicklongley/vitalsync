import { createContext, useContext, useState, useCallback } from 'react';

const NavigationContext = createContext(null);

export function NavigationProvider({ children }) {
  const [activeTab, setActiveTab] = useState('Dashboard');
  // Cross-tab intent (e.g. open Health Log on the 'mood' entry type).
  // Consumers read it once via consumeIntent() so it doesn't fire repeatedly.
  const [healthLogIntent, setHealthLogIntent] = useState(null);

  const consumeHealthLogIntent = useCallback(() => {
    if (!healthLogIntent) return null;
    const intent = healthLogIntent;
    setHealthLogIntent(null);
    return intent;
  }, [healthLogIntent]);

  const goToHealthLog = useCallback((intent = null) => {
    setHealthLogIntent(intent);
    setActiveTab('Health Log');
  }, []);

  return (
    <NavigationContext.Provider value={{
      activeTab,
      setActiveTab,
      goToHealthLog,
      consumeHealthLogIntent,
    }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
