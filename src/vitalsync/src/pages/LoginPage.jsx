import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const { signInWithGoogle, error, isAuthenticated, loading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  // Redirect to home if already authenticated
  if (loading) {
    return (
      <div className="min-h-screen bg-midnight flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (isAuthenticated) return <Navigate to="/" replace />;

  async function handleSignIn() {
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // signInWithPopup resolves on success.
      // onAuthStateChanged in AuthContext handles navigation.
      // The popup may not auto-close due to COOP headers — that's OK.
    } catch (err) {
      console.error('Sign-in failed:', err);
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="min-h-screen bg-midnight flex flex-col items-center justify-center px-6">
      {/* Logo & tagline */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold text-white mb-2 tracking-tight">
          Vital<span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Sync</span>
        </h1>
        <p className="text-slate-400 text-lg">Your body. Your data. Your edge.</p>
      </div>

      {/* Sign-in card */}
      <div className="glass-card p-8 w-full max-w-sm text-center">
        <p className="text-slate-300 text-sm mb-6">
          Sign in to connect your Garmin, track your health, and get AI-powered training insights.
        </p>

        <button
          onClick={handleSignIn}
          disabled={signingIn}
          className="w-full flex items-center justify-center gap-3 bg-white text-slate-800 font-medium
                     rounded-xl px-6 py-3.5 transition-all duration-200
                     hover:bg-slate-100 hover:shadow-lg active:scale-[0.98]
                     disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {signingIn ? (
            <>
              <div className="w-5 h-5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {error && (
          <p className="mt-4 text-rose-400 text-sm">{error}</p>
        )}
      </div>

      {/* Footer */}
      <p className="mt-8 text-slate-500 text-xs">
        By signing in, you agree to our Terms of Service and Privacy Policy.
      </p>
    </div>
  );
}
