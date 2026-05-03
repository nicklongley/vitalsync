// ══════════════════════════════════════════════════════
// VITALSYNC — intervals.icu Data Hook
// Real-time Firestore listeners + sync controls
// Reads from wellnessDaily (intervals.icu); falls back to
// historical garminDailies docs when no intervals data exists.
// ══════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import {
  doc, collection, query, orderBy, limit, onSnapshot,
  where, getDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays } from 'date-fns';

// ── Today's wellness (real-time) ──
// Listens to wellnessDaily; if missing, attempts a one-shot read of
// garminDailies for backwards-compatible display of historical data.
export function useTodayWellness() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const wellnessRef = doc(db, 'users', user.uid, 'wellnessDaily', today);

    const unsubscribe = onSnapshot(wellnessRef, async (snap) => {
      if (snap.exists()) {
        setData(snap.data());
      } else {
        // Fall back to historical Garmin doc
        try {
          const garminSnap = await getDoc(doc(db, 'users', user.uid, 'garminDailies', today));
          setData(garminSnap.exists() ? garminSnap.data() : null);
        } catch {
          setData(null);
        }
      }
      setLoading(false);
    }, (err) => {
      console.error('Error listening to wellnessDaily:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  return { data, loading };
}

// ── Week of wellness data ──
// Listens to 7 days of wellnessDaily; merges in historical garminDailies
// for any missing days so charts stay populated during transition.
export function useWeekWellness() {
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      days.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
    }

    const unsubs = days.map((dateStr, idx) => {
      const ref = doc(db, 'users', user.uid, 'wellnessDaily', dateStr);
      return onSnapshot(ref, async (snap) => {
        let entry;
        if (snap.exists()) {
          entry = { date: dateStr, ...snap.data() };
        } else {
          try {
            const garminSnap = await getDoc(doc(db, 'users', user.uid, 'garminDailies', dateStr));
            entry = garminSnap.exists()
              ? { date: dateStr, ...garminSnap.data(), _legacyGarmin: true }
              : { date: dateStr };
          } catch {
            entry = { date: dateStr };
          }
        }
        setData((prev) => {
          const next = [...prev];
          next[idx] = entry;
          return next;
        });
        setLoading(false);
      }, (err) => {
        console.error(`Error listening to wellnessDaily/${dateStr}:`, err);
      });
    });

    setData(days.map((dateStr) => ({ date: dateStr })));

    return () => unsubs.forEach((unsub) => unsub());
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
      orderBy('startTimeLocal', 'desc'),
      limit(count)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setActivities(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error('Error listening to activities:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, count]);

  return { activities, loading };
}

// ── intervals.icu sync status + controls (real-time) ──
export function useIntervalsSync() {
  const { user, userSettings } = useAuth();
  const [syncing, setSyncing] = useState(false);

  const intervals = userSettings?.intervals || {};
  const connected = intervals.connected || false;
  const needsReauth = intervals.needs_reauth || false;
  const backfillStatus = intervals.backfillStatus || 'idle';
  const backfillProgress = intervals.backfillProgress || 0;
  const lastSyncAt = intervals.last_sync_at?.toDate?.() || null;
  const displayName = intervals.displayName || '';

  async function syncNow() {
    if (!user || !connected || syncing) return;
    setSyncing(true);
    try {
      const fn = httpsCallable(functions, 'intervals_sync_on_demand');
      await fn();
    } catch (err) {
      console.error('intervals.icu sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function connectIntervals(apiKey) {
    if (!user) throw new Error('Must be signed in');
    const fn = httpsCallable(functions, 'intervals_set_api_key');
    return fn({ api_key: apiKey });
  }

  async function disconnectIntervals() {
    if (!user) throw new Error('Must be signed in');
    const fn = httpsCallable(functions, 'intervals_disconnect');
    return fn();
  }

  async function backfillHistory(days = 365) {
    if (!user || !connected) return null;
    const fn = httpsCallable(functions, 'intervals_backfill');
    return fn({ days });
  }

  async function pushPlan(planId) {
    if (!user || !connected) throw new Error('Connect intervals.icu first');
    const fn = httpsCallable(functions, 'intervals_push_plan');
    return fn({ planId });
  }

  async function getActivityStreams(intervalsId, types) {
    if (!user || !connected) throw new Error('Connect intervals.icu first');
    const fn = httpsCallable(functions, 'intervals_get_activity_streams');
    return fn({ intervalsId, types });
  }

  async function computeStats() {
    if (!user) return null;
    const fn = httpsCallable(functions, 'compute_stats_on_demand');
    return fn();
  }

  return {
    connected,
    needsReauth,
    backfillStatus,
    backfillProgress,
    lastSyncAt,
    displayName,
    syncing,
    syncNow,
    connectIntervals,
    disconnectIntervals,
    backfillHistory,
    pushPlan,
    getActivityStreams,
    computeStats,
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
    }, (err) => {
      console.error('Error listening to healthLog:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, type, count]);

  return { entries, loading };
}

// ── Weight history (intervals.icu wellness, with garminDailies fallback) ──
export function useWeightHistory(days = 30) {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const dateKeys = [];
    for (let i = 0; i < days; i++) {
      dateKeys.push(format(subDays(new Date(), i), 'yyyy-MM-dd'));
    }

    const unsubs = dateKeys.map((dateStr, idx) => {
      const ref = doc(db, 'users', user.uid, 'wellnessDaily', dateStr);
      return onSnapshot(ref, async (snap) => {
        let result = null;
        if (snap.exists()) {
          const d = snap.data();
          if (d?.weight) {
            result = {
              date: dateStr,
              value: Math.round(d.weight * 10) / 10,
              unit: 'kg',
              bodyFat: d.bodyFat || null,
              source: 'intervals',
            };
          }
        } else {
          // Fall back to historical Garmin bodyComp
          try {
            const garminSnap = await getDoc(doc(db, 'users', user.uid, 'garminDailies', dateStr));
            const wList = garminSnap.exists() ? garminSnap.data()?.bodyComp?.dateWeightList : null;
            if (Array.isArray(wList) && wList.length > 0) {
              const latest = wList[wList.length - 1];
              const weightKg = latest?.weight ? Math.round(latest.weight / 100) / 10 : null;
              if (weightKg) {
                result = {
                  date: dateStr,
                  value: weightKg,
                  unit: 'kg',
                  bodyFat: latest?.bodyFat || null,
                  muscleMass: latest?.muscleMass ? Math.round(latest.muscleMass / 100) / 10 : null,
                  bmi: latest?.bmi || null,
                  source: 'garmin',
                };
              }
            }
          } catch {}
        }
        setEntries((prev) => {
          const next = [...prev];
          next[idx] = result;
          return next;
        });
        setLoading(false);
      }, (err) => {
        console.error(`Error listening to wellnessDaily/${dateStr} for weight:`, err);
      });
    });

    setEntries(new Array(days).fill(null));

    return () => unsubs.forEach((unsub) => unsub());
  }, [user, days]);

  const filtered = entries.filter(Boolean);
  return { entries: filtered, loading };
}

// ── Activity stats (aggregated periods) ──
export function useActivityStats(periodType = 'week', count = 52) {
  const { user } = useAuth();
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'activityStats'),
      where('periodType', '==', periodType),
      orderBy('periodStart', 'desc'),
      limit(count),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setStats(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => {
      console.error('Error listening to activityStats:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, periodType, count]);

  return { stats, loading };
}
