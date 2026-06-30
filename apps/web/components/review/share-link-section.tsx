"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import type { SharePermission } from "@/types";
import { LinkControls } from "./share-link-controls";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareListEnvelope,
  ShareTarget,
} from "./share-targets";

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

interface SingleLinkSectionProps {
  readonly target: ShareTarget;
}

export function SingleLinkSection({ target }: SingleLinkSectionProps) {
  const [link, setLink] = React.useState<ManagedShareLink | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const targetName = target.kind === "project" ? target.name : undefined;

  React.useEffect(() => {
    if (!target.id) return;
    let cancelled = false;
    let requestTarget: ShareTarget;
    if (target.kind === "project") {
      requestTarget = { kind: "project", id: target.id, name: targetName };
    } else if (target.kind === "asset") {
      requestTarget = { kind: "asset", id: target.id };
    } else {
      requestTarget = { kind: "folder", id: target.id };
    }
    const requestKey = [target.kind, target.id, targetName ?? ""].join(":");
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let request = linkRequests.get(requestKey);
        if (!request) {
          request = loadOrCreateLink(requestTarget).finally(() => {
            linkRequests.delete(requestKey);
          });
          linkRequests.set(requestKey, request);
        }
        const nextLink = await request;
        if (!cancelled) setLink(nextLink);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load share link");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target.id, target.kind, targetName]);

  async function patchLink(
    updates: Partial<Pick<ManagedShareLink, "permission" | "allow_download">>,
  ) {
    if (!link) return;
    const previous = link;
    setSaving(true);
    setError(null);
    setLink({ ...link, ...updates });
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
