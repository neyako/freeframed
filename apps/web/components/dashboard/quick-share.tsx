"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, Film, Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/review/share-link-control-primitives";
import {
  requestLink,
  withLinkDefaults,
} from "@/components/review/share-link-requests";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { useUploadStore } from "@/stores/upload-store";
import type { AssetResponse, Project } from "@/types";
import type { ManagedShareLink } from "@/components/review/share-targets";

const QUICK_SHARE_NAME = "Quick Shares";

function getShareUrl(link: ManagedShareLink) {
  return (
    link.url ??
    `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`
  );
}

export function QuickShare() {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const projectRequestRef = React.useRef<Promise<Project> | null>(null);
  const requestedShareAssetId = React.useRef<string | null>(null);
  const [project, setProject] = React.useState<Project | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);
  const [uploadId, setUploadId] = React.useState<string | null>(null);
  const [shareLink, setShareLink] = React.useState<ManagedShareLink | null>(null);
  const [shareLoading, setShareLoading] = React.useState(false);
  const [shareError, setShareError] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const { files, startUpload } = useUploadStore();
  const activeUpload = files.find((file) => file.id === uploadId);
  const assetId = activeUpload?.assetId ?? null;
  const shareUrl = shareLink ? getShareUrl(shareLink) : null;

  const ensureQuickShareProject = React.useCallback(async () => {
    if (project) return project;
    if (!projectRequestRef.current) {
      setProjectError(null);
      projectRequestRef.current = api
        .post<Project>("/projects/quick-share")
        .then((nextProject) => {
          setProject(nextProject);
          return nextProject;
        })
        .catch((err) => {
          setProjectError(err instanceof Error ? err.message : "Failed to prepare Quick Shares");
          throw err;
        })
        .finally(() => {
          projectRequestRef.current = null;
        });
    }
    return projectRequestRef.current;
  }, [project]);

  React.useEffect(() => {
    void ensureQuickShareProject().catch((err: unknown) => {
      if (err instanceof Error) return;
      throw err;
    });
  }, [ensureQuickShareProject]);

  const {
    data: recentAssets,
    isLoading: loadingAssets,
    mutate: mutateAssets,
  } = useSWR<AssetResponse[]>(
    project ? `/projects/${project.id}/assets?folder_id=root` : null,
    (key: string) => api.get<AssetResponse[]>(key),
    { revalidateOnFocus: false },
  );

  React.useEffect(() => {
    if (!assetId || activeUpload?.status !== "complete") return;
    if (requestedShareAssetId.current === assetId) return;
    requestedShareAssetId.current = assetId;
    setShareLoading(true);
    setShareError(null);
    setShareLink(null);
    void mutateAssets();
    void requestLink({ kind: "asset", id: assetId })
      .then((link) => setShareLink(withLinkDefaults(link)))
      .catch((err) => {
        setShareError(
          err instanceof Error ? err.message : "Failed to create share link",
        );
      })
      .finally(() => setShareLoading(false));
  }, [activeUpload?.status, assetId, mutateAssets]);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setFileError("Choose a video file.");
      return;
    }

    setFileError(null);
    setShareError(null);
    setShareLink(null);
    requestedShareAssetId.current = null;

    let quickProject: Project;
    try {
      quickProject = await ensureQuickShareProject();
    } catch (err) {
      if (err instanceof Error) return;
      throw err;
    }

    const nextUploadId = startUpload(file, quickProject.id, file.name, QUICK_SHARE_NAME);
    setUploadId(nextUploadId);
  }

  function handleDropZoneKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    inputRef.current?.click();
  }

  function handleChooseClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    inputRef.current?.click();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void handleFile(event.dataTransfer.files[0] ?? null);
  }

  const progress =
    activeUpload?.status === "processing"
      ? activeUpload.processingProgress
      : activeUpload?.progress;
  const uploadError =
    activeUpload?.status === "failed"
      ? activeUpload.error ?? "Upload failed"
      : null;
  const message = projectError ?? fileError ?? uploadError ?? shareError;
  const recent = recentAssets?.slice(0, 5) ?? [];

  return (
    <section className="rounded-lg border border-border bg-bg-secondary p-5">
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="flex-1 space-y-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">Quick share</p>
            <h2 className="mt-1 text-lg font-semibold text-text-primary">Upload one video and send a link</h2>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={handleDropZoneKeyDown}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-bg-primary px-4 py-8 text-center transition-colors hover:border-text-secondary"
          >
            <UploadCloud className="h-9 w-9 text-text-tertiary" />
            <div>
              <p className="text-sm font-medium text-text-primary">Drop a video here</p>
              <p className="mt-1 text-xs text-text-tertiary">Or choose a file from your device</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={handleChooseClick}>
              Choose video
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="sr-only"
              aria-label="Choose video"
              onChange={(event) => {
                void handleFile(event.currentTarget.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </div>

          {message && (
            <div className="flex items-start gap-2 rounded border border-accent-line bg-accent-muted px-3 py-2 text-xs text-accent">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">
                <p>{message}</p>
              </div>
            </div>
          )}

          {activeUpload && (
            <div className="rounded border border-border bg-bg-primary px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-text-primary">{activeUpload.fileName}</p>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{activeUpload.status}</span>
              </div>
              {typeof progress === "number" && activeUpload.status !== "failed" && (
                <div className="mt-3 h-1 rounded-full bg-bg-hover">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
                </div>
              )}
            </div>
          )}

          {(shareLoading || shareUrl) && assetId && (
            <div className="rounded border border-border bg-bg-primary">
              {shareLoading ? (
                <div className="flex items-center gap-2 px-3 py-3 font-mono text-xs text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
                  Preparing share link...
                </div>
              ) : shareUrl ? (
                <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">Share URL</p>
                    <p className="mt-1 truncate font-mono text-xs text-text-secondary">{shareUrl}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <CopyButton text={shareUrl} disabled={false} />
                    <Button asChild variant="secondary" size="md">
                      <Link href={`/assets/${assetId}`}>Open asset</Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="w-full border-t border-border pt-4 lg:w-[340px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">Recent quick shares</p>
            {loadingAssets && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />}
          </div>

          <div className="mt-3 space-y-1.5">
            {!loadingAssets && recent.length === 0 ? (
              <p className="rounded border border-border bg-bg-primary px-3 py-3 text-xs text-text-tertiary">Uploaded videos will appear here.</p>
            ) : (
              recent.map((asset) => (
                <Link key={asset.id} href={`/assets/${asset.id}`} className="flex items-center gap-3 rounded border border-border bg-bg-primary px-3 py-2.5 transition-colors hover:border-border-strong">
                  <Film className="h-4 w-4 shrink-0 text-text-tertiary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{asset.name}</p>
                    <p className="mt-0.5 text-xs text-text-tertiary">{formatRelativeTime(asset.updated_at)}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
