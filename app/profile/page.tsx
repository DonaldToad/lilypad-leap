import TopNav from "../components/TopNav";

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="mt-2 text-neutral-300">
            Demo Mode placeholder. Later: stats, claims (daily rewards + referral),
            and recent activity.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm text-neutral-400">Total Games</div>
              <div className="mt-1 text-xl font-semibold">—</div>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-sm text-neutral-400">Net Profit</div>
              <div className="mt-1 text-xl font-semibold">—</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
