import TopNav from "../components/TopNav";
import { CHAIN_LIST, PRIMARY_CHAIN } from "../lib/chains";

function ChainIcon({ chainKey, alt }: { chainKey: string; alt: string }) {
  // expects:
  // /public/chains/linea.png
  // /public/chains/base.png
  const src = `/chains/${chainKey}.png`;

  return (
    <img
      src={src}
      alt={alt}
      width={28}
      height={28}
      className="h-7 w-7 rounded-lg ring-1 ring-neutral-800"
      loading="lazy"
    />
  );
}

export default function SwapPage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <TopNav />

      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Swap</h1>
              <p className="mt-2 text-neutral-300">
                Choose a chain to trade DTC. Linea is primary. Base is coming
                soon.
              </p>
            </div>

            <div className="text-sm text-neutral-400">
              Primary:{" "}
              <span className="text-neutral-100">{PRIMARY_CHAIN.name}</span>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {CHAIN_LIST.map((c) => (
              <div
                key={c.key}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    {/* Title row: ICON + NAME + TAGS */}
                    <div className="flex items-center gap-3">
                      <ChainIcon chainKey={c.key} alt={`${c.name} icon`} />

                      <div className="flex items-center gap-2">
                        <div className="text-lg font-semibold">{c.name}</div>

                        <span
                          className={
                            c.statusTag === "LIVE"
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20"
                              : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/20"
                          }
                        >
                          {c.statusTag}
                        </span>

                        {c.isPrimary ? (
                          <span className="rounded-full bg-neutral-800/60 px-2 py-0.5 text-xs text-neutral-200 ring-1 ring-neutral-700">
                            PRIMARY
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 text-sm text-neutral-200">
                      {c.swapLabel}
                    </div>
                    <div className="mt-2 text-sm text-neutral-300">{c.note}</div>

                    <div className="mt-3 text-xs text-neutral-500">
                      Chain ID: {c.chainId}
                      {c.explorerBaseUrl ? (
                        <>
                          {" "}
                          • Explorer:{" "}
                          <span className="text-neutral-300">
                            {c.explorerBaseUrl.replace("https://", "")}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {c.enabled && c.swapUrl ? (
                      <a
                        href={c.swapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl bg-emerald-500 px-4 py-2 text-center text-sm font-semibold text-neutral-950 hover:bg-emerald-400"
                      >
                        Open Swap
                      </a>
                    ) : (
                      <button
                        disabled
                        className="cursor-not-allowed rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-neutral-500"
                      >
                        Swap (soon)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
            <b>Note:</b> Chain switching + wallet connect will be enabled after
            Base Uniswap listing and when the bridge is public.
          </div>
        </div>
      </section>
    </main>
  );
}
