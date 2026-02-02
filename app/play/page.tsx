import TopNav from "../components/TopNav";

export default function PlayPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h1 className="text-2xl font-bold">Play</h1>
          <p className="mt-2 text-neutral-300">
            Demo Mode UI will go here: route selection (Safe/Wild/Insane), bet
            amount, risk table per hop, and HOP / CASH OUT controls.
          </p>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            Next: we’ll build the 10-hop panel + per-hop risk display (static
            first).
          </div>
        </div>
      </section>
    </main>
  );
}
