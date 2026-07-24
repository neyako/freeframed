"use client";

import * as React from "react";
import { ChevronDown, Share2, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DirectTab } from "./share-direct-panel";
import { SingleLinkSection } from "./share-link-section";
import type { PeopleShareTarget, ShareTarget } from "./share-targets";

export { BulkSharePanel } from "./share-bulk-panel";
export type { ShareTarget } from "./share-targets";

interface SharePanelProps {
  readonly target: ShareTarget;
  readonly projectId?: string;
  readonly withPeople?: boolean;
}

export function SharePanel({
  target,
  withPeople = false,
}: SharePanelProps) {
  const [showPeople, setShowPeople] = React.useState(false);
  const peopleTarget: PeopleShareTarget = target;

  return (
    <SingleLinkSection target={target}>
      {withPeople && (
        <>
          <button
            type="button"
            onClick={() => setShowPeople((v) => !v)}
            className="flex w-full items-center justify-between gap-3 border-b border-border-secondary px-5 py-[15px] font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:text-text-primary"
          >
            <span className="inline-flex items-center gap-2">
              <Users className="h-3.5 w-3.5" />
              Invite people
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showPeople && "rotate-180",
              )}
            />
          </button>
          {showPeople && (
            <div className="border-b border-border-secondary px-5 py-4">
              <DirectTab target={peopleTarget} />
            </div>
          )}
        </>
      )}
    </SingleLinkSection>
  );
}

interface ShareDialogProps {
  readonly assetId: string;
  readonly assetName?: string;
  readonly projectId?: string;
  readonly asset?: unknown;
}

export function ShareDialog({
  assetId,
  projectId,
}: ShareDialogProps) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

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
        variant="secondary"
        size="sm"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className={cn(dropdownOpen && "bg-bg-hover")}
      >
        <Share2 className="h-4 w-4" />
        Share
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
        {/* Unmounts on close with an enter-only animation, matching the
            notification drawer — no exit keyframes means no unmount race. */}
        <div
          className={cn(
            "fixed left-2 right-2 top-16 z-50 w-auto sm:left-auto sm:right-2 sm:w-[460px]",
            "max-h-[calc(100dvh-4.5rem)] sm:max-h-[min(calc(100dvh-8rem),42rem)] overflow-y-auto overscroll-contain",
            "rounded-xl border border-border bg-bg-elevated shadow-xl overflow-x-hidden",
            "animate-scale-in",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-tertiary px-5 py-3.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-primary">
              Share
            </span>
          </div>
          <SharePanel
            target={{ kind: "asset", id: assetId }}
            projectId={projectId}
            withPeople
          />
        </div>
        </>
      )}
    </div>
  );
}
