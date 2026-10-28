"use client";

import { Suspense, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  RecentlyViewedRail,
  useRecentlyViewed,
} from "./components/recently-viewed-rail";
import { PanelShell } from "@/components/dashboard/panel-shell";
import { MarketplaceGridSkeleton } from "@/components/dashboard/marketplace-grid-skeleton";
import {
  ResultsPerPageSelector,
  usePageSize,
} from "@/components/marketplace/results-per-page-selector";
import { buildCatalogue, seedItems } from "./catalogue";

// ─── Pagination helpers (exported for tests) ────────────────────────────────

/**
 * Read the `page` search-param. Returns a positive integer, or `null` when the
 * param is absent or malformed so bad deep links fall back to page 1 instead of
 * producing a hostile 0 / NaN offset.
 */
export function parsePageParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!/^\d+$/.test(raw)) return null;
  const page = Number(raw);
  if (!Number.isFinite(page) || page < 1) return null;
  return Math.floor(page);
}

/** Clamp `page` into the valid range `[1, pageCount]` (`pageCount` >= 1). */
export function clampPage(page: number, pageCount: number): number {
  const total = Math.max(1, Math.floor(pageCount));
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.floor(page), 1), total);
}

/** Build `pathname?<params>` keeping every current param except `page`. */
function withPageParam(pathname: string, search: string, page: number): string {
  const params = new URLSearchParams(search);
  params.set("page", String(page));
  return `${pathname}?${params.toString()}`;
}

// ─── Grid ───────────────────────────────────────────────────────────────────

function MarketplaceGrid() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { value: pageSize, setValue } = usePageSize();
  const { addItem } = useRecentlyViewed();
  const catalogue = useMemo(() => buildCatalogue(), []);

  const total = catalogue.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const requestedPage = parsePageParam(searchParams.get("page"));
  const page = clampPage(requestedPage ?? 1, pageCount);

  const startIndex = (page - 1) * pageSize;
  const visible = catalogue.slice(startIndex, startIndex + pageSize);
  const rangeStart = total === 0 ? 0 : startIndex + 1;
  const rangeEnd = startIndex + visible.length;

  // Out-of-range deep links (e.g. `?page-size=12&page=99`) are clamped in the
  // URL itself so the address bar stays shareable. Normalising only — a URL
  // that already carries a valid page never writes back.
  useEffect(() => {
    if (requestedPage === null || requestedPage === page) return;
    router.replace(withPageParam(pathname, searchParams.toString(), page), {
      scroll: false,
    });
  }, [requestedPage, page, pathname, searchParams, router]);

  const goToPage = (next: number) => {
    const target = clampPage(next, pageCount);
    if (target === page) return;
    // `page-size` and any other params survive the navigation.
    router.push(withPageParam(pathname, searchParams.toString(), target));
  };

  return (
    <PanelShell
      title="Marketplace"
      description="Browse and book time slots from suppliers worldwide"
    >
      <ol
        className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        data-testid="marketplace-grid"
        aria-label="Marketplace search results"
      >
        {visible.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              onClick={() => addItem({ ...item, href: `/marketplace/${item.id}` })}
              className="card card--interactive group flex h-full flex-col"
            >
              {item.image ? (
                <div
                  className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-zinc-800"
                  aria-hidden="true"
                >
                  <Image
                    src={item.image}
                    alt=""
                    fill
                    sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                </div>
              ) : (
                <div
                  className="flex aspect-video w-full items-center justify-center rounded-t-lg bg-gradient-to-br from-slate-900 to-slate-800 text-sm font-medium uppercase tracking-[0.18em] text-slate-500"
                  aria-hidden="true"
                >
                  Demo
                </div>
              )}
              <div className="p-4">
                <h3 className="line-clamp-2 text-base font-medium text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-400">{item.price}</p>
              </div>
            </Link>
          </li>
        ))}
      </ol>

      {/* Results summary (polite live region) + Previous / Next pagination.
          Both are derived from the URL so pages are deep-linkable. */}
      <div className="mt-6 flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p
          data-testid="marketplace-results-summary"
          aria-live="polite"
          className="text-sm text-zinc-400 tabular-nums"
        >
          {`Showing ${rangeStart}–${rangeEnd} of ${total}`}
        </p>
        <nav
          aria-label="Marketplace pagination"
          className="flex items-center gap-3"
        >
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-400 tabular-nums">
            {`Page ${page} of ${pageCount}`}
          </span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= pageCount}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      </div>

      {/* Per-page selector lives at the bottom of the results.
          It owns a single source of truth via `usePageSize`, so the page
          size, the page count and the visible slice all stay in sync. */}
      <div className="mt-5 border-t border-white/10 pt-5">
        <ResultsPerPageSelector
          value={pageSize}
          onChange={setValue}
          totalCount={total}
        />
      </div>
    </PanelShell>
  );
}

export default function Marketplace() {
  const { addItem } = useRecentlyViewed();

  // Populate recently-viewed rail on first visit.
  useEffect(() => {
    const hasVisited = localStorage.getItem("chronopay-marketplace-visited");
    if (!hasVisited) {
      seedItems.forEach((item, index) => {
        setTimeout(() => {
          addItem(item);
        }, index * 100);
      });
      localStorage.setItem("chronopay-marketplace-visited", "true");
    }
  }, [addItem]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <main
        id="main-content"
        className="mx-auto max-w-6xl px-5 py-8 sm:px-6 md:py-12"
      >
        <RecentlyViewedRail />

        <div className="mt-8">
          {/* `<Suspense>` is required because the grid reads the URL via
              `useSearchParams`. The skeleton fallback means the server
              rendered HTML shows real content instead of an empty
              container while hydration catches up. */}
          <Suspense fallback={<MarketplaceGridSkeleton />}>
            <MarketplaceGrid />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
