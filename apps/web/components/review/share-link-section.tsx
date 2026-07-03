"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { LinkControls } from "./share-link-controls";
import {
  getRequestTarget,
  requestLink,
  withLinkDefaults,
} from "./share-link-requests";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareLinkPatch,
  ShareTarget,
} from "./share-targets";
import { previewShareLinkPatch } from "./share-targets";

export { withLinkDefaults } from "./share-link-requests";

interface SingleLinkSectionProps {
  readonly target: ShareTarget;
  readonly children?: React.ReactNode;
}

export function SingleLinkSection({ target, children }: SingleLinkSectionProps) {
  const [link, setLink] = React.useState<ManagedShareLink | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const targetName = target.kind === "project" ? target.name : undefined;
  const requestTarget = React.useMemo(
    () => getRequestTarget(target.kind, target.id, targetName),
    [target.id, target.kind, targetName],
  );

  React.useEffect(() => {
    if (!requestTarget.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const nextLink = await requestLink(requestTarget);
        if (!cancelled) setLink(nextLink);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load share link",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestTarget]);

  async function createLink() {
    setLoading(true);
    setError(null);
    try {
      const nextLink = await requestLink(requestTarget);
      setLink(nextLink);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create share link",
      );
    } finally {
      setLoading(false);
    }
  }

  async function patchLink(updates: ShareLinkPatch) {
    if (!link) return;
    const previous = link;
    setSaving(true);
    setError(null);
    setLink(previewShareLinkPatch(link, updates));
    try {
      const updated = await api.patch<ShareLinkCandidate>(
        `/share/${link.token}`,
        updates,
      );
      setLink(withLinkDefaults({ ...updated, url: previous.url ?? updated.url }));
    } catch (err) {
      setLink(previous);
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function revokeLink() {
    if (!link) return;
    const previous = link;
    setSaving(true);
    setError(null);
    try {
      await api.delete(`/share/${link.token}`);
      setLink(null);
    } catch (err) {
      setLink(previous);
      setError(err instanceof Error ? err.message : "Failed to revoke link");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 font-mono text-xs text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        <span>Preparing share link...</span>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="px-5 py-4">
        <p className="text-sm font-medium text-text-primary">No share link</p>
        {error && <p className="mt-1 text-xs text-status-error">{error}</p>}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void createLink()}
          className="mt-3"
        >
          Create share link
        </Button>
      </div>
    );
  }

  return (
    <LinkControls
      link={link}
      saving={saving}
      error={error}
      onPatch={(updates) => void patchLink(updates)}
      onRevoke={() => void revokeLink()}
      showAdvancedControls
      beforeFooter={children}
    />
  );
}
