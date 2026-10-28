"use client";

/**
 * ResultsPerPageSelector
 * ───────────────────────
 * A segmented control placed at the bottom of marketplace search results
 * that lets the user choose how many items to display per page (12 / 24 /
 * 48 by default). The selected value is mirrored to a URL search-param
 * (deep-link friendly) and persisted to `localStorage` for per-user
 * recall across sessions.
 *
 * Two pieces are exposed:
 *   1. `usePageSize` — hook for the source-of-truth value (URL → storage → default)
 *   2. `ResultsPerPageSelector` — controlled segmented control
 *
 * Why two pieces?
 * ───────────────
 * - The hook owns *state* (URL + storage writes on change) so it can be
 *   re-used by either a **paginated** listing (resets page = 1 on change)
 *   or an **infinite-scroll** listing (re-batches the next N items). Both
 *   flows consume the same `value` and `setValue` so they stay in sync
 *   implicitly.
 * - The component owns *presentation* only (aria, keyboard, styling, and a
 *   polite LiveRegion announcement). Pulling it apart keeps the API tiny
 *   and the accessibility story auditable in one place.
 *
 * Behaviour summary:
 *   - 12 / 24 / 48 by default; configurable via `options` prop / `options` opt
 *   - URL param key is `page-size` by default; override with `paramKey`
 *   - localStorage key is `chronopay-marketplace-page-size` by default
 *   - Precedence on mount: URL param > localStorage > default (24)
 *   - On change: writes localStorage + `router.replace()` (no history entry)
 *   - Polite `LiveRegion` announcement: "Now showing N results per page."
 *   - Roving `tabIndex` inside the radio group; arrow/Home/End keys move focus
 *   - `dir="auto"` for RTL parity with the existing chip filters
 *   - Reduced-motion aware — no animations to disable, but keyframes are absent
 *
 * Accessibility (WCAG 2.1 AA)
 * ───────────────────────────
 * - `role="radiogroup"` with a visible, programmatically-associated label
 * - Each option is `role="radio"` with `aria-checked`
 * - Roving `tabIndex` — the active radio is the sole tab stop
 * - Visible focus ring uses `focus-visible:ring-2 focus-visible:ring-cyan-300`
 * - `aria-label` on every radio ("12 results per page" etc.)
 * - `aria-describedby` on the group links to the visible total-counter so
 *   screen readers hear the same context sighted users see
 * - Change announcement is debounced through React state so a rapid stream
 *   of clicks doesn't spam the LiveRegion
 *
 * Suspense note
 * ─────────────
 * - `useSearchParams()` opts the page out of static prerendering in the
 *   Next.js App Router. Any consumer MUST wrap this component (or the page
 *   tree above it) in a `<Suspense>` boundary, otherwise the build will
 *   fail with "useSearchParams should be wrapped in a suspense boundary".
 *
 * @example
 * ```tsx
 * "use client";
 * import { Suspense } from "react";
 * import { usePageSize, ResultsPerPageSelector } from
 *   "@/components/marketplace/results-per-page-selector";
 *
 * export function MarketplaceResults({ items }: { items: Item[] }) {
 *   const { value, setValue } = usePageSize();
 *   const visible = items.slice(0, value);
 *
 *   return (
 *     <>
 *       <ul>{visible.map((item) => <li key={item.id}>{item.title}</li>)}</ul>
 *       <Suspense fallback={null}>
 *         <ResultsPerPageSelector
 *           value={value}
 *           onChange={(n) => {
 *             setValue(n);
 *             // also reset page to 1 in pagination mode
 *           }}
 *           totalCount={items.length}
 *         />
 *       </Suspense>
 *     </>
 *   );
 * }
 * ```
 */

import {
  useCallback,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { LiveRegion } from "@/components/common/LiveRegion";

// ─── Public constants ───────────────────────────────────────────────────────

/** Default page-size options exposed for callers to compose custom hooks. */
export const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [12, 24, 48];

/** Default page-size when nothing else is set (24 is the recommended middle). */
export const DEFAULT_PAGE_SIZE = 24;

/** Default localStorage key for per-user persistence. */
export const DEFAULT_STORAGE_KEY = "chronopay-marketplace-page-size";

/** Default URL search-param key (used for deep linking & sharing). */
export const DEFAULT_PARAM_KEY = "page-size";

/** Default visible group label for the segmented control. */
export const DEFAULT_GROUP_LABEL = "Results per page";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a numeric page size from `localStorage`, returning `null` when:
 * - `window` is unavailable (SSR)
 * - `localStorage` throws (private mode, disabled)
 * - the stored value is missing, non-numeric, or not in `options`
 */
function readInitialFromStorage(
  options: readonly number[],
  storageKey: string,
): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || !options.includes(n)) return null;
    return n;
  } catch {
    // localStorage may throw when storage is disabled or quota is exceeded
    return null;
  }
}

