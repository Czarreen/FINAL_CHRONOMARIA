import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function LoginView({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!username.trim()) { setError('Username is required'); return; }
    if (!password) { setError('Password is required'); return; }
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Login failed');
      }

      onLogin(payload.user, payload.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-mesh px-4 py-6 text-on-surface md:px-8 md:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-white/50 bg-white/60 shadow-[0_30px_80px_rgba(75,42,184,0.12)] backdrop-blur-[24px] lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-primary px-8 py-10 text-white md:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(202,190,255,0.35),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(155,233,253,0.25),transparent_38%)]" />
          <div className="relative z-10 flex flex-col items-center justify-center h-full gap-6">
            <div className="rounded-lg bg-white p-1 ring-1 ring-white/20">
              <img src="/logo.png" alt="Logo" className="max-w-sm w-full" />
            </div>
            <p className="mt-5 max-w-sm text-center text-2xl leading-8 text-white md:text-3xl" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif' }}>
              Web-based faculty loading automation system for Saint Mary's University
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 md:px-10">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-[1.75rem] border border-white/60 bg-white/80 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-on-surface-variant/60">Welcome back</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-on-surface">Log in to Chronomaria</h2>
              <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                Use your faculty loading credentials to enter the dashboard.
              </p>
            </div>

            {error && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter Username"
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Password</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter Password"
                    className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 pr-10 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}