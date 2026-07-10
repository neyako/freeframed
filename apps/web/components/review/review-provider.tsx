"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import { useReviewStore } from "@/stores/review-store";
import type { AssetResponse, AssetVersion, Comment } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateCommentPayload {
  body: string;
  version_id?: string;
  parent_id?: string;
  timecode_start?: number;
  timecode_end?: number;
  annotation?: { drawing_data: Record<string, unknown> };
}

interface ReviewContextValue {
  assetId: string;
  asset: AssetResponse | null;
  shareToken?: string;
  shareSession?: string | null;
  versions: AssetVersion[];
  comments: Comment[];
  isLoading: boolean;
  error: string | null;
  addComment: (payload: CreateCommentPayload) => Promise<Comment>;
  resolveComment: (commentId: string) => Promise<void>;
  seekTo: (time: number) => void;
  refetchComments: () => Promise<void>;
  refetchVersions: () => Promise<void>;
  pauseVideo: () => void;
  registerPauseHandler: (handler: () => void) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ReviewContext = createContext<ReviewContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAssetVersionStatus(
  value: unknown,
): value is AssetVersion["processing_status"] {
  return (
    value === "uploading" ||
    value === "queued" ||
    value === "processing" ||
    value === "ready" ||
    value === "failed"
  );
}

function isAssetVersion(value: unknown): value is AssetVersion {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.asset_id === "string" &&
    typeof value.version_number === "number" &&
    isAssetVersionStatus(value.processing_status) &&
    typeof value.created_by === "string" &&
    typeof value.created_at === "string" &&
    (value.deleted_at === null || typeof value.deleted_at === "string")
  );
}

function parseAssetVersions(payload: unknown): AssetVersion[] {
  const values =
    Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.versions)
        ? payload.versions
        : [];
  return values.filter(isAssetVersion);
}

function getPreferredVersion(
  allVersions: AssetVersion[],
  fallback: AssetVersion | null,
): AssetVersion | null {
  const newestFirst = [...allVersions].sort(
    (a, b) => b.version_number - a.version_number,
  );
  return (
    newestFirst.find((version) => version.processing_status === "ready") ??
    newestFirst[0] ??
    fallback
  );
}

function shouldPollVersion(version: AssetVersion | null | undefined): boolean {
  return (
    version?.processing_status === "uploading" ||
    version?.processing_status === "queued" ||
    version?.processing_status === "processing"
  );
}