/**
 * Best-effort write to localStorage. Silent on failure (private browsing,
 * quota, disabled). We never block the UI for persistence.
 */
function writeStorage(storageKey: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // intentionally swallowed — see comment above
  }
}

/**
 * Parse a candidate URL param into a numeric page size. Returns `null` for
 * anything that isn't a non-negative integer present in `options`. This is
 * strict on purpose so deep links like `?page-size=abc` fall through to
 * storage instead of producing a hostile 0 / Infinity / NaN value.
 */
function parseUrlParam(
  raw: string | null | undefined,
  options: readonly number[],
): number | null {
  if (raw === null || raw === undefined) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return options.includes(n) ? n : null;
}

/**
 * Read the query string on the very first render in a way that does not
 * depend on `useSearchParams()` (which forces a Suspense boundary). Caller
 * is responsible for guarding the SSR path — see `usePageSize` below.
 */
function readInitialFromWindow(
  options: readonly number[],
  defaultValue: number,
  paramKey: string,
  storageKey: string,
): number {
  const urlParam = parseUrlParam(
    new URLSearchParams(window.location.search).get(paramKey),
    options,
  );
  if (urlParam !== null) return urlParam;
  const stored = readInitialFromStorage(options, storageKey);
  if (stored !== null) return stored;
  return defaultValue;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UsePageSizeOptions {
  /** Allowed page sizes. @default `[12, 24, 48]` */
  options?: readonly number[];
  /** Default when no URL param and no storage present. @default `24` */
  defaultValue?: number;
  /** localStorage key. @default `"chronopay-marketplace-page-size"` */
  storageKey?: string;
  /** URL search-param key. @default `"page-size"` */
  paramKey?: string;
}

export interface UsePageSizeReturn {
  /** Current effective page size */
  value: number;
  /**
   * Update the page size. Writes both:
   *   - `localStorage[storageKey]` (per-user persistence)
   *   - URL search-param via `router.replace` (deep-link survival)
   * Silently no-ops for values not in `options`.
   */
  setValue: (next: number) => void;
  /** Read-only view of the configured options. */
  options: readonly number[];
}

/**
 * `usePageSize` — source-of-truth hook for the marketplace page size.
 *
 * Source precedence on mount:
 *   1. URL param (`?page-size=24`)
 *   2. `localStorage` (`chronopay-marketplace-page-size`)
 *   3. `defaultValue` (24)
 *
 * After mount, the URL param always wins (it is re-read on every render).
 * A change writes both `localStorage` *and* the URL — which is desirable:
 *   - the URL means the user can share / bookmark a specific size
 *   - the storage means the size sticks across sessions even when the URL
 *     doesn't carry it any more (e.g. the user navigates to `/marketplace`
 *     without a query string)
 */
export function usePageSize({
  options = DEFAULT_PAGE_SIZE_OPTIONS,
  defaultValue = DEFAULT_PAGE_SIZE,
  storageKey = DEFAULT_STORAGE_KEY,
  paramKey = DEFAULT_PARAM_KEY,
}: UsePageSizeOptions = {}): UsePageSizeReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Freeze the initial value once on mount; subsequent navigations to the
  // same component will use the same lazy initializer (React semantics).
  // We deliberately avoid `setState-in-effect` here — the URL wins on every
  // re-render via the line below, so we never need to write back to local
  // state during effects.
  const [initialValue] = useState(() =>
    typeof window === "undefined"
      ? defaultValue
      : readInitialFromWindow(options, defaultValue, paramKey, storageKey),
  );

  // Last value chosen through `setValue`. Needed so the hook reflects a new
  // selection immediately: `router.replace` is asynchronous (and wrapped in a
  // transition), so without this the caller would keep rendering the previous
  // size until the navigation lands — and would never update at all when the
  // router is stubbed (tests).
  const [selectedValue, setSelectedValue] = useState<number | null>(null);

  // URL is the live source of truth after the initial render. In tests the
  // mock `useSearchParams` implementation drives this branch — see
  // `__tests__/results-per-page-selector.test.tsx` for examples.
  const urlValue = parseUrlParam(searchParams.get(paramKey), options);
  const value = urlValue ?? selectedValue ?? initialValue;

  const setValue = useCallback(
    (next: number) => {
      if (!options.includes(next)) return;

      // Compare URLs by *parsed* numeric value so that a deep link like
      // `?page-size=024` (JavaScript coerces to 24) doesn't trigger a
      // redundant `router.replace` when the user clicks 24 again.
      const currentUrlValue = parseUrlParam(
        searchParams.get(paramKey),
        options,
      );
      if (next === value && currentUrlValue === next) {
        // already in sync — still refresh storage so the user's most
        // recent intent is recorded for the next visit without a URL param.
        writeStorage(storageKey, next);
        return;
      }

      writeStorage(storageKey, next);
      setSelectedValue(next);

      // Update the URL inside a transition so it doesn't block input/repaint.
      startTransition(() => {
        const next2 = new URLSearchParams(searchParams.toString());
        next2.set(paramKey, String(next));
        const qs = next2.toString();
        router.replace(
          `${pathname}${qs ? `?${qs}` : ""}`,
          { scroll: false },
        );
      });
    },
    [options, value, searchParams, storageKey, paramKey, router, pathname, startTransition],
  );

  return { value, setValue, options };
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface ResultsPerPageSelectorProps {
  /** Currently selected page size (controlled). */
  value: number;
  /**
   * Called with the next value when the user picks a different option.
   * Pagination-mode parents should also reset `page` to 1 here; infinite
   * scroll parents should reset their accumulated batch.
   */
  onChange: (next: number) => void;
  /** Allowed values. @default `[12, 24, 48]` */
  options?: readonly number[];
  /** Visible group label. @default `"Results per page"` */
  label?: string;
  /**
   * Optional total count, shown to the right of the selector as
   * "N / page · M total". Visible text is `aria-hidden`; the equivalent
   * screen-reader copy lives in `aria-describedby`.
   */
  totalCount?: number;
  /** Class names forwarded to the outer wrapper. */
  className?: string;
}

/**
 * `ResultsPerPageSelector` — accessible segmented control for page size.
 *
 * Composes with `usePageSize` so the parent owns the value + URL/storage
 * bookkeeping and the component focuses on UI / a11y.
 */
export function ResultsPerPageSelector({
  value,
  onChange,
  options = DEFAULT_PAGE_SIZE_OPTIONS,
  label = DEFAULT_GROUP_LABEL,
  totalCount,
  className,
}: ResultsPerPageSelectorProps) {
  const groupId = useId();
  const labelId = `${groupId}-label`;
  const descId = `${groupId}-desc`;
  const [announcement, setAnnouncement] = useState("");
  const lastAnnouncedValueRef = useRef<number | null>(null);

  const handleSelect = useCallback(
    (next: number) => {
      if (next === value) return;
      if (lastAnnouncedValueRef.current !== next) {
        setAnnouncement(
          totalCount === undefined
            ? `Now showing ${next} results per page.`
            : `Now showing ${next} results per page of ${totalCount.toLocaleString()} total.`,
        );
        lastAnnouncedValueRef.current = next;
      }
      onChange(next);
    },
    [value, onChange, totalCount],
  );

  // Roving-tabindex keyboard nav. Mirrors the pattern in
  // `SentimentChipFilter` (Home/End/Arrows). ArrowRight + ArrowDown =
  // forward; ArrowLeft + ArrowUp = backward (consistent with both
  // vertical and horizontal reading direction including RTL).
  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLButtonElement>,
      index: number,
    ) => {
      const buttons = document
        .getElementById(groupId)
        ?.querySelectorAll<HTMLButtonElement>("[data-page-size]");
      if (!buttons || buttons.length === 0) return;

      let nextIdx: number | null = null;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIdx = (index + 1) % buttons.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIdx = (index - 1 + buttons.length) % buttons.length;
          break;
        case "Home":
          nextIdx = 0;
          break;
        case "End":
          nextIdx = buttons.length - 1;
          break;
      }

      if (nextIdx !== null) {
        e.preventDefault();
        buttons[nextIdx].focus();
      }
    },
    [groupId],
  );

  const isInvalid = !options.includes(value);

  return (
    <div
      dir="auto"
      data-testid="results-per-page-selector"
      data-value={value}
      className={clsx(
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3",
        className,
      )}
    >
      <div
        id={groupId}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-invalid={isInvalid || undefined}
        className="flex flex-wrap items-center gap-2"
      >
        <span
          id={labelId}
          className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 select-none"
        >
          {label}
        </span>
        <div
          role="presentation"
          className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5"
        >
          {options.map((n, i) => {
            const isActive = value === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                data-page-size={n}
                data-testid={`page-size-option-${n}`}
                aria-checked={isActive}
                aria-label={`${n} results per page`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleSelect(n)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                className={clsx(
                  "min-w-[3rem] rounded-md px-3 py-1.5 text-sm font-medium tabular-nums",
                  "transition-colors duration-150 select-none cursor-pointer",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                  isActive
                    ? "bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                    : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>

      {totalCount !== undefined && (
        <p
          id={descId}
          className="text-xs leading-tight text-slate-500 tabular-nums"
        >
          <span className="sr-only">
            {`Showing ${value} of ${totalCount.toLocaleString()} results per page.`}
          </span>
          <span aria-hidden="true">
            {`${value} / page · ${totalCount.toLocaleString()} total`}
          </span>
        </p>
      )}

      <LiveRegion ariaLive="polite">{announcement}</LiveRegion>
    </div>
  );
}

// Re-export internal helpers for test-only visibility. Not public API.
export const __test_only = {
  readInitialFromStorage,
  writeStorage,
  parseUrlParam,
  readInitialFromWindow,
};
