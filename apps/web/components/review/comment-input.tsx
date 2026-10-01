"use client";

import * as React from "react";
import {
  Pencil,
  Paperclip,
  X,
  Send,
  Smile,
  Clock,
  ChevronLeft,
  ChevronDown,
  MousePointer,
  Square,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  Globe,
  Lock,
  Scissors,
  Film,
  Check,
} from "lucide-react";
import { cn, formatTime, formatTimecode, formatFrames } from "@/lib/utils";
import { formatRange, formatSpan } from "@/lib/cuts";
import { useReviewStore } from "@/stores/review-store";
import { useReview } from "./review-provider";
import { useDrawing } from "@/hooks/use-drawing";
import { api } from "@/lib/api";
import type { User } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type CommentVisibility = "public" | "internal";

const COMMENT_VISIBILITY_STORAGE_KEY = "ff-comment-visibility";

export interface CommentDraft {
  body: string;
  timecodeStart?: number;
  timecodeEnd?: number;
  annotation?: Record<string, unknown>;
  parentId?: string;
  visibility?: CommentVisibility;
  mentionUserIds?: string[];
  attachments?: File[];
  /** Called as each attachment uploads, with that file's 0..1 fraction */
  onAttachmentProgress?: (index: number, fraction: number) => void;
  /** The range should come out of the edit */
  isCut?: boolean;
}

// Attachments upload as-is (no transcode); the API enforces the same caps.
const ATTACHMENT_LIMIT_BYTES: Record<string, number> = {
  image: 25 * 1024 * 1024,
  video: 250 * 1024 * 1024,
};

interface CommentInputProps {
  assetId: string;
  projectId: string;
  assetType?: string;
  replyToId?: string | null;
  annotationData?: Record<string, unknown> | null;
  onSubmit: (draft: CommentDraft) => Promise<void>;
  onCancelReply?: () => void;
  onPauseVideo?: () => void;
  visibilityLocked?: boolean;
  className?: string;
}

// ─── Drawing tools config ─────────────────────────────────────────────────────

const EMOJIS = [
  "👍",
  "👎",
  "❤️",
  "🔥",
  "👀",
  "🎉",
  "😂",
  "😮",
  "😢",
  "💯",
  "✅",
  "❌",
  "⭐",
  "💡",
  "🤔",
  "👏",
];

type DrawingTool = "pen" | "rectangle" | "arrow" | "line";

const DRAW_TOOLS: {
  id: DrawingTool;
  icon: React.ElementType;
  label: string;
}[] = [
  { id: "pen", icon: Pencil, label: "Pencil" },
  { id: "arrow", icon: MousePointer, label: "Arrow" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "rectangle", icon: Square, label: "Rectangle" },
];

const DRAW_COLORS = [
  "#AF52DE", // purple
  "#FF9500", // orange
  "#34C759", // green
  "#FF3B30", // red
];

// ─── @mention dropdown ────────────────────────────────────────────────────────

