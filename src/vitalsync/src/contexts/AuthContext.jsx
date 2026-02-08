// ══════════════════════════════════════════════════════
// VITALSYNC — Authentication Context
// Google Sign-In only — popup-first with redirect fallback
// ══════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/lib/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userSettings, setUserSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Handle redirect result on mount (fallback for when popup was blocked)
  useEffect(() => {
    getRedirectResult(auth).then(async (result) => {
      if (result?.user) {
        await _ensureUserSettings(result.user);
      }
    }).catch((err) => {
      // Ignore common non-error codes
      if (err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        console.error('Redirect result error:', err);
        setError(err.message);
      }
    });
  }, []);

  // Listen to auth state changes + real-time user settings
  useEffect(() => {
    let settingsUnsub = null;

    const authUnsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous settings listener
      if (settingsUnsub) {
        settingsUnsub();
        settingsUnsub = null;
      }

      if (firebaseUser) {
        setUser(firebaseUser);
        // Ensure user doc exists when auth state changes
        // (covers both popup and redirect flows)
        try {
          await _ensureUserSettings(firebaseUser);
        } catch (err) {
          console.error('Error ensuring user settings:', err);
        }
        // Real-time listener for user settings
        const settingsRef = doc(db, 'users', firebaseUser.uid);
        settingsUnsub = onSnapshot(settingsRef, (snap) => {
          if (snap.exists()) {
            setUserSettings(snap.data());
          } else {
            setUserSettings(null);
          }
          setLoading(false);
        }, (err) => {
          console.error('Error listening to user settings:', err);
          setLoading(false);
        });
      } else {
        setUser(null);
        setUserSettings(null);
        setLoading(false);
      }
    });

    return () => {
      authUnsub();
      if (settingsUnsub) settingsUnsub();
    };
  }, []);

  // Ensure user settings doc exists (only write defaults for brand-new users)
  async function _ensureUserSettings(firebaseUser) {
    const settingsRef = doc(db, 'users', firebaseUser.uid);
    // Only update profile fields (name, email, photo) on every login.
    // Default settings are only written if the fields don't exist yet,
    // by using merge:true with ONLY the profile fields.
    // The full defaults (goals, availability, etc.) are set via onboarding.
    await setDoc(settingsRef, {
      displayName: firebaseUser.displayName,
      email: firebaseUser.email,
      photoURL: firebaseUser.photoURL,
      lastLoginAt: serverTimestamp(),
    }, { merge: true });
  }

  // Google Sign-In: try popup first, fall back to redirect if blocked
  async function signInWithGoogle() {
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      // Popup succeeded — onAuthStateChanged will handle the rest.
      // The COOP warning about window.closed/window.close is cosmetic
      // and does not prevent auth from completing.
      console.log('Popup sign-in completed for:', result?.user?.email);
    } catch (err) {
      console.warn('Popup sign-in error:', err.code, err.message);
      // If popup was blocked or failed due to COOP, fall back to redirect
      if (
        err.code === 'auth/popup-blocked' ||
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/cancelled-popup-request'
      ) {
        console.log('Falling back to redirect flow');
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (redirectErr) {
          setError(redirectErr.message);
          throw redirectErr;
        }
      } else if (err.code === 'auth/internal-error') {
        // COOP-related errors sometimes manifest as internal-error
        // but the auth may have actually succeeded — give onAuthStateChanged
        // a moment to fire
        console.log('Internal error during popup — checking if auth state changed...');
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // If we're still not authenticated after 2s, show the error
        if (!auth.currentUser) {
          setError('Sign-in failed. Please try again.');
        }
      } else {
        setError(err.message);
        throw err;
      }
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
