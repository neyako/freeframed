import { api } from "@/lib/api";
import type {
  ManagedShareLink,
  ShareLinkCandidate,
  ShareTarget,
} from "./share-targets";

const linkLoadRequests = new Map<
  string,
  Promise<ManagedShareLink | null>
>();
const linkRequests = new Map<string, Promise<ManagedShareLink>>();

function getTargetPath(target: ShareTarget) {
  return target.kind === "asset"
    ? `/assets/${target.id}`
    : `/folders/${target.id}`;
}

function getRequestKey(target: ShareTarget) {
  return `${target.kind}:${target.id}`;
}

export function withLinkDefaults(
  link: ShareLinkCandidate,
): ManagedShareLink {
  return {
    ...link,
    allow_download: link.allow_download ?? false,
  };
}

async function loadExistingLink(
  target: ShareTarget,
): Promise<ManagedShareLink | null> {
  const links = await api.get<readonly ShareLinkCandidate[]>(
    `${getTargetPath(target)}/shares`,
  );
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
    `${getTargetPath(target)}/share`,
    {
      permission: target.kind === "asset" ? "comment" : "view",
      allow_download: false,
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
