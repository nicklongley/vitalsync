// ══════════════════════════════════════════════════════
// VITALSYNC — Authentication Context
// Google Sign-In only, no email/password
// ══════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect } from 'react';
import {
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
    const userRef = doc(db, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      setUserSettings(userSnap.data());
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

    await setDoc(userRef, initialSettings);
    setUserSettings(initialSettings);
    return { isNewUser: true };
  }

  // Handle redirect result (Google Sign-In uses redirect flow)
  useEffect(() => {
    getRedirectResult(auth).then((result) => {
      if (result?.user) {
        loadOrCreateSettings(result.user);
      }
    }).catch((err) => {
      console.error('Redirect sign-in error:', err);
      setError(err.message);
    });
  }, []);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            setUserSettings(userSnap.data());
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

  // Google Sign-In (redirect flow — required for Firebase Hosting COOP)
  async function signInWithGoogle() {
    setError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      console.error('Sign-in failed:', err);
      setError(err.message);
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
