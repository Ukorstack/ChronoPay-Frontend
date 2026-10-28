"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import type { ToastVariant } from "@/hooks/use-toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RecentlyViewedItem {
  id: string;
  title: string;
  price: string;
  image?: string;
  href: string;
  viewedAt: number;
}

const STORAGE_KEY = "chronopay-recently-viewed";
const MAX_ITEMS = 10;

// Legacy entries stored `href: "/marketplace"`; rewrite them from the id so
// old storage keeps working after the listing detail route was introduced.
function normalizeItem(item: RecentlyViewedItem): RecentlyViewedItem {
  if (!item.href || item.href === "/marketplace") {
    return { ...item, href: `/marketplace/${item.id}` };
  }
  return item;
}

function normalizeItems(items: RecentlyViewedItem[]): RecentlyViewedItem[] {
  return items.map(normalizeItem);
}

// ─── Component ───────────────────────────────────────────────────────────────────

export function RecentlyViewedRail() {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Load items from localStorage via lazy initializer
  const [items, setItems] = useState<RecentlyViewedItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        // Cap on read too: older builds persisted more than MAX_ITEMS, so
        // storage is untrusted input for the rail's visible length.
        return normalizeItems(
          JSON.parse(stored) as RecentlyViewedItem[],
        ).slice(0, MAX_ITEMS);
      }
    } catch (error) {
      console.error("Failed to load recently viewed items:", error);
    }
    return [];
  });

  // Subscribe to external custom events — legitimate side effect pattern.
  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const updated = (e as CustomEvent<RecentlyViewedItem[]>).detail;
      setItems(normalizeItems(updated));
    };

    window.addEventListener("chronopay:recently-viewed-updated", handleUpdate);
    return () => window.removeEventListener("chronopay:recently-viewed-updated", handleUpdate);
  }, []);

  // Synchronize React state to localStorage — valid side effect.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Failed to save recently viewed items:", error);
    }
  }, [items]);

  // Add item to recently viewed
  const addItem = useCallback((item: Omit<RecentlyViewedItem, "viewedAt">) => {
    setItems((prev: RecentlyViewedItem[]) => {
      const existingIndex = prev.findIndex((i: RecentlyViewedItem) => i.id === item.id);
      const newItem: RecentlyViewedItem = {
        ...normalizeItem({ ...item, viewedAt: Date.now() }),
        viewedAt: Date.now(),
      };

      // Remove existing item if present
      const filtered = existingIndex >= 0 
        ? prev.filter((i: RecentlyViewedItem) => i.id !== item.id)
        : prev;

      // Add new item at beginning
      const updated = [newItem, ...filtered];

      // Keep only MAX_ITEMS
      return updated.slice(0, MAX_ITEMS);
    });
  }, []);

  // Clear all items with confirmation
  const handleClearHistory = useCallback(() => {
    if (!showClearConfirm) {
      setShowClearConfirm(true);
      return;
    }

    setItems([]);
    setShowClearConfirm(false);
    toast({
      variant: "info" as ToastVariant,
      title: "History cleared",
      description: "Your recently viewed items have been removed",
    });
  }, [showClearConfirm, toast]);

  // Cancel clear confirmation
  const handleCancelClear = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  // Keyboard navigation with roving tabindex
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (items.length === 0) return;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          {
            const nextIndex = (index + 1) % items.length;
            setFocusedIndex(nextIndex);
          }
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          {
            const prevIndex = index === 0 ? items.length - 1 : index - 1;
            setFocusedIndex(prevIndex);
          }
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(items.length - 1);
          break;
      }
    },
    [items.length]
  );

  // Focus the element at focusedIndex
  const didMountRef = useRef(false);
  useEffect(() => {
    // Skip the initial mount so the rail does not steal focus or scroll.
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (focusedIndex >= 0 && containerRef.current) {
      const buttons = containerRef.current.querySelectorAll<HTMLAnchorElement>(
        "[data-recently-viewed-item]"
      );
      const button = buttons[focusedIndex];
      if (button) {
        button.focus();
        // Scroll into view if needed
        button.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, [focusedIndex]);

  // Keep the rail at its start until the user navigates it.
  useEffect(() => {
    if (focusedIndex < 0 && containerRef.current) {
      containerRef.current.scrollLeft = 0;
    }
  }, [items, focusedIndex]);

  // Don't render if no items
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Recently viewed"
      className="mb-8"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Recently viewed</h2>
        <button
          onClick={handleClearHistory}
          onBlur={() => showClearConfirm && setShowClearConfirm(false)}
          className="text-sm text-zinc-400 hover:text-white transition-colors focus-ring-white rounded px-2 py-1"
          aria-label={showClearConfirm ? "Confirm clear history" : "Clear history"}
        >
          {showClearConfirm ? (
            <span className="flex items-center gap-2">
              <span className="text-red-400">Confirm?</span>
              <span className="text-zinc-500">/</span>
              <span
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleCancelClear();
                }}
                className="text-zinc-400 hover:text-white"
              >
                Cancel
              </span>
            </span>
          ) : (
            "Clear history"
          )}
        </button>
      </div>

      <div
        ref={containerRef}
        role="region"
        aria-label="Recently viewed items"
        className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {items.map((item: RecentlyViewedItem, index: number) => (
          <Link
            key={item.id}
            href={item.href}
            data-recently-viewed-item
            tabIndex={focusedIndex === index ? 0 : -1}
            onKeyDown={(e: React.KeyboardEvent) => handleKeyDown(e, index)}
            onFocus={() => setFocusedIndex(index)}
            className="flex-shrink-0 w-48 snap-start group"
            aria-label={`View ${item.title}, priced at ${item.price}`}
          >
            <div
              className="card card--interactive h-full"
              style={{
                minHeight: "180px",
              }}
            >
              {item.image && (
                <div
                  className="relative aspect-video w-full bg-zinc-800 rounded-t-lg overflow-hidden"
                  aria-hidden="true"
                >
                  <Image
                    src={item.image}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 192px, 70vw"
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                </div>
              )}
              <div className="p-3">
                <h3 className="text-sm font-medium text-white line-clamp-2">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">{item.price}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style jsx>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </section>
  );
}

// ─── Hook for adding items from anywhere in the app ─────────────────────────────

export function useRecentlyViewed() {
  const addItem = useCallback((item: Omit<RecentlyViewedItem, "viewedAt">) => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const existing: RecentlyViewedItem[] = stored ? normalizeItems(JSON.parse(stored)) : [];
      
      const existingIndex = existing.findIndex((i) => i.id === item.id);
      const newItem: RecentlyViewedItem = {
        ...normalizeItem({ ...item, viewedAt: Date.now() }),
        viewedAt: Date.now(),
      };

      const filtered = existingIndex >= 0 
        ? existing.filter((i) => i.id !== item.id)
        : existing;

      const updated = [newItem, ...filtered].slice(0, MAX_ITEMS);
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      
      // Dispatch event for RecentlyViewedRail to update
      window.dispatchEvent(new CustomEvent("chronopay:recently-viewed-updated", {
        detail: updated
      }));
    } catch (error) {
      console.error("Failed to add recently viewed item:", error);
    }
  }, []);

  return { addItem };
}
