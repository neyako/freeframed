"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import type { SharePermission } from "@/types";
import { LinkControls } from "./share-link-controls";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareLinkPatch,
  ShareListEnvelope,
  ShareTarget,
} from "./share-targets";
import { previewShareLinkPatch } from "./share-targets";

const LIST_PATH: Record<
  Exclude<ShareTarget["kind"], "project">,
  (id: string) => string
> = {
  asset: (id) => `/assets/${id}/shares`,
  folder: (id) => `/folders/${id}/shares`,
};

const CREATE_PATH: Record<ShareTarget["kind"], (id: string) => string> = {
  asset: (id) => `/assets/${id}/share`,
  folder: (id) => `/folders/${id}/share`,
  project: (id) => `/projects/${id}/share`,
};

const linkRequests = new Map<string, Promise<ManagedShareLink>>();

function isShareLinkArray(
  response: readonly ShareLinkCandidate[] | ShareListEnvelope,
): response is readonly ShareLinkCandidate[] {
  return Array.isArray(response);
}

function normaliseShareLinks(
  response: readonly ShareLinkCandidate[] | ShareListEnvelope,
): readonly ShareLinkCandidate[] {
  if (isShareLinkArray(response)) return response;
  return response.share_links;
}

function getListPath(target: ShareTarget) {
  if (target.kind !== "project") return LIST_PATH[target.kind](target.id);
  return getProjectListPath(target, Boolean(target.name));
}

function getRequestTarget(
  kind: ShareTarget["kind"],
  id: string,
  name?: string,
): ShareTarget {
  if (kind === "project") return { kind, id, name };
  if (kind === "asset") return { kind, id };
  return { kind, id };
}

function getRequestKey(target: ShareTarget) {
  return [
    target.kind,
    target.id,
    target.kind === "project" ? target.name ?? "" : "",
  ].join(":");
}

function getProjectListPath(
  target: Extract<ShareTarget, { kind: "project" }>,
  includeSearch: boolean,
) {
  const search =
    includeSearch && target.name
      ? `?search=${encodeURIComponent(target.name)}`
      : "";
  return `/projects/${target.id}/share-links${search}`;
}

export function withLinkDefaults(link: ShareLinkCandidate): ManagedShareLink {
  return {
    ...link,
    allow_download: link.allow_download ?? false,
  };
}

function getDefaultPermission(target: ShareTarget): SharePermission {
  return target.kind === "asset" ? "comment" : "view";
}

async function hydrateLink(candidate: ShareLinkCandidate) {
  const response = await api.get<ShareLinkCandidate>(
    `/share/${candidate.token}/details`,
  );
  return withLinkDefaults({ ...candidate, ...response });
}

async function findProjectRootLink(
  target: Extract<ShareTarget, { kind: "project" }>,
  candidates: readonly ShareLinkCandidate[],
) {
  for (const candidate of candidates) {
    const details = await hydrateLink(candidate);
    const isProjectRoot =
      details.project_id === target.id &&
      !details.asset_id &&
      !details.folder_id;
    if (isProjectRoot) return details;
  }
  return null;
}

async function loadProjectRootLink(
  target: Extract<ShareTarget, { kind: "project" }>,
  links: readonly ShareLinkCandidate[],
) {
  const projectRootLink = await findProjectRootLink(
    target,
    links.filter((candidate) => candidate.is_enabled),
  );
  if (projectRootLink || !target.name) return projectRootLink;

  const response = await api.get<readonly ShareLinkCandidate[]>(
    getProjectListPath(target, false),
  );
  return findProjectRootLink(
    target,
    response.filter((candidate) => candidate.is_enabled),
  );
}

async function loadOrCreateLink(target: ShareTarget): Promise<ManagedShareLink> {
  const response = await api.get<
    readonly ShareLinkCandidate[] | ShareListEnvelope
  >(getListPath(target));
  const links = normaliseShareLinks(response);
  if (target.kind === "project") {
    const projectRootLink = await loadProjectRootLink(target, links);
    if (projectRootLink) return projectRootLink;
  } else {
    const existing = links.find((candidate) => candidate.is_enabled) ?? links[0];
    if (existing) return withLinkDefaults(existing);
  }

  const created = await api.post<ShareLinkCandidate>(
    CREATE_PATH[target.kind](target.id),
    {
      permission: getDefaultPermission(target),
      allow_download: false,
      ...(target.kind === "project" && target.name
        ? { title: target.name }
        : {}),
    },
  );
  return withLinkDefaults(created);
}

function requestLink(target: ShareTarget) {
  const requestKey = getRequestKey(target);
  let request = linkRequests.get(requestKey);
  if (!request) {
    request = loadOrCreateLink(target).finally(() => {
      linkRequests.delete(requestKey);
    });
    linkRequests.set(requestKey, request);
  }
  return request;
}

interface SingleLinkSectionProps {
  readonly target: ShareTarget;
}

export function SingleLinkSection({ target }: SingleLinkSectionProps) {
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
      <div className="flex items-center gap-2 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        <span className="text-xs text-text-tertiary">
          Preparing share link...
        </span>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="rounded-lg border border-border bg-bg-tertiary p-3">
        <p className="text-sm font-medium text-text-primary">No share link</p>
        {error && <p className="mt-1 text-xs text-status-error">{error}</p>}
        <button
          type="button"
          onClick={() => void createLink()}
          className="mt-3 inline-flex h-9 items-center rounded-md border border-border bg-bg-secondary px-3 text-sm font-medium text-text-primary transition-colors hover:bg-bg-hover"
        >
          Create share link
        </button>
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
    />
  );
}
