import type { Metadata } from "next";
import { SharePageClient } from "./share-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
/** Server-side fetches run inside the web container — use its own API URL when
 * provided (e.g. http://api:8000 in the dev compose), else the public one. */
const SERVER_API_URL =
  process.env.API_INTERNAL_URL ||
  (API_URL.startsWith("/") ? "http://localhost:8000" : API_URL);
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "FreeFrame";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

interface SharePreviewInfo {
  requires_password?: boolean;
  requires_auth?: boolean;
  title?: string | null;
  description?: string | null;
  folder_name?: string | null;
  project_name?: string | null;
  asset?: {
    name?: string;
    description?: string | null;
    thumbnail_url?: string | null;
  } | null;
}

async function fetchSharePreviewInfo(
  token: string,
): Promise<SharePreviewInfo | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/share/${token}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const { token } = params;
  const info = await fetchSharePreviewInfo(token);

  const metadata: Metadata = {
    title: SITE_NAME,
    metadataBase: new URL(SITE_URL),
    openGraph: { siteName: SITE_NAME, type: "website" },
    twitter: { card: "summary_large_image" },
  };
  if (!info) return metadata;

  const locked = info.requires_password || info.requires_auth;
  if (locked) {
    // Password/secure links stay generic — no asset info before unlock.
    const title = info.title ? `${info.title} — ${SITE_NAME}` : SITE_NAME;
    metadata.title = title;
    metadata.description = "This share link is protected.";
    return metadata;
  }

  const name =
    info.asset?.name ||
    info.title ||
    info.folder_name ||
    info.project_name ||
    null;
  if (name) metadata.title = `${name} — ${SITE_NAME}`;
  const description =
    info.description || info.asset?.description || null;
  if (description) metadata.description = description;
  const thumbnail = info.asset?.thumbnail_url;
  if (thumbnail) {
    metadata.openGraph = {
      ...metadata.openGraph,
      title: name ?? SITE_NAME,
      description: description ?? undefined,
      images: [{ url: thumbnail }],
    };
    metadata.twitter = {
      card: "summary_large_image",
      title: name ?? SITE_NAME,
      description: description ?? undefined,
      images: [thumbnail],
    };
  }
  return metadata;
}

export default function ShareTokenPage({
  params,
}: {
  params: { token: string };
}) {
  return <SharePageClient token={params.token} />;
}
