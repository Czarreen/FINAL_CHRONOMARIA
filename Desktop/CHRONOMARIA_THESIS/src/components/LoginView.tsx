interface LoginViewProps {
  onLogin: () => void;
}

export default function LoginView({ onLogin }: LoginViewProps) {
  return (
    <div className="min-h-screen bg-mesh px-4 py-6 text-on-surface md:px-8 md:py-10">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-white/50 bg-white/60 shadow-[0_30px_80px_rgba(75,42,184,0.12)] backdrop-blur-[24px] lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-primary px-8 py-10 text-white md:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(202,190,255,0.35),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(155,233,253,0.25),transparent_38%)]" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                schedule
              </span>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-white/70">Chronomaria</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">Faculty Loading</h1>
            </div>
          </div>

          <div className="relative z-10 max-w-md py-16">
            <p className="text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
              Base UI for faculty scheduling, designed to feel calm and precise.
            </p>
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/75 md:text-base">
              Sign in to access the dashboard shell, faculty tools, room management, and schedule workspace.
            </p>
          </div>

          <div className="relative z-10 grid grid-cols-2 gap-3 text-sm text-white/80">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">Status</p>
              <p className="mt-2 text-lg font-semibold text-white">Ready</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">Mode</p>
              <p className="mt-2 text-lg font-semibold text-white">Dashboard Preview</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10 md:px-10">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onLogin();
            }}
            className="w-full max-w-md rounded-[1.75rem] border border-white/60 bg-white/80 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-on-surface-variant/60">Welcome back</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-on-surface">Log in to Chronomaria</h2>
              <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                Use your faculty loading credentials to enter the dashboard.
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Username</span>
                <input
                  type="text"
                  defaultValue="admin"
                  placeholder="admin"
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Password</span>
                <input
                  type="password"
                  defaultValue="admin"
                  placeholder="admin"
                  className="w-full rounded-2xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </label>

              <button
                type="submit"
                className="mt-2 flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90"
              >
                Sign in
              </button>
            </div>

            <p className="mt-6 text-center text-xs leading-5 text-on-surface-variant/70">
              This is a base UI login frame. Authentication can be connected later.
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}