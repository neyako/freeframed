"use client";

import * as React from "react";
import { Share2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SingleLinkSection } from "./share-link-section";
import { loadLink } from "./share-link-requests";
import type { ManagedShareLink } from "./share-targets";

interface ShareDialogProps {
  readonly assetId: string;
}

export function ShareDialog({ assetId }: ShareDialogProps) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  // Load the link before opening (prefetched on hover/focus) so the panel
  // animates in once at its final height. Refetched each time it opens.
  const [link, setLink] = React.useState<ManagedShareLink | null | undefined>(undefined);
  const pending = React.useRef<Promise<ManagedShareLink | null | undefined> | null>(null);
  const prefetch = React.useCallback(() => {
    pending.current ??= loadLink({ kind: "asset", id: assetId }).catch(() => undefined);
    return pending.current;
  }, [assetId]);

  async function toggle() {
    if (dropdownOpen) {
      setDropdownOpen(false);
      return;
    }
    setLink(await prefetch());
    setDropdownOpen(true);
  }

  React.useEffect(() => {
    if (!dropdownOpen) pending.current = null;
  }, [dropdownOpen]);

  React.useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const isSelectPortal =
        target instanceof HTMLElement &&
        target.closest("[data-radix-popper-content-wrapper]");
      const isDialogPortal =
        target instanceof HTMLElement && target.closest('[role="dialog"]');
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !isSelectPortal &&
        !isDialogPortal
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  React.useEffect(() => {
    if (!dropdownOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [dropdownOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="primary"
        size="sm"
        onClick={() => void toggle()}
        onPointerEnter={() => void prefetch()}
        onFocus={() => void prefetch()}
        className={cn(dropdownOpen && "bg-text-primary/85")}
        title="Share"
      >
        <Share2 className="h-4 w-4" />
        <span className="hidden sm:inline">Share</span>
      </Button>

      {/* Always mounted, opacity-only — same as the header's shared scrim.
          Mounting/unmounting around a keyframe animation needs a JS timer in
          lockstep with the CSS, and any drift tears the element out mid-fade. */}
      <div
        aria-hidden
        className={cn(
          "fixed inset-x-0 bottom-0 top-14 z-40 bg-black/40 transition-opacity duration-150",
          dropdownOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={() => setDropdownOpen(false)}
      />

      {dropdownOpen && (
        <>
        {/* Unmounts on close with an enter-only animation — no exit
            keyframes means no unmount race. */}
        <div
          className={cn(
            "fixed left-2 right-2 top-16 z-50 w-auto sm:left-auto sm:right-2 sm:w-[460px]",
            "max-h-[calc(100dvh-4.5rem)] sm:max-h-[min(calc(100dvh-8rem),42rem)] overflow-y-auto overscroll-contain",
            "rounded-xl border border-border bg-bg-elevated shadow-xl overflow-x-hidden animate-ff-pop-in",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-tertiary px-5 py-3.5">
            <span className="text-[12.5px] text-text-primary">
              Share
            </span>
          </div>
          <SingleLinkSection target={{ kind: "asset", id: assetId }} initialLink={link} />
        </div>
        </>
      )}
    </div>
  );
}
