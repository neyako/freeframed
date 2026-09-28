"use client";

import * as React from "react";
import Link from "next/link";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProgressTrack } from "@/components/ui/progress";
import { CopyButton } from "@/components/review/share-link-control-primitives";
import { api } from "@/lib/api";
import {
  getUploadDisplayProgress,
  useUploadStore,
  type UploadStatus,
} from "@/stores/upload-store";
import type { Project } from "@/types";

const QUICK_SHARE_NAME = "Quick Shares";

export function QuickShare() {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const projectRequestRef = React.useRef<Promise<Project> | null>(null);
  const [project, setProject] = React.useState<Project | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);
  const [uploadId, setUploadId] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  // "video" while a video is dragged over the zone, "other" for anything else
  const [dragKind, setDragKind] = React.useState<"video" | "other" | null>(null);
  const dragDepth = React.useRef(0);
  const { files, startUpload } = useUploadStore();
  const activeUpload = files.find((file) => file.id === uploadId);
  const assetId = activeUpload?.assetId ?? null;
  const assetUrl =
    assetId && activeUpload?.status === "complete"
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/assets/${assetId}`
      : null;

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

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setFileError("Choose a video file.");
      return;
    }

    setFileError(null);

    let quickProject: Project;
    try {
      quickProject = await ensureQuickShareProject();
    } catch (err) {
      if (err instanceof Error) return;
      throw err;
    }

    const nextUploadId = startUpload(file, quickProject.id, file.name, QUICK_SHARE_NAME, null, {
      source: "quick-share",
    });
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

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    // File names aren't readable until drop, but item MIME types are
    const item = Array.from(event.dataTransfer.items).find((i) => i.kind === "file");
    setDragKind(!item || item.type.startsWith("video/") || item.type === "" ? "video" : "other");
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragKind(null);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragKind(null);
    void handleFile(event.dataTransfer.files[0] ?? null);
  }

  const progress = activeUpload ? getUploadDisplayProgress(activeUpload) : undefined;
  const uploadError =
    activeUpload?.status === "failed"
      ? activeUpload.error ?? "Upload failed"
      : null;
  const message = projectError ?? fileError ?? uploadError;

  const statusLabel: Record<UploadStatus, string> = {
    pending: "Queued",
    uploading: "Uploading",
    processing: "Processing",
    complete: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  };

  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-medium text-text-primary">Quick share</h2>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleDropZoneKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-3 py-3 transition-colors duration-100",
          dragKind === "video"
            ? "border-text-primary bg-white/[0.04]"
            : dragKind === "other"
              ? "border-accent/70"
              : "border-border-strong hover:border-text-secondary",
        )}
      >
        <Upload
          className={cn(
            "h-[15px] w-[15px] shrink-0 transition-[transform,color] duration-100",
            dragKind === "video" ? "-translate-y-0.5 text-text-primary" : "text-text-tertiary",
          )}
        />
        <p
          className={cn(
            "flex-1 text-[13px]",
            dragKind === "video" ? "text-text-primary" : dragKind === "other" ? "text-accent" : "text-text-secondary",
          )}
        >
          {dragKind === "video" ? "Release to upload" : dragKind === "other" ? "Videos only" : "Drop a video here"}
        </p>
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

      {message && <p className="text-[12px] text-accent">{message}</p>}

      {activeUpload && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 text-[13px]">
            <p className="min-w-0 flex-1 truncate text-text-primary">{activeUpload.fileName}</p>
            <span className="font-mono text-[12px] text-text-tertiary">
              {statusLabel[activeUpload.status]}
              {typeof progress === "number" &&
                (activeUpload.status === "uploading" || activeUpload.status === "processing") &&
                ` ${progress}%`}
            </span>
          </div>
          {typeof progress === "number" &&
            activeUpload.status !== "failed" &&
            activeUpload.status !== "complete" && <ProgressTrack value={progress} />}
        </div>
      )}

      {assetUrl && assetId && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">{assetUrl}</p>
          <CopyButton text={assetUrl} disabled={false} />
          <Button asChild variant="secondary" size="sm">
            <Link href={`/assets/${assetId}`}>Open asset</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