function getRefreshedCurrentVersion(
  assetId: string,
  allVersions: AssetVersion[],
): AssetVersion | undefined {
  const currentVersion = useReviewStore.getState().currentVersion;
  return currentVersion?.asset_id === assetId
    ? allVersions.find((version) => version.id === currentVersion.id)
    : undefined;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ReviewProviderProps {
  assetId: string;
  shareToken?: string; // If set, uses share token API instead of authenticated API
  shareSession?: string | null;
  children: React.ReactNode;
}

export function ReviewProvider({
  assetId,
  shareToken,
  shareSession,
  children,
}: ReviewProviderProps) {
  const [asset, setAsset] = useState<AssetResponse | null>(null);
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pauseHandlerRef = useRef<(() => void) | null>(null);

  const { currentVersion, setCurrentAsset, setCurrentVersion, setPlayheadTime } =
    useReviewStore();

  // Track whether component is still mounted to avoid state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const shareSessionParam = shareSession ? `&share_session=${encodeURIComponent(shareSession)}` : "";
  const shareSessionQuery = shareSession ? `?share_session=${encodeURIComponent(shareSession)}` : "";

  const fetchAsset = useCallback(async () => {
    try {
      let data: AssetResponse;

      if (shareToken) {
        // Share mode: fetch stream info to build a pseudo asset
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const streamRes = await fetch(
          `${API_URL}/share/${shareToken}/stream/${assetId}?_=1${shareSessionParam}`,
          { credentials: "include" },
        );
        const streamData = streamRes.ok ? await streamRes.json() : null;
        let shareVersions: AssetVersion[] = [];
        const versionsRes = await fetch(
          `${API_URL}/share/${shareToken}/versions/${assetId}${shareSessionQuery}`,
          { credentials: "include" },
        );
        if (versionsRes.ok) {
          const versionsData: unknown = await versionsRes.json();
          shareVersions = parseAssetVersions(versionsData);
        }
        // Build pseudo asset from available data
        data = {
          id: assetId,
          name: streamData?.name || "Asset",
          description: null,
          asset_type: streamData?.asset_type || "image",
          status: "in_review",
          rating: null,
          assignee_id: null,
          folder_id: null,
          due_date: null,
          keywords: [],
          project_id: "",
          created_by: "",
          created_at: "",
          updated_at: "",
          deleted_at: null,
          stream_url: streamData?.url,
          thumbnail_url: streamData?.thumbnail_url,
          latest_version: streamData?.version_id
            ? {
                id: streamData.version_id,
                asset_id: assetId,
                version_number: 1,
                processing_status: "ready",
                created_by: "",
                created_at: "",
                deleted_at: null,
                files: [],
              }
            : null,
        } as AssetResponse;
        if (!mountedRef.current) return;
        setVersions(shareVersions);

        const refreshedCurrentVersion = getRefreshedCurrentVersion(
          assetId,
          shareVersions,
        );
        if (refreshedCurrentVersion) {
          setCurrentVersion(refreshedCurrentVersion);
        } else {
          const preferredVersion = getPreferredVersion(
            shareVersions,
            data.latest_version,
          );
          if (preferredVersion) {
            setCurrentVersion(preferredVersion);
          }
        }
      } else {
        // Normal mode: authenticated API
        data = await api.get<AssetResponse>(`/assets/${assetId}`);
      }

      if (!mountedRef.current) return;
      setAsset(data);
      setCurrentAsset(data);

      if (!shareToken) {
        // Fetch all versions for the version switcher (not available in share mode)
        const allVersions = await api.get<AssetVersion[]>(
          `/assets/${assetId}/versions`,
        );
        if (!mountedRef.current) return;
        setVersions(allVersions ?? []);

        const refreshedCurrentVersion = getRefreshedCurrentVersion(
          assetId,
          allVersions ?? [],
        );
        if (refreshedCurrentVersion) {
          setCurrentVersion(refreshedCurrentVersion);
        } else {
          const preferredVersion = getPreferredVersion(
            allVersions ?? [],
            data.latest_version,
          );
          if (preferredVersion) {
            setCurrentVersion(preferredVersion);
          }
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load asset");
    }
  }, [assetId, shareToken, shareSessionParam, shareSessionQuery, setCurrentAsset, setCurrentVersion]);

  const fetchComments = useCallback(async () => {
    try {
      let data: Comment[];
      if (shareToken) {
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(
          `${API_URL}/share/${shareToken}/comments?asset_id=${assetId}${shareSessionParam}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const json = await res.json();
          // Handle both formats: array directly or {comments: [...]}
          data = Array.isArray(json) ? json : (json.comments ?? []);
        } else {
          data = [];
        }
      } else {
        data = await api.get<Comment[]>(`/assets/${assetId}/comments`);
      }
      if (!mountedRef.current) return;
      setComments(data ?? []);
    } catch {
      // Comments failing silently — asset is still viewable
    }
  }, [assetId, shareToken, shareSessionParam]);

  const refetchComments = useCallback(async () => {
    await fetchComments();
  }, [fetchComments]);

  const refetchVersions = useCallback(async () => {
    try {
      let allVersions: AssetVersion[];
      if (shareToken) {
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(
          `${API_URL}/share/${shareToken}/versions/${assetId}${shareSessionQuery}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const json: unknown = await res.json();
        allVersions = parseAssetVersions(json);
      } else {
        allVersions = await api.get<AssetVersion[]>(`/assets/${assetId}/versions`);
      }
      if (!mountedRef.current) return;
      setVersions(allVersions ?? []);
      const refreshedCurrentVersion = getRefreshedCurrentVersion(
        assetId,
        allVersions ?? [],
      );
      if (refreshedCurrentVersion) {
        setCurrentVersion(refreshedCurrentVersion);
      } else {
        const preferredVersion = getPreferredVersion(allVersions ?? [], null);
        if (preferredVersion) setCurrentVersion(preferredVersion);
      }
    } catch {
      // ignore
    }
  }, [assetId, shareToken, shareSessionQuery, setCurrentVersion]);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    Promise.all([fetchAsset(), fetchComments()]).finally(() => {
      if (mountedRef.current) setIsLoading(false);
    });
  }, [fetchAsset, fetchComments]);

  useEffect(() => {
    const pollProcessing =
      versions.some(
        (version) => version.asset_id === assetId && shouldPollVersion(version),
      ) ||
      (currentVersion?.asset_id === assetId && shouldPollVersion(currentVersion));
    if (!pollProcessing) return;

    // Transcodes finish server-side, so refresh until processing settles.
    const intervalId = window.setInterval(() => {
      void fetchAsset();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [assetId, currentVersion, fetchAsset, versions]);

  const addComment = useCallback(
    async (payload: CreateCommentPayload): Promise<Comment> => {
      let comment: Comment;
      if (shareToken) {
        const API_URL =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        // Include guest identity if available (for non-authenticated users)
        const guestFields: Record<string, string> = {};
        try {
          const stored = localStorage.getItem("ff_guest_identity");
          if (stored) {
            const guest = JSON.parse(stored);
            guestFields.guest_name = guest.name;
            guestFields.guest_email = guest.email;
          }
        } catch {}
        const res = await fetch(`${API_URL}/share/${shareToken}/comment?_=1${shareSessionParam}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...payload, ...guestFields, asset_id: assetId }),
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to post comment");
        comment = await res.json();
      } else {
        comment = await api.post<Comment>(
          `/assets/${assetId}/comments`,
          payload,
        );
      }
      if (mountedRef.current) {
        setComments((prev) => [...prev, comment]);
      }
      return comment;
    },
    [assetId, shareSessionParam, shareToken],
  );

  const resolveComment = useCallback(
    async (commentId: string): Promise<void> => {
      await api.post(`/comments/${commentId}/resolve`);
      if (mountedRef.current) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)),
        );
      }
    },
    [],
  );

  const seekTo = useCallback(
    (time: number) => {
      setPlayheadTime(time);
    },
    [setPlayheadTime],
  );

  const pauseVideo = useCallback(() => {
    if (pauseHandlerRef.current) {
      pauseHandlerRef.current();
    }
  }, []);

  const registerPauseHandler = useCallback((handler: () => void) => {
    pauseHandlerRef.current = handler;
  }, []);

  const value = useMemo<ReviewContextValue>(
    () => ({
      assetId,
      asset,
      shareToken,
      shareSession,
      versions,
      comments,
      isLoading,
      error,
      addComment,
      resolveComment,
      seekTo,
      refetchComments,
      refetchVersions,
      pauseVideo,
      registerPauseHandler,
    }),
    [
      assetId,
      asset,
      shareToken,
      shareSession,
      versions,
      comments,
      isLoading,
      error,
      addComment,
      resolveComment,
      seekTo,
      refetchComments,
      refetchVersions,
      pauseVideo,
      registerPauseHandler,
    ],
  );

  return (
    <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) {
    throw new Error("useReview must be used inside <ReviewProvider>");
  }
  return ctx;
}
