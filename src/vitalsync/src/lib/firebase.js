// ══════════════════════════════════════════════════════
// VITALSYNC — Firebase Configuration
// ══════════════════════════════════════════════════════
// 
// SETUP: Replace the firebaseConfig values below with your
// Firebase project credentials from the Firebase Console:
//   → Project Settings → General → Your Apps → Web App
//
// For local development with emulators, the connectEmulators()
// function auto-connects when VITE_USE_EMULATORS=true
// ══════════════════════════════════════════════════════

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// ── Firebase Project Config ──
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAPrQK1NJ9Ts0uJamhYo06WpcyU4slBOFM',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'vitalsync-7e04b.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'vitalsync-7e04b',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'vitalsync-7e04b.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '458815174396',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:458815174396:web:2833e9593f8fc267bcc979',
};

// ── Initialise Firebase ──
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'europe-west2'); // London region

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ── Emulator Connection (development only) ──
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectFunctionsEmulator(functions, 'localhost', 5001);
  console.log('🔧 Connected to Firebase emulators');
}

export default app;
