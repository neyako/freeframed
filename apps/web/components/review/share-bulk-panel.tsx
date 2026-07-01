"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import type { SharePermission } from "@/types";
import { LinkControls } from "./share-link-controls";
import { withLinkDefaults } from "./share-link-section";
import { previewShareLinkPatch } from "./share-targets";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareLinkPatch,
} from "./share-targets";

const bulkShareRequests = new Map<string, Promise<ManagedShareLink>>();

interface BulkSharePanelProps {
  readonly projectId: string;
  readonly assetIds: readonly string[];
  readonly folderIds: readonly string[];
  readonly title?: string;
}

export function BulkSharePanel({
  projectId,
  assetIds,
  folderIds,
  title,
}: BulkSharePanelProps) {
  const [link, setLink] = React.useState<ManagedShareLink | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const completedKey = React.useRef<string | null>(null);
  const itemCount = assetIds.length + folderIds.length;
  const shareTitle = title ?? `Share ${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const requestKey = React.useMemo(
    () => [projectId, ...assetIds, "|", ...folderIds].join("\u0000"),
    [assetIds, folderIds, projectId],
  );

  React.useEffect(() => {
    if (itemCount === 0 || completedKey.current === requestKey) return;
    let cancelled = false;
    setLink(null);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let request = bulkShareRequests.get(requestKey);
        if (!request) {
          request = api
            .post<ShareLinkCandidate>(
              `/projects/${projectId}/share/multi`,
              {
                asset_ids: assetIds,
                folder_ids: folderIds,
                title: shareTitle,
                permission: "view" satisfies SharePermission,
                allow_download: false,
              },
            )
            .then(withLinkDefaults)
            .finally(() => {
              bulkShareRequests.delete(requestKey);
            });
          bulkShareRequests.set(requestKey, request);
        }
        const nextLink = await request;
        if (!cancelled) {
          completedKey.current = requestKey;
          setLink(nextLink);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to create share link");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetIds, folderIds, itemCount, projectId, requestKey, shareTitle]);

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

  if (itemCount === 0) {
    return (
      <p className="rounded-md border border-border bg-bg-tertiary px-3 py-2 text-xs text-text-secondary">
        No items selected.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        <span className="text-xs text-text-tertiary">
          Creating share link...
        </span>
      </div>
    );
  }

  if (!link) {
    return (
      <p className="py-2 text-xs text-status-error">
        {error ?? "No share link"}
      </p>
    );
  }

  return (
    <LinkControls
      link={link}
      saving={saving}
      error={error}
      onPatch={(updates) => void patchLink(updates)}
    />
  );
}
