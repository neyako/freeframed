import { api } from "@/lib/api";
import type { SharePermission } from "@/types";
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

const linkLoadRequests = new Map<
  string,
  Promise<ManagedShareLink | null>
>();
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

export function getRequestTarget(
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

export function withLinkDefaults(
  link: ShareLinkCandidate,
): ManagedShareLink {
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

async function loadExistingLink(
  target: ShareTarget,
): Promise<ManagedShareLink | null> {
  const response = await api.get<
    readonly ShareLinkCandidate[] | ShareListEnvelope
  >(getListPath(target));
  const links = normaliseShareLinks(response);
  if (target.kind === "project") {
    return loadProjectRootLink(target, links);
  }

  const existing = links.find((candidate) => candidate.is_enabled);
  return existing ? withLinkDefaults(existing) : null;
}

export function loadLink(
  target: ShareTarget,
): Promise<ManagedShareLink | null> {
  const requestKey = getRequestKey(target);
  let request = linkLoadRequests.get(requestKey);
  if (!request) {
    request = loadExistingLink(target).finally(() => {
      linkLoadRequests.delete(requestKey);
    });
    linkLoadRequests.set(requestKey, request);
  }
  return request;
}

async function loadOrCreateLink(
  target: ShareTarget,
): Promise<ManagedShareLink> {
  const existing = await loadLink(target);
  if (existing) return existing;

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

export function requestLink(target: ShareTarget) {
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
