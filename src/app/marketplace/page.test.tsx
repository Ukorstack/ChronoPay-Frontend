import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Marketplace from "./page";

// Mock next/navigation
const mockSearchParams = {
  get: vi.fn(() => null as string | null),
  entries: vi.fn(function* () {}),
  toString: vi.fn(() => ""),
};

const mockRouter = {
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/marketplace",
  useSearchParams: () => mockSearchParams,
}));

// Mock next/link to render a plain anchor while preserving the href
type LinkProps = {
  prefetch?: boolean;
  href?: string;
  className?: string;
  onClick?: (event: { preventDefault(): void }) => void;
  [key: string]: unknown;
};

vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...rest }: LinkProps) => <a {...rest} />,
}));

// Mock toast to prevent warnings
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

/** Point the `useSearchParams` mock at an explicit query string. */
function setSearchParams(params: Record<string, string>) {
  const usp = new URLSearchParams(params);
  mockSearchParams.get.mockImplementation((key: string) => usp.get(key));
  mockSearchParams.toString.mockImplementation(() => usp.toString());
}

/** Href of the detail link inside each rendered grid card. */
function cardHrefs(container: HTMLElement): (string | null)[] {
  return Array.from(
    container.querySelectorAll('[data-testid="marketplace-grid"] li'),
  ).map((li) => li.querySelector("a")?.getAttribute("href") ?? null);
}

describe("Marketplace Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams.get.mockReturnValue(null);
    mockSearchParams.toString.mockReturnValue("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders correctly with default settings (24 items)", async () => {
    render(<Marketplace />);

    // Check main headings
    expect(screen.getByText("Marketplace")).toBeInTheDocument();

    // Wait for seeding to complete (if any) or just wait for items to render
    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items.length).toBe(24);
    });
  });

  it("shows the marketplace skeleton while the grid is suspended", async () => {
    // `useSearchParams()` suspends during streaming/SSR — the Suspense
    // fallback must be the skeleton, not an empty container.
    let pending = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockSearchParams.get.mockImplementation(() => {
      if (pending) throw gate;
      return null;
    });

    render(<Marketplace />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading marketplace items");
    expect(screen.queryByTestId("marketplace-grid")).not.toBeInTheDocument();

    await act(async () => {
      pending = false;
      release();
    });

    expect(screen.getByTestId("marketplace-grid")).toBeInTheDocument();
    mockSearchParams.get.mockReturnValue(null);
  });

  it("changes the number of visible items when page size is changed", async () => {
    render(<Marketplace />);

    const option12 = screen.getByRole("radio", { name: /^12 results per page/i });

    act(() => {
      fireEvent.click(option12);
    });

    await waitFor(() => {
      const items = screen.getAllByRole("listitem");
      expect(items.length).toBe(12);
    });
  });

  it("shows items 25-36 for ?page-size=12&page=3", async () => {
    setSearchParams({ "page-size": "12", page: "3" });
    const { container } = render(<Marketplace />);

    const items = await screen.findAllByRole("listitem");
    expect(items.length).toBe(12);

    const hrefs = cardHrefs(container);
    expect(hrefs[0]).toBe("/marketplace/svc-21");
    expect(hrefs[11]).toBe("/marketplace/svc-32");

    expect(screen.getByTestId("marketplace-results-summary")).toHaveTextContent(
      "Showing 25–36 of 50",
    );
    expect(screen.getByText("Page 3 of 5")).toBeInTheDocument();
  });

  it("updates the URL when moving between pages", async () => {
    setSearchParams({ "page-size": "12" });
    const { container } = render(<Marketplace />);

    await screen.findAllByRole("listitem");

    const previous = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });

    // Page 1 → Previous is unavailable.
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    expect(screen.getByTestId("marketplace-results-summary")).toHaveTextContent(
      "Showing 1–12 of 50",
    );

    fireEvent.click(next);

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/marketplace?page-size=12&page=2",
    );

    // The router is stubbed, so the DOM stays on page 1 — a second push is
    // not generated from the disabled control.
    fireEvent.click(previous);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(cardHrefs(container)[0]).toBe("/marketplace/demo-1");
  });

  it("clamps an out-of-range page to the last page and rewrites the URL", async () => {
    setSearchParams({ "page-size": "12", page: "99" });
    const { container } = render(<Marketplace />);

    const items = await screen.findAllByRole("listitem");
    // 50 items ÷ 12 per page = 5 pages; page 5 holds items 49–50.
    expect(items.length).toBe(2);
    expect(cardHrefs(container)).toEqual([
      "/marketplace/svc-45",
      "/marketplace/svc-46",
    ]);
    expect(screen.getByTestId("marketplace-results-summary")).toHaveTextContent(
      "Showing 49–50 of 50",
    );

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        "/marketplace?page-size=12&page=5",
        { scroll: false },
      );
    });
  });

  it("renders optimized images instead of raw <img> tags", async () => {
    const { container } = render(<Marketplace />);

    await screen.findAllByRole("listitem");

    const images = container.querySelectorAll(
      '[data-testid="marketplace-grid"] img',
    );
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => {
      expect(img.getAttribute("sizes")).toBeTruthy();
      expect(img.getAttribute("loading")).toBe("lazy");
    });
  });

  it("seeds the recently viewed rail on first visit", async () => {
    render(<Marketplace />);

    // Check that recently viewed rail has items
    await waitFor(() => {
      expect(screen.getByText("Recently viewed")).toBeInTheDocument();
    });

    expect(localStorage.getItem("chronopay-marketplace-visited")).toBe("true");
  });

  it("does not seed recently viewed items if already visited", async () => {
    localStorage.setItem("chronopay-marketplace-visited", "true");

    render(<Marketplace />);

    // The rail should not appear because no items were seeded
    expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument();
  });

  it("handles invalid page size in URL gracefully", () => {
    // Return an invalid page size
    mockSearchParams.get.mockReturnValue("invalid");

    render(<Marketplace />);

    // Should fallback to default 24
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(24);
  });

  it("treats a malformed page param as page 1", async () => {
    setSearchParams({ "page-size": "12", page: "abc" });

    render(<Marketplace />);

    const items = await screen.findAllByRole("listitem");
    expect(items.length).toBe(12);
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("renders without crashing if localStorage is disabled or throws", () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error("Storage disabled");
    });

    render(<Marketplace />);

    expect(screen.getByText("Marketplace")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(24);

    storageSpy.mockRestore();
  });

  it("links each card to its detail route and records it in recently viewed", async () => {
    render(<Marketplace />);

    const items = await screen.findAllByRole("listitem");
    expect(items.length).toBe(24);

    const firstItem = items[0];
    const link = firstItem.querySelector("a[href^='/marketplace/']");
    expect(link).not.toBeNull();

    const href = link!.getAttribute("href");
    expect(href).toMatch(/^\/marketplace\/[^/]+$/);
    expect(href).not.toBe("/marketplace");

    const id = href!.replace("/marketplace/", "");

    act(() => {
      fireEvent.click(link!);
    });

    await waitFor(() => {
      const stored = localStorage.getItem("chronopay-recently-viewed");
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored as string);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((item: { id?: string }) => item.id === id)).toBe(true);
    });
  });
});
