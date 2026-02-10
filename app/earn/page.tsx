"use client";

import TopNav from "../components/TopNav";

export default function EarnPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <h1 className="text-2xl font-bold">EARN</h1>
          <p className="mt-2 text-neutral-300">
            Referral rewards are coming soon. This page is a placeholder until the system is live.
          </p>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            When it launches, you’ll be able to generate a referral link and track rewards here.
          </div>
        </div>
      </section>
    </main>
  );
}
