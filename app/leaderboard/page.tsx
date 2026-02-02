import TopNav from "../components/TopNav";

export default function LeaderboardPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="mt-2 text-neutral-300">
            Placeholder. Later: tabs for Players/Revenue → Volumes/Top Wins/Profits
            with Daily/Weekly/Monthly/All Time (UTC) and winners-only profit filters.
          </p>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            Next: we’ll create the exact tab layout (static data first).
          </div>
        </div>
      </section>
    </main>
  );
}
