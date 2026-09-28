"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { LinkControls } from "./share-link-controls";
import { loadLink, requestLink, withLinkDefaults } from "./share-link-requests";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareLinkPatch,
  ShareTarget,
} from "./share-targets";
import { previewShareLinkPatch } from "./share-targets";

interface SingleLinkSectionProps {
  readonly target: ShareTarget;
  /** Already loaded by the opener, so the surface opens at its final size
   * instead of jumping from a loading line mid-animation. */
  readonly initialLink?: ManagedShareLink | null;
}

export function SingleLinkSection({ target, initialLink }: SingleLinkSectionProps) {
  const preloaded = initialLink !== undefined;
  const [link, setLink] = React.useState<ManagedShareLink | null>(initialLink ?? null);
  const [loading, setLoading] = React.useState(!preloaded);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestTarget = React.useMemo<ShareTarget>(
    () => ({ kind: target.kind, id: target.id }),
    [target.id, target.kind],
  );

  React.useEffect(() => {
    if (!requestTarget.id || preloaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const nextLink = await loadLink(requestTarget);
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
  }, [requestTarget, preloaded]);

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
      <div className="px-5 py-4 text-[13px] text-text-tertiary">
        <span>Preparing share link…</span>
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
    />
  );
}
