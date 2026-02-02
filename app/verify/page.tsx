import TopNav from "../components/TopNav";

export default function VerifyPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h1 className="text-2xl font-bold">Verify Fairness</h1>
          <p className="mt-2 text-neutral-300">
            Placeholder. Later: commit–reveal verifier inputs (game hash + reveal),
            computed RNG values, hop-by-hop results, and final outcome.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <label className="text-sm text-neutral-400">Game Hash</label>
              <input
                className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                placeholder="0x..."
              />
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <label className="text-sm text-neutral-400">Reveal / Seed</label>
              <input
                className="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none"
                placeholder="0x..."
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
