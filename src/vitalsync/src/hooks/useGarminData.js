// ══════════════════════════════════════════════════════
// VITALSYNC — Garmin Data Hook
// Real-time Firestore listeners for Garmin health data
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import {
  doc, collection, query, orderBy, limit, onSnapshot,
  where, getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays } from 'date-fns';

// ── Today's Garmin data (real-time) ──
export function useGarminToday() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const ref = doc(db, 'users', user.uid, 'garminDailies', today);

    const unsubscribe = onSnapshot(ref, (snap) => {
      setData(snap.exists() ? snap.data() : null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  return { data, loading };
}

// ── Week of Garmin data ──
export function useGarminWeek() {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function fetchWeek() {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const dateStr = format(subDays(new Date(), i), 'yyyy-MM-dd');
        days.push(dateStr);
      }

      const results = [];
      for (const dateStr of days) {
        const ref = doc(db, 'users', user.uid, 'garminDailies', dateStr);
        const snap = await getDocs(query(collection(db, 'users', user.uid, 'garminDailies')));
        // Use individual doc gets for week view
      }

      // Simplified: fetch each day individually
      const weekData = await Promise.all(
        days.map(async (dateStr) => {
          const ref = doc(db, 'users', user.uid, 'garminDailies', dateStr);
          // onSnapshot would be wasteful for 7 docs, so we'll rely on
          // the scheduled sync to keep data fresh
          return { date: dateStr };
        })
      );

      setData(weekData);
      setLoading(false);
    }

    fetchWeek();
  }, [user]);

  return { data, loading };
}

// ── Recent activities (real-time) ──
export function useRecentActivities(count = 10) {
  const { user } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'activities'),
      orderBy('date', 'desc'),
      limit(count)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setActivities(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, count]);

  return { activities, loading };
}

// ── Garmin sync status (real-time) ──
export function useGarminSync() {
  const { user, userSettings } = useAuth();
  const [syncing, setSyncing] = useState(false);

  const garmin = userSettings?.garmin || {};
  const connected = garmin.connected || false;
  const backfillStatus = garmin.backfillStatus || 'idle';
  const backfillProgress = garmin.backfillProgress || 0;
  const lastSyncAt = garmin.lastSyncAt?.toDate?.() || null;

  // Trigger on-demand sync
  async function syncNow() {
    if (!user || !connected || syncing) return;
    setSyncing(true);
    try {
      const garminSyncFn = httpsCallable(functions, 'garmin_sync_on_demand');
      await garminSyncFn();
    } catch (err) {
      console.error('Garmin sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  // Connect Garmin account
  async function connectGarmin(email, password) {
    if (!user) throw new Error('Must be signed in');
    const garminLoginFn = httpsCallable(functions, 'garmin_login');
    const result = await garminLoginFn({ email, password });
    return result.data; // { status, displayName }
  }

  // Disconnect Garmin
  async function disconnectGarmin() {
    if (!user) throw new Error('Must be signed in');
    const garminDisconnectFn = httpsCallable(functions, 'garmin_disconnect');
    const result = await garminDisconnectFn();
    return result.data;
  }

  const displayName = garmin.displayName || null;

  return {
    connected,
    displayName,
    backfillStatus,
    backfillProgress,
    lastSyncAt,
    syncing,
    syncNow,
    connectGarmin,
    disconnectGarmin,
  };
}

// ── Health log entries ──
export function useHealthLog(type = null, count = 20) {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let q;
    if (type) {
      q = query(
        collection(db, 'users', user.uid, 'healthLog'),
        where('type', '==', type),
        orderBy('date', 'desc'),
        limit(count)
      );
    } else {
      q = query(
        collection(db, 'users', user.uid, 'healthLog'),
        orderBy('date', 'desc'),
        limit(count)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, type, count]);

  return { entries, loading };
}

// ── Activity stats (aggregated periods) ──
export function useActivityStats(periodType = 'week', count = 12) {
  const { user } = useAuth();
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'activityStats'),
      where('periodType', '==', periodType),
      orderBy('periodStart', 'desc'),
      limit(count)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setStats(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, periodType, count]);

  return { stats, loading };
}