function MentionDropdown({
  query,
  projectId,
  onSelect,
}: {
  query: string;
  projectId: string;
  onSelect: (user: User) => void;
  onClose: () => void;
}) {
  const [members, setMembers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .get<Array<{ user_id: string; role: string }>>(
        `/projects/${projectId}/members`,
      )
      .then(async (memberList) => {
        if (!memberList || memberList.length === 0) {
          setMembers([]);
          return;
        }
        const userIds = memberList.map((m) => m.user_id).join(",");
        const users = await api.get<User[]>(`/users?ids=${userIds}`);
        setMembers(users);
      })
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const filtered = members.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="px-3 py-2 text-[12px] text-text-tertiary">Loading members…</div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="py-2 px-4 text-xs text-text-tertiary">
        No members found
      </div>
    );
  }

  return (
    <>
      {filtered.map((user) => (
        <button
          key={user.id}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(user);
          }}
        >
          <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-text-primary font-semibold shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="font-medium truncate text-[13px]">{user.name}</div>
            <div className="text-[11px] text-text-tertiary truncate">
              {user.email}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

// ─── Pending attachment thumbnail ────────────────────────────────────────────

function AttachmentThumb({ file }: { file: File }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!src) return null;
  if (file.type.startsWith("video/")) {
    return (
      <div className="relative h-full w-full bg-black">
        <video src={src} muted preload="metadata" className="h-full w-full object-cover" />
        <Film className="absolute left-1 bottom-1 h-3 w-3 text-white/80" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={file.name} className="h-full w-full object-cover" />;
}

// ─── Comment input component (Frame.io style) ───────────────────────────────

export function CommentInput({
  assetId,
  projectId,
  assetType,
  replyToId,
  annotationData,
  onSubmit,
  onCancelReply,
  onPauseVideo,
  visibilityLocked = false,
  className,
}: CommentInputProps) {
  const {
    isDrawingMode,
    drawingTool,
    drawingColor,
    playheadTime,
    rangeStart,
    rangeEnd,
    timeFormat,
    pendingAnnotation,
    toggleDrawingMode,
    setIsDrawingMode,
    setDrawingTool,
    setDrawingColor,
    setRangeStart,
    clearRange,
    setPendingAnnotation,
    setActiveAnnotation,
  } = useReviewStore();

  const { pauseVideo } = useReview();

  const { clear, undo, getJSON } = useDrawing();

  const [body, setBody] = React.useState("");
  const [mentionUserIds, setMentionUserIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [commentVisibility, setCommentVisibility] =
    React.useState<CommentVisibility>(
      visibilityLocked ? "public" : "internal",
    );
  const [visDropdownOpen, setVisDropdownOpen] = React.useState(false);
  const [timecodeAttached, setTimecodeAttached] = React.useState(true);
  const visRef = React.useRef<HTMLDivElement>(null);

  // Emoji picker state
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const emojiRef = React.useRef<HTMLDivElement>(null);

  // Mention state
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionStart, setMentionStart] = React.useState<number>(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Pending image attachments (guests can't upload — the endpoint needs auth)
  const canAttach = !visibilityLocked;
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  // Per-file upload fraction while posting; null when nothing is uploading
  const [uploadProgress, setUploadProgress] = React.useState<number[] | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const limit = ATTACHMENT_LIMIT_BYTES[file.type.split("/")[0]];
      if (!limit) {
        setError(`${file.name}: attach images or videos only`);
      } else if (file.size > limit) {
        setError(`${file.name} is over ${limit / (1024 * 1024)} MB`);
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length) setPendingFiles((prev) => [...prev, ...accepted]);
  }

  React.useEffect(() => {
    if (visibilityLocked) {
      setCommentVisibility("public");
      setVisDropdownOpen(false);
      return;
    }

    try {
      const storedVisibility = localStorage.getItem(
        COMMENT_VISIBILITY_STORAGE_KEY,
      );
      if (storedVisibility === "internal" || storedVisibility === "public") {
        setCommentVisibility(storedVisibility);
      }
    } catch {
      return;
    }
  }, [visibilityLocked]);

  // Close dropdowns on outside click
  React.useEffect(() => {
    if (!visDropdownOpen && !emojiOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        visDropdownOpen &&
        visRef.current &&
        !visRef.current.contains(e.target as Node)
      )
        setVisDropdownOpen(false);
      if (
        emojiOpen &&
        emojiRef.current &&
        !emojiRef.current.contains(e.target as Node)
      )
        setEmojiOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [visDropdownOpen, emojiOpen]);

  // Ctrl/Cmd+Z undoes the last stroke while annotating (text fields keep native undo)
  React.useEffect(() => {
    if (!isDrawingMode) return;
    function handleUndoKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      undo();
    }
    document.addEventListener("keydown", handleUndoKey);
    return () => document.removeEventListener("keydown", handleUndoKey);
  }, [isDrawingMode, undo]);

  const canAnnotate = assetType !== "audio";
  const hasTimecode = assetType === "video" || assetType === "audio";
  // Cuts are a member tool on timed media; guests and replies only comment.
  // The I/O range (either end may follow the playhead until it's marked)
  const rangeActive = rangeStart !== null || rangeEnd !== null;
  const markedRange = (() => {
    if (!hasTimecode || !timecodeAttached || !rangeActive) return null;
    const inPoint = rangeStart ?? playheadTime;
    const outPoint = rangeEnd ?? playheadTime;
    if (inPoint === outPoint) return null;
    return { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) };
  })();
  // How we work: an I/O range is a cut (members only; guests and replies just comment)
  const isCut = markedRange !== null && !visibilityLocked && !replyToId;
  const canSubmit = isCut || body.trim().length > 0;
  // Overall upload percent, weighted by file size
  const uploadPercent = (() => {
    if (!uploadProgress) return null;
    const total = pendingFiles.reduce((sum, f) => sum + f.size, 0) || 1;
    const sent = pendingFiles.reduce((sum, f, i) => sum + f.size * (uploadProgress[i] ?? 0), 0);
    return Math.floor((sent / total) * 100);
  })();

  function displayTime(seconds: number): string {
    switch (timeFormat) {
      case "frames":
        return formatFrames(seconds);
      case "standard":
        return formatTime(seconds);
      case "timecode":
        return formatTimecode(seconds);
      default:
        return formatTimecode(seconds);
    }
  }
  const hasAnnotation =
    !!(annotationData && Object.keys(annotationData).length > 0) ||
    !!(pendingAnnotation && (pendingAnnotation as any)?.objects?.length > 0);

  // Exit drawing mode and clear all annotation state
  function exitDrawingMode() {
    setPendingAnnotation(null);
    clear();
    toggleDrawingMode();
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);

    const cursor = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursor);
    const atIdx = textBeforeCursor.lastIndexOf("@");

    if (atIdx !== -1) {
      const afterAt = textBeforeCursor.slice(atIdx + 1);
      if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
        setMentionQuery(afterAt);
        setMentionStart(atIdx);
        return;
      }
    }
    setMentionQuery(null);
  }

  function handleMentionSelect(user: User) {
    const before = body.slice(0, mentionStart);
    const after = body.slice(mentionStart + 1 + (mentionQuery?.length ?? 0));
    setBody(`${before}@${user.name} ${after}`);
    setMentionUserIds((prev) =>
      prev.includes(user.id) ? prev : [...prev, user.id],
    );
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") setMentionQuery(null);
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function selectCommentVisibility(visibility: CommentVisibility) {
    setCommentVisibility(visibility);
    setVisDropdownOpen(false);
    try {
      localStorage.setItem(COMMENT_VISIBILITY_STORAGE_KEY, visibility);
    } catch {
      return;
    }
  }

  async function handleSubmit() {
    const trimmed = body.trim();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    if (pendingFiles.length > 0) setUploadProgress(pendingFiles.map(() => 0));

    try {
      // Grab canvas state: try live canvas first, then store, then prop
      let finalAnnotation: Record<string, unknown> | undefined = undefined;

      if (isDrawingMode) {
        try {
          const json = getJSON();
          const objects = (json as any)?.objects;
          if (objects && Array.isArray(objects) && objects.length > 0) {
            finalAnnotation = json;
          }
        } catch {
          /* canvas may not exist */
        }
        exitDrawingMode();
      } else {
        try {
          const json = getJSON();
          const objects = (json as any)?.objects;
          if (objects && Array.isArray(objects) && objects.length > 0) {
            finalAnnotation = json;
          }
        } catch {
          /* canvas may not exist */
        }
      }

      if (!finalAnnotation && pendingAnnotation) {
        const objs = (pendingAnnotation as any)?.objects;
        if (objs && Array.isArray(objs) && objs.length > 0) {
          finalAnnotation = pendingAnnotation;
        }
      }

      if (!finalAnnotation && annotationData) {
        finalAnnotation = annotationData;
      }

      const attachTime =
        hasTimecode && timecodeAttached && (playheadTime > 0 || rangeActive);
      let timecodeStart: number | undefined;
      let timecodeEnd: number | undefined;
      if (markedRange) {
        timecodeStart = markedRange.start;
        timecodeEnd = markedRange.end;
      } else if (attachTime) {
        // A range collapsed to one point is a point comment at that point
        timecodeStart = rangeActive ? (rangeStart ?? rangeEnd ?? playheadTime) : playheadTime;
      }

      await onSubmit({
        body: trimmed,
        timecodeStart,
        timecodeEnd,
        annotation: finalAnnotation,
        parentId: replyToId ?? undefined,
        visibility: commentVisibility,
        mentionUserIds: mentionUserIds.length > 0 ? mentionUserIds : undefined,
        attachments: pendingFiles.length > 0 ? pendingFiles : undefined,
        onAttachmentProgress: (index, fraction) =>
          setUploadProgress((prev) => prev && prev.map((v, i) => (i === index ? fraction : v))),
        isCut: isCut || undefined,
      });

      setBody("");
      setPendingFiles([]);
      clearRange();
      setMentionUserIds([]);
      setPendingAnnotation(null);
      clear(); // Clear Fabric.js canvas so stale annotations don't attach to next comment
      setIsDrawingMode(false); // Exit drawing mode after submitting annotation
      setActiveAnnotation(null); // Clear any active annotation overlay
      if (replyToId && onCancelReply) onCancelReply();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  return (
    <div
      className={cn(
        "border-t border-border bg-bg-secondary shrink-0",
        className,
      )}
    >
      {/* Reply indicator */}
      {replyToId && (
        <div className="flex items-center justify-between px-4 py-2 bg-accent/5 border-b border-accent/10 text-xs text-accent">
          <span>Replying to comment</span>
          <button
            className="text-text-tertiary hover:text-text-primary"
            onClick={onCancelReply}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pt-3 pb-2">
        <div
          className="relative"
          onDragOver={(e) => {
            if (!canAttach || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(e) => {
            if (!canAttach || e.dataTransfer.files.length === 0) return;
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <div
            className={cn(
              "flex items-start gap-0 rounded-lg border border-border bg-bg-tertiary focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20",
              dragOver && "border-dashed border-accent bg-accent-muted",
            )}
          >
            {/* Inline timecode badge — show when timecode attached (normal mode) or in drawing mode */}
            {hasTimecode && (timecodeAttached || isDrawingMode) && (
              <span
                className={cn(
                  "shrink-0 ml-2.5 mt-2.5 flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0 font-mono text-[11px] leading-[19.5px] select-none",
                  // Red only when a range is actively marked; quiet mono at rest
                  rangeStart !== null || rangeEnd !== null
                    ? "bg-accent-muted border-accent-line text-accent"
                    : "bg-bg-secondary border-border text-text-secondary",
                )}
              >
                {rangeStart !== null || rangeEnd !== null ? (
                  // Range mode: the range is the cut (scissors) for members
                  <>
                    {isCut && <Scissors className="h-3 w-3" aria-label="Cut" />}
                    {markedRange
                      ? formatRange(markedRange.start, markedRange.end)
                      : formatTime(rangeStart ?? rangeEnd ?? playheadTime)}
                    <button
                      onClick={() => clearRange()}
                      className="ml-0.5 text-accent/60 hover:text-accent transition-colors"
                      title="Clear range"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    {displayTime(playheadTime)}
                    <button
                      onClick={() => setRangeStart(playheadTime)}
                      className="ml-0.5 text-text-tertiary hover:text-text-primary transition-colors"
                      title="Set range start (I)"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </>
                )}
              </span>
            )}
            <textarea
              ref={textareaRef}
              className="flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none min-h-[38px] max-h-[120px]"
              placeholder={
                replyToId
                  ? "Write a reply..."
                  : isCut
                    ? "Why cut this? (optional)"
                    : "Leave your comment..."
              }
              value={body}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                if (canAttach && e.clipboardData.files.length > 0) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                }
              }}
              onClick={() => {
                pauseVideo();
                onPauseVideo?.();
              }}
              rows={1}
            />
          </div>

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-bg-secondary/85 text-[13px] text-text-primary">
              Drop to attach
            </div>
          )}

          {/* Mention dropdown */}
          {mentionQuery !== null && (
            <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-lg border border-border bg-bg-elevated shadow-xl max-h-48 overflow-y-auto animate-ff-rise-in">
              <MentionDropdown
                query={mentionQuery}
                projectId={projectId}
                onSelect={handleMentionSelect}
                onClose={() => setMentionQuery(null)}
              />
            </div>
          )}
        </div>

        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}

        {/* Pending attachment previews */}
        {pendingFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingFiles.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="relative h-14 w-14 rounded-md border border-border overflow-hidden group/att"
              >
                <AttachmentThumb file={file} />
                {uploadProgress && uploadProgress[i] < 1 && (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 font-mono text-[11px] text-white">
                      {Math.floor(uploadProgress[i] * 100)}%
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
                      <div className="h-full bg-accent" style={{ width: `${uploadProgress[i] * 100}%` }} />
                    </div>
                  </>
                )}
                {uploadProgress && uploadProgress[i] >= 1 && (
                  <span className="absolute right-0.5 bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-text-primary text-text-inverse">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
                {!uploadProgress && (
                  <button
                    onClick={() =>
                      setPendingFiles((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="absolute top-0.5 right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover/att:opacity-100 transition-opacity"
                    title="Remove"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="px-4 pb-3">
        {canAnnotate && isDrawingMode ? (
          /* ─── Drawing toolbar ─── */
          <div className="flex items-center gap-1">
            <button
              onClick={() => exitDrawingMode()}
              className="h-7 w-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
              title="Exit drawing"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="w-px h-4 bg-white/10 mx-0.5" />

            {DRAW_TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setDrawingTool(tool.id as DrawingTool)}
                  title={tool.label}
                  className={cn(
                    "h-7 w-7 flex items-center justify-center rounded-md transition-colors",
                    drawingTool === tool.id
                      ? "bg-accent/15 text-accent"
                      : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}

            <div className="w-px h-4 bg-white/10 mx-0.5" />

            {DRAW_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setDrawingColor(color)}
                className={cn(
                  "w-5 h-5 rounded-full transition-all shrink-0",
                  drawingColor === color
                    ? "ring-2 ring-accent ring-offset-1 ring-offset-bg-secondary"
                    : "hover:scale-110",
                )}
                style={{ backgroundColor: color }}
              />
            ))}

            <div className="w-px h-4 bg-white/10 mx-0.5" />

            <button
              onClick={undo}
              className="h-7 w-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary transition-colors"
              title="Undo"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={clear}
              className="h-7 w-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary transition-colors"
              title="Clear"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          /* ─── Default toolbar (Frame.io style) ─── */
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {/* Timecode attach toggle — for video/audio */}
              {hasTimecode && (
                <button
                  className={cn(
                    "h-7 w-7 flex items-center justify-center rounded-md transition-colors",
                    timecodeAttached
                      ? "text-accent bg-accent-muted"
                      : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary",
                  )}
                  onClick={() => {
                    setTimecodeAttached((p) => !p);
                    clearRange();
                  }}
                  title={
                    timecodeAttached ? "Detach timecode" : "Attach timecode"
                  }
                >
                  <Clock className="h-4 w-4" />
                </button>
              )}

              {/* Draw annotation — hidden for audio */}
              {canAnnotate && (
                <button
                  className={cn(
                    "h-7 w-7 flex items-center justify-center rounded-md transition-colors",
                    hasAnnotation
                      ? "text-accent bg-accent/10"
                      : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary",
                  )}
                  onClick={() => toggleDrawingMode()}
                  title="Draw annotation"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}

              {/* Emoji */}
              <div className="relative" ref={emojiRef}>
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary transition-colors"
                  title="Add emoji"
                  onClick={() => setEmojiOpen((p) => !p)}
                >
                  <Smile className="h-4 w-4" />
                </button>
                {emojiOpen && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 rounded-lg border border-border bg-bg-elevated shadow-2xl p-1.5 duration-100 w-[200px] animate-ff-rise-in">
                    <div className="grid grid-cols-8 gap-px">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          className="h-6 w-6 rounded flex items-center justify-center text-sm hover:bg-bg-hover transition-colors"
                          onClick={() => {
                            setBody((prev) => prev + e);
                            setEmojiOpen(false);
                            textareaRef.current?.focus();
                          }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Attach image */}
              {canAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="h-7 w-7 flex items-center justify-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary transition-colors"
                    title="Attach image or video"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Visibility dropdown */}
              <div className="relative" ref={visRef}>
                <button
                  onClick={() => {
                    if (!visibilityLocked) setVisDropdownOpen((p) => !p);
                  }}
                  disabled={visibilityLocked}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] transition-colors border",
                    commentVisibility === "internal"
                      ? "text-accent border-accent-line bg-accent-muted"
                      : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary border-border",
                  )}
                >
                  {commentVisibility === "internal" ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <Globe className="h-3 w-3" />
                  )}
                  {commentVisibility === "internal" ? "Internal" : "Public"}
                  {!visibilityLocked && <ChevronDown className="h-3 w-3" />}
                </button>
                {!visibilityLocked && visDropdownOpen && (
                  <div className="absolute bottom-full right-0 mb-1 z-50 w-44 rounded-xl border border-border bg-bg-elevated shadow-2xl py-1.5 duration-100 animate-ff-rise-in">
                    <button
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
                        commentVisibility === "public"
                          ? "text-text-primary bg-bg-tertiary"
                          : "text-text-secondary hover:bg-bg-tertiary",
                      )}
                      onClick={() => selectCommentVisibility("public")}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      Public
                    </button>
                    <button
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
                        commentVisibility === "internal"
                          ? "text-accent bg-bg-tertiary"
                          : "text-text-secondary hover:bg-bg-tertiary",
                      )}
                      onClick={() => selectCommentVisibility("internal")}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Internal
                    </button>
                  </div>
                )}
              </div>

              {/* Submit: disabled while posting, no spinner */}
              {isCut ? (
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  className="inline-flex h-7 items-center rounded-md bg-text-primary px-2.5 text-[12px] font-medium text-text-inverse hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {uploadPercent !== null ? `${uploadPercent}%` : submitting ? "Adding…" : "Add cut"}
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  className={cn(
                    "inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent text-text-primary hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors",
                    uploadPercent !== null && "px-1.5 disabled:opacity-100",
                  )}
                  title="Send (Enter)"
                >
                  {uploadPercent !== null ? (
                    <span className="font-mono text-[10px] tabular-nums">{uploadPercent}%</span>
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
