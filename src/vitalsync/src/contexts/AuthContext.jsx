// ══════════════════════════════════════════════════════
// VITALSYNC — Authentication Context
// Google Sign-In only, no email/password
// ══════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/lib/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userSettings, setUserSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Helper: load or create user settings after sign-in
  async function loadOrCreateSettings(firebaseUser) {
    const settingsRef = doc(db, 'users', firebaseUser.uid, 'settings');
    const settingsSnap = await getDoc(settingsRef);

    if (settingsSnap.exists()) {
      setUserSettings(settingsSnap.data());
      return { isNewUser: false };
    }

    // Create initial user document
    const initialSettings = {
      displayName: firebaseUser.displayName,
      email: firebaseUser.email,
      photoURL: firebaseUser.photoURL,
      createdAt: serverTimestamp(),
      onboardingComplete: false,
      garmin: {
        connected: false,
        backfillStatus: 'idle',
        backfillProgress: 0,
      },
      goals: {
        primaryGoal: null,
        secondaryGoals: [],
      },
      availability: {
        totalHoursPerWeek: 9,
        maxSingleSessionHours: 3,
        preferredRestDaysPerWeek: 1,
        schedule: {
          mon: { slot: 'morning', durationHours: 1.5 },
          tue: { slot: 'evening', durationHours: 1.5 },
          wed: { slot: 'morning', durationHours: 1.5 },
          thu: { slot: 'rest', durationHours: 0 },
          fri: { slot: 'evening', durationHours: 1.5 },
          sat: { slot: 'morning', durationHours: 2 },
          sun: { slot: 'morning', durationHours: 1.5 },
        },
        sportPriorities: [
          { sport: 'cycling', weeklyHours: 5.25, percentage: 60 },
          { sport: 'running', weeklyHours: 3, percentage: 33 },
          { sport: 'strength', weeklyHours: 0.75, percentage: 7 },
        ],
      },
      preferences: {
        units: 'metric',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notificationsEnabled: true,
        interventionFrequency: 'daily',
        aiPersonality: 'coach',
      },
    };

    await setDoc(settingsRef, initialSettings);
    setUserSettings(initialSettings);
    return { isNewUser: true };
  }

  // Handle redirect result (for environments where popups are blocked)
  useEffect(() => {
    getRedirectResult(auth).then((result) => {
      if (result?.user) {
        loadOrCreateSettings(result.user);
      }
    }).catch((err) => {
      console.error('Redirect sign-in error:', err);
    });
  }, []);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const settingsRef = doc(db, 'users', firebaseUser.uid, 'settings');
          const settingsSnap = await getDoc(settingsRef);
          if (settingsSnap.exists()) {
            setUserSettings(settingsSnap.data());
          }
        } catch (err) {
          console.error('Error loading user settings:', err);
        }
      } else {
        setUser(null);
        setUserSettings(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Google Sign-In (popup with redirect fallback)
  async function signInWithGoogle() {
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return await loadOrCreateSettings(result.user);
    } catch (err) {
      // If popup blocked (common in iframes/Studio), fall back to redirect
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider);
        return { isNewUser: false }; // Will resolve after redirect
      }
      setError(err.message);
      throw err;
    }
  }

  // Sign out
  async function signOut() {
    await firebaseSignOut(auth);
    setUser(null);
    setUserSettings(null);
  }

  const value = {
    user,
    userSettings,
    setUserSettings,
    loading,
    error,
    signInWithGoogle,
    signOut,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
