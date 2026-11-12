import { Logo } from '@/components/brand/Logo'

/** Shown when the build has no Supabase credentials – never pretends to work. */
export function SetupRequired() {
  return (
    <div className="grid min-h-[100dvh] place-items-center p-6">
      <div className="card w-full max-w-lg p-8">
        <Logo />
        <h1 className="mt-6 text-xl font-extrabold">Connect your Supabase project</h1>
        <p className="mt-2 text-sm text-muted">LAKSHYA stores your data in your own free Supabase project. Add these to a <code className="rounded bg-surface-2 px-1">.env.local</code> file (or Vercel environment variables) and restart:</p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-surface-2 p-4 text-xs">{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_VAPID_PUBLIC_KEY=<optional, for push>`}</pre>
        <p className="mt-4 text-sm text-muted">Then run the SQL migrations in <code className="rounded bg-surface-2 px-1">supabase/migrations</code>. Full steps are in README.md.</p>
      </div>
    </div>
  )
}
