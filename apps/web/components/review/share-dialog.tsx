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
  projectId,
  withPeople = false,
}: SharePanelProps) {
  const [showPeople, setShowPeople] = React.useState(false);
  const peopleTarget: PeopleShareTarget | null =
    target.kind === "project" ? null : target;

  return (
    <div className="space-y-4">
      <SingleLinkSection target={target} />
      {withPeople && peopleTarget && (
        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowPeople((v) => !v)}
            className="flex w-full items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            Invite specific people
            <ChevronDown
              className={cn(
                "ml-auto h-3.5 w-3.5 transition-transform",
                showPeople && "rotate-180",
              )}
            />
          </button>
          {showPeople && (
            <div className="mt-3">
              <DirectTab target={peopleTarget} orgId={projectId} />
            </div>
          )}
        </div>
      )}
    </div>
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

      {dropdownOpen && (
        <div
          className={cn(
            "fixed left-2 right-2 top-12 z-50 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80",
            "rounded-xl border border-border bg-bg-elevated p-3 shadow-xl",
            "animate-in fade-in-0 zoom-in-95 duration-150 space-y-4",
          )}
        >
          <SharePanel
            target={{ kind: "asset", id: assetId }}
            projectId={projectId}
            withPeople
          />
        </div>
      )}
    </div>
  );
}
