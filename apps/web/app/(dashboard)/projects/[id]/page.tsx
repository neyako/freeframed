"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Upload,
  UploadCloud,
  X,
  Download,
  Share2,
  Plus,
  MessageSquare,
  FolderPlus,
  Folder as FolderIcon,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn, formatRelativeTime, formatBytes } from "@/lib/utils";
import { api } from "@/lib/api";
import { findVersionCandidate } from "@/lib/version-match";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/shared/avatar";
import { AssetGrid } from "@/components/projects/asset-grid";
import { CommentPanel } from "@/components/review/comment-panel";
import { UploadZone } from "@/components/upload/upload-zone";
import { useUploadStore } from "@/stores/upload-store";
import { useAuthStore } from "@/stores/auth-store";
import { useViewStore } from "@/stores/view-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { useComments } from "@/hooks/use-comments";
import { useFolders, useTrash } from "@/hooks/use-folders";
import { FolderTree } from "@/components/projects/folder-tree";
import { NameDialog } from "@/components/projects/name-dialog";
import {
  BulkSharePanel,
  SharePanel,
} from "@/components/review/share-dialog";
import { ProjectMembersDialog } from "@/components/projects/project-members-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePageTitle } from "@/hooks/use-page-title";
import type {
  Project,
  AssetResponse,
  ProjectMember,
  User,
  Folder,
} from "@/types";

type ActiveShare =
  | { kind: "project" }
  | { kind: "folder"; id: string; name: string }
  | { kind: "asset"; id: string; name: string }
  | { kind: "bulk"; assetIds: string[]; folderIds: string[]; title: string };

type VersionPrompt = {
  file: File;
  candidate: AssetResponse;
  newAssetName: string;
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.id as string;

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [assetName, setAssetName] = React.useState("");
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [selectedAsset, setSelectedAsset] =
    React.useState<AssetResponse | null>(null);
  const [rightTab, setRightTab] = React.useState<"comments" | "fields">(
    "comments",
  );
  const { rightPanelOpen, leftPanelOpen, toggleLeftPanel } = useViewStore();

  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(
    searchParams.get("folder") || null,
  );
  const [showTrash, setShowTrash] = React.useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [folderDialogParentId, setFolderDialogParentId] = React.useState<
    string | null
  >(null);
  const [activeShare, setActiveShare] = React.useState<ActiveShare | null>(null);
  const [shareMode, setShareMode] = React.useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = React.useState(false);
  const [pendingBulkDelete, setPendingBulkDelete] = React.useState<{
    assetIds: string[];
    folderIds: string[];
  } | null>(null);
  const [assetToRename, setAssetToRename] = React.useState<AssetResponse | null>(null);
  const [assetToDelete, setAssetToDelete] = React.useState<AssetResponse | null>(null);
  const [versionPrompt, setVersionPrompt] = React.useState<VersionPrompt | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = React.useState(false);
  const dragDepth = React.useRef(0);

  const { files: uploadFiles, startUpload, startVersionUpload } = useUploadStore();
  const { user } = useAuthStore();

  const {
    tree,
    mutateTree,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    moveAsset,
    bulkMove,
    restoreAsset,
    restoreFolder,
  } = useFolders(projectId);

  const { trash, mutateTrash } = useTrash(projectId);

  // Comments for the selected asset
  const selectedVersionId = selectedAsset?.latest_version?.id || null;
  const {
    comments,
    resolveComment,
    deleteComment,
    addReaction,
    removeReaction,
  } = useComments(selectedAsset?.id || null, selectedVersionId);

  const { data: project, isLoading: loadingProject } = useSWR<Project>(
    `/projects/${projectId}`,
    () => api.get<Project>(`/projects/${projectId}`),
  );

  // Register project name for header breadcrumb + page title
  usePageTitle(project?.name ?? null);
  const setLabel = useBreadcrumbStore((s) => s.setLabel);
  const setExtraCrumbs = useBreadcrumbStore((s) => s.setExtraCrumbs);
  React.useEffect(() => {
    if (project?.name) setLabel(projectId, project.name);
  }, [project?.name, projectId, setLabel]);

  // Push folder path as extra breadcrumb crumbs when navigating folders
  React.useEffect(() => {
    if (!currentFolderId || !tree) {
      setExtraCrumbs([]);
      return;
    }
    // Walk the tree to collect path nodes (id + name) to currentFolderId
    function findPath(
      nodes: typeof tree,
      targetId: string,
      trail: { id: string; name: string }[],
    ): { id: string; name: string }[] | null {
      for (const node of nodes) {
        const newTrail = [...trail, { id: node.id, name: node.name }]
        if (node.id === targetId) return newTrail
        const found = findPath(node.children, targetId, newTrail)
        if (found) return found
      }
      return null
    }
    const path = findPath(tree, currentFolderId, []) ?? []
    setExtraCrumbs(
      path.map((f) => ({ label: f.name, href: `/projects/${projectId}?folder=${f.id}` }))
    );
  }, [currentFolderId, tree, projectId, setExtraCrumbs]);

  const folderParam = currentFolderId
    ? `folder_id=${currentFolderId}`
    : "folder_id=root";
  const {
    data: assets,
    isLoading: loadingAssets,
    mutate: mutateAssets,
  } = useSWR<AssetResponse[]>(
    showTrash ? null : `/projects/${projectId}/assets?${folderParam}`,
    (key: string) => api.get<AssetResponse[]>(key),
  );

  // Subfolders for current view
  const { data: subfolders, mutate: mutateSubfolders } = useSWR<Folder[]>(
    showTrash
      ? null
      : `/projects/${projectId}/folders?parent_id=${currentFolderId ?? "root"}`,
    (key: string) => api.get<Folder[]>(key),
  );

  const thumbnails = React.useMemo(() => {
    if (!assets) return {};
    const map: Record<string, string> = {};
    for (const a of assets) {
      if (a.thumbnail_url) map[a.id] = a.thumbnail_url;
    }
    return map;
  }, [assets]);

  const versionCounts = React.useMemo(() => {
    if (!assets) return {};
    const map: Record<string, number> = {};
    for (const a of assets) {
      if (a.latest_version) map[a.id] = a.latest_version.version_number;
    }
    return map;
  }, [assets]);

  const fileSizes = React.useMemo(() => {
    if (!assets) return {};
    const map: Record<string, number> = {};
    for (const a of assets) {
      if (a.latest_version?.files?.length) {
        map[a.id] = a.latest_version.files.reduce(
          (sum, f) => sum + (f.file_size_bytes || 0),
          0,
        );
      }
    }
    return map;
  }, [assets]);

  // Fetch user info for asset authors
  const authorIds = React.useMemo(() => {
    if (!assets) return [];
    return Array.from(new Set(assets.map((a) => a.created_by)));
  }, [assets]);

  const { data: authorUsers } = useSWR<User[]>(
    authorIds.length > 0 ? `/users?ids=${authorIds.join(",")}` : null,
    () => api.get<User[]>(`/users?ids=${authorIds.join(",")}`),
  );

  const authorNames = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (authorUsers) {
      for (const u of authorUsers) map[u.id] = u.name;
    }
    // Fallback: current user
    if (user) map[user.id] = user.name;
    return map;
  }, [authorUsers, user]);

  const { data: members } = useSWR<ProjectMember[]>(
    `/projects/${projectId}/members`,
    () => api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  );

  const assigneeIds = React.useMemo(() => {
    if (!assets) return [];
    const ids = assets.map((a) => a.assignee_id).filter(Boolean) as string[];
    return Array.from(new Set(ids));
  }, [assets]);

  const { data: assigneeUsers } = useSWR<User[]>(
    assigneeIds.length > 0 ? `/users?ids=${assigneeIds.join(",")}` : null,
    () => api.get<User[]>(`/users?ids=${assigneeIds.join(",")}`),
  );

  const assigneesMap: Record<string, User> = React.useMemo(() => {
    if (!assigneeUsers) return {};
    return Object.fromEntries(assigneeUsers.map((u) => [u.id, u]));
  }, [assigneeUsers]);

  // ─── Role-based permissions ───────────────────────────────────────────────
  const currentMember = members?.find((m) => m.user_id === user?.id);
  const currentRole = currentMember?.role ?? "viewer";
  // owner → Full Access, editor → Edit & Share, reviewer → Comment Only, viewer → View Only
  const canUpload = currentRole === "owner" || currentRole === "editor";
  const canCreateFolder = currentRole === "owner" || currentRole === "editor";
  const canShare = currentRole === "owner" || currentRole === "editor";
  const canManageMembers = currentRole === "owner";
  const canComment = currentRole !== "viewer";

  function openBulkShare(assetIds: string[], folderIds: string[]) {
    if (!canShare) return;
    const itemCount = assetIds.length + folderIds.length;
    setActiveShare({
      kind: "bulk",
      assetIds,
      folderIds,
      title: `Share ${itemCount} item${itemCount === 1 ? "" : "s"}`,
    });
  }

  React.useEffect(() => {
    const anyComplete = uploadFiles.some(
      (f) => f.projectId === projectId && f.status === "complete",
    );
    if (anyComplete) {
      mutateAssets();
      mutateSubfolders();
    }
  }, [uploadFiles, mutateAssets, mutateSubfolders, projectId]);

  const handleFilesSelected = (files: File[]) => {
    setPendingFiles(files);
    if (files.length > 0) setAssetName(files[0].name.replace(/\.[^/.]+$/, ""));
  };

  const startSmartUpload = React.useCallback(
    (file: File, name: string) => {
      const candidate = findVersionCandidate(file.name, assets ?? []);
      if (candidate) {
        setVersionPrompt({ file, candidate, newAssetName: name });
        return;
      }

      startUpload(file, projectId, name, project?.name, currentFolderId);
    },
    [assets, startUpload, projectId, project?.name, currentFolderId],
  );

  const handleStartUpload = () => {
    const [file] = pendingFiles;
    if (pendingFiles.length === 1 && file) {
      startSmartUpload(file, assetName || file.name);
    } else {
      pendingFiles.forEach((pendingFile) => {
        startUpload(pendingFile, projectId, pendingFile.name, project?.name, currentFolderId);
      });
    }
    setPendingFiles([]);
    setAssetName("");
    setUploadOpen(false);
  };

  const handleDropFiles = React.useCallback(
    (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      const [file] = files;
      if (files.length === 1 && file) {
        startSmartUpload(file, file.name.replace(/\.[^/.]+$/, ""));
        return;
      }

      files.forEach((droppedFile) => {
        const name = droppedFile.name.replace(/\.[^/.]+$/, "");
        startUpload(droppedFile, projectId, name, project?.name, currentFolderId);
      });
    },
    [startUpload, startSmartUpload, projectId, project?.name, currentFolderId],
  );

  const handleSelectFolder = React.useCallback(
    (folderId: string | null) => {
      setCurrentFolderId(folderId);
      setShowTrash(false);
      const url = folderId
        ? `/projects/${projectId}?folder=${folderId}`
        : `/projects/${projectId}`;
      window.history.replaceState(null, "", url);
    },
    [projectId],
  );

  return (
    <div className="flex h-full flex-col lg:flex-row overflow-hidden">
      {/* ─── Left Sidebar (Frame.io style) ──────────────────────────────── */}
      {!leftPanelOpen && (
        <div className="hidden lg:flex w-9 shrink-0 flex-col items-center border-r border-border bg-bg-secondary pt-3">
          <button
            onClick={toggleLeftPanel}
            className="text-text-tertiary hover:text-text-primary transition-colors"
            title="Show panel"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}
      {leftPanelOpen && (
      <div className="hidden lg:flex w-72 flex-col border-r border-border bg-bg-secondary shrink-0">
        {/* Assets section */}
        <div className="p-3 space-y-0.5">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider">
              Assets
            </span>
            <div className="flex items-center gap-1">
            {canCreateFolder && (
              <button
                className="text-text-tertiary hover:text-text-primary transition-colors"
                onClick={() => {
                  setFolderDialogParentId(currentFolderId);
                  setFolderDialogOpen(true);
                }}
                title="New folder"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={toggleLeftPanel}
              className="text-text-tertiary hover:text-text-primary transition-colors"
              title="Collapse panel"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
            </div>
          </div>

          {/* Project folder tree */}
          <FolderTree
            tree={tree}
            projectName={project?.name || "Project"}
            currentFolderId={currentFolderId}
            showTrash={showTrash}
            onSelectFolder={handleSelectFolder}
            onShowTrash={() => {
              setShowTrash(true);
              setCurrentFolderId(null);
            }}
            onCreateFolder={async (_name, parentId) => {
              setFolderDialogParentId(parentId);
              setFolderDialogOpen(true);
            }}
            onRenameFolder={async (id, name) => {
              await renameFolder(id, name);
              mutateSubfolders();
            }}
            onDeleteFolder={async (id) => {
              await deleteFolder(id);
              if (currentFolderId === id) handleSelectFolder(null);
              mutateAssets();
              mutateSubfolders();
            }}
            onDropItems={async (targetFolderId, assetIds, folderIds) => {
              await bulkMove(assetIds, folderIds, targetFolderId);
              mutateAssets();
              mutateSubfolders();
            }}
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Storage indicator — matches global sidebar bottom section (p-2 + space-y-1) */}
        {(() => {
          const used = project?.storage_bytes ?? 0;
          const limit = 10 * 1024 * 1024 * 1024; // 10 GB default limit
          const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
          const isCritical = pct >= 90;
          const isWarning = pct >= 80;
          return (
            <div className="border-t border-border shrink-0 p-2 space-y-1">
              <div className="flex flex-col gap-1 px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-text-secondary">Storage</span>
                  <span className={cn(
                    "text-[10px] tabular-nums",
                    isCritical ? "text-status-error font-medium" : isWarning ? "text-amber-400 font-medium" : "text-text-tertiary",
                  )}>
                    {formatBytes(used)} / {formatBytes(limit)}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-bg-hover overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      isCritical ? "bg-status-error" : isWarning ? "bg-amber-400" : "bg-accent",
                    )}
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                </div>
              </div>
              <div className="h-5" />
            </div>
          );
        })()}
      </div>
      )}

      {/* ─── Main Content ───────────────────────────────────────────────── */}
      <div
        className="relative flex-1 flex flex-col min-w-0 bg-bg-primary h-full overflow-y-auto"
        onDragEnter={(e) => {
          if (!canUpload || showTrash || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current += 1;
          setIsDraggingFiles(true);
        }}
        onDragOver={(e) => {
          if (!canUpload || showTrash || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!canUpload || showTrash || !e.dataTransfer.types.includes("Files")) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDraggingFiles(false);
        }}
        onDrop={(e) => {
          if (!canUpload || showTrash || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current = 0;
          setIsDraggingFiles(false);
          handleDropFiles(e.dataTransfer.files);
        }}
        onClick={() => setSelectedAsset(null)}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-bg-primary/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 text-center">
              <UploadCloud className="h-10 w-10 text-accent" />
              <p className="text-sm font-medium text-text-primary">
                Drop files to upload
              </p>
              <p className="text-xs text-text-tertiary">
                They will be added to {currentFolderId ? "this folder" : "the project root"}.
              </p>
            </div>
          </div>
        )}
        <div className="px-5 pt-3 pb-6 space-y-3">
          {showTrash ? (
            <div className="flex-1 overflow-y-auto">
              <h2 className="text-sm font-medium text-text-primary mb-3">
                Recently Deleted
              </h2>
              {trash.folders.length === 0 && trash.assets.length === 0 ? (
                <p className="text-xs text-text-tertiary">No deleted items</p>
              ) : (
                <div className="space-y-1">
                  {trash.folders.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderIcon className="h-4 w-4 text-text-tertiary shrink-0" />
                        <span className="text-sm text-text-primary truncate">
                          {item.name}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          Folder
                        </span>
                      </div>
                      <button
                        className="text-xs text-accent hover:underline shrink-0"
                        onClick={async () => {
                          await restoreFolder(item.id);
                          mutateTrash();
                          mutateAssets();
                          mutateSubfolders();
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                  {trash.assets.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-text-primary truncate">
                          {item.name}
                        </span>
                        <span className="text-xs text-text-tertiary capitalize">
                          {item.type}
                        </span>
                      </div>
                      <button
                        className="text-xs text-accent hover:underline shrink-0"
                        onClick={async () => {
                          await restoreAsset(item.id);
                          mutateTrash();
                          mutateAssets();
                          mutateSubfolders();
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <AssetGrid
              assets={assets ?? []}
              folders={subfolders ?? []}
              currentFolderId={currentFolderId}
              projectId={projectId}
              projectName={project?.name ?? 'Project'}
              folderTree={tree ?? []}
              isLoading={loadingAssets}
              assignees={assigneesMap}
              thumbnails={thumbnails}
              versionCounts={versionCounts}
              authorNames={authorNames}
              fileSizes={fileSizes}
              selectedAssetId={selectedAsset?.id}
              onUpload={() => setUploadOpen(true)}
              onAssetSelect={(asset, e) => {
                e?.stopPropagation();
                setSelectedAsset(asset as AssetResponse);
              }}
              onAssetOpen={(asset) =>
                router.push(`/projects/${projectId}/assets/${asset.id}`)
              }
              onFolderOpen={(folder) => handleSelectFolder(folder.id)}
              onFolderRename={async (id, name) => {
                await renameFolder(id, name);
                mutateSubfolders();
              }}
              onFolderDelete={async (id) => {
                await deleteFolder(id);
                mutateAssets();
                mutateSubfolders();
              }}
              onFolderShare={canShare ? async (folderId, folderName) => {
                setActiveShare({
                  kind: "folder",
                  id: folderId,
                  name: folderName,
                });
              } : undefined}
              onDropToFolder={async (targetFolderId, assetIds, folderIds) => {
                await bulkMove(assetIds, folderIds, targetFolderId);
                mutateAssets();
                mutateSubfolders();
              }}
              shareMode={canShare ? shareMode : false}
              onShareModeChange={canShare ? setShareMode : undefined}
              onCreateShareLink={canShare ? openBulkShare : undefined}
              onAssetShare={canShare ? (asset) => {
                setActiveShare({
                  kind: "asset",
                  id: asset.id,
                  name: asset.name,
                });
              } : undefined}
              onAssetDownload={async (asset) => {
                try {
                  const data = await api.get<{ url: string }>(
                    `/assets/${asset.id}/stream?download=true`,
                  );
                  if (data?.url) {
                    const iframe = document.createElement("iframe");
                    iframe.style.display = "none";
                    iframe.src = data.url;
                    document.body.appendChild(iframe);
                    setTimeout(() => iframe.remove(), 30000);
                  }
                } catch {}
              }}
              onAssetRename={(asset) => setAssetToRename(asset as AssetResponse)}
              onAssetDelete={(asset) => setAssetToDelete(asset as AssetResponse)}
              onBulkMove={async (assetIds, folderIds, targetFolderId) => {
                await bulkMove(assetIds, folderIds, targetFolderId);
                mutateAssets();
                mutateSubfolders();
                mutateTree();
              }}
              onBulkDelete={(assetIds, folderIds) => {
                setPendingBulkDelete({ assetIds, folderIds });
              }}
              onBulkDownload={async (assetIds, folderIds) => {
                function triggerDownload(url: string) {
                  const iframe = document.createElement("iframe");
                  iframe.style.display = "none";
                  iframe.src = url;
                  document.body.appendChild(iframe);
                  setTimeout(() => iframe.remove(), 30000);
                }

                async function downloadAsset(id: string) {
                  try {
                    const data = await api.get<{ url: string }>(
                      `/assets/${id}/stream?download=true`,
                    );
                    if (data?.url) {
                      triggerDownload(data.url);
                      await new Promise((r) => setTimeout(r, 300));
                    }
                  } catch {}
                }

                // Download selected assets
                for (const id of assetIds) {
                  await downloadAsset(id);
                }

                // Download assets from selected folders
                for (const folderId of folderIds) {
                  try {
                    const folderAssets = await api.get<AssetResponse[]>(
                      `/projects/${projectId}/assets?folder_id=${folderId}&skip=0&limit=100`,
                    );
                    for (const fa of folderAssets) {
                      await downloadAsset(fa.id);
                    }
                  } catch {}
                }
              }}
              actions={
                <>
                  {canManageMembers && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setMembersDialogOpen(true)}
                    >
                      <Users className="h-4 w-4" />
                    </Button>
                  )}
                  {canShare && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveShare({ kind: "project" })}
                    >
                      <Share2 className="h-4 w-4" />
                      Share
                    </Button>
                  )}
                  {canCreateFolder && (
                    <button
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-[13px] transition-colors"
                      onClick={() => {
                        setFolderDialogParentId(currentFolderId);
                        setFolderDialogOpen(true);
                      }}
                    >
                      <FolderPlus className="h-4 w-4" />
                      New Folder
                    </button>
                  )}
                  {canUpload && (
                    <Button size="sm" onClick={() => setUploadOpen(true)}>
                      <Upload className="h-4 w-4" />
                      Upload
                    </Button>
                  )}
                </>
              }
            />
          )}

          {/* Upload dialog */}
          <Dialog.Root open={uploadOpen} onOpenChange={setUploadOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
                  <X className="h-4 w-4" />
                </Dialog.Close>
                <Dialog.Title className="text-base font-semibold text-text-primary">
                  Upload asset
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-text-secondary">
                  Add new media to this project.
                </Dialog.Description>
                <div className="mt-4 space-y-4">
                  {pendingFiles.length === 0 ? (
                    <UploadZone onFilesSelected={handleFilesSelected} />
                  ) : (
                    <>
                      <div className="rounded-lg border border-border bg-bg-tertiary">
                        <div className="px-3 py-2 text-xs font-medium text-text-tertiary border-b border-border">
                          {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} selected
                        </div>
                        <div className="max-h-40 overflow-y-auto divide-y divide-border">
                          {pendingFiles.map((f, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5">
                              <span className="text-sm text-text-primary truncate mr-2">{f.name}</span>
                              <span className="text-xs text-text-tertiary shrink-0">
                                {f.size < 1024 * 1024
                                  ? `${(f.size / 1024).toFixed(0)} KB`
                                  : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {pendingFiles.length === 1 && (
                        <Input
                          label="Asset name"
                          value={assetName}
                          onChange={(e) => setAssetName(e.target.value)}
                          placeholder="e.g. Hero Video Final"
                        />
                      )}
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setPendingFiles([])}
                        >
                          Change files
                        </Button>
                        <Button size="sm" onClick={handleStartUpload}>
                          Start upload
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {rightPanelOpen && selectedAsset && (
        <div className="hidden xl:flex w-[360px] flex-col border-l border-border bg-bg-secondary shrink-0">
          <>
              {/* Tabs */}
              <div className="flex items-center border-b border-border">
                <button
                  onClick={() => setRightTab("comments")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2",
                    rightTab === "comments"
                      ? "border-accent text-text-primary"
                      : "border-transparent text-text-tertiary hover:text-text-secondary",
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                  Comments
                </button>
                <button
                  onClick={() => setRightTab("fields")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2",
                    rightTab === "fields"
                      ? "border-accent text-text-primary"
                      : "border-transparent text-text-tertiary hover:text-text-secondary",
                  )}
                >
                  Fields
                </button>
                {selectedAsset && (
                  <button
                    onClick={() => setSelectedAsset(null)}
                    className="px-3 text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {rightTab === "comments" ? (
                  /* Comments tab — real comments */
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {comments.length > 0 ? (
                      <CommentPanel
                        comments={comments}
                        currentUserId={user?.id}
                        onResolve={resolveComment}
                        onDelete={deleteComment}
                        onAddReaction={addReaction}
                        onRemoveReaction={removeReaction}
                        onReply={() => {}}
                        onSubmitReply={async () => {}}
                      />
                    ) : (
                      <div className="flex-1 flex items-center justify-center p-6 text-center">
                        <div>
                          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-bg-tertiary flex items-center justify-center">
                            <MessageSquare className="h-6 w-6 text-text-tertiary/50" />
                          </div>
                          <p className="text-sm text-text-secondary">
                            No comments yet
                          </p>
                          <p className="text-xs text-text-tertiary mt-1">
                            Double-click the asset to open the viewer and leave
                            comments.
                          </p>
                        </div>
                      </div>
                    )}
                    {/* Quick link to open in viewer */}
                    <div className="border-t border-border p-3 shrink-0">
                      <Link
                        href={`/projects/${projectId}/assets/${selectedAsset.id}`}
                      >
                        <div className="rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-tertiary cursor-pointer hover:border-border-focus transition-colors text-center">
                          Open in viewer to comment
                        </div>
                      </Link>
                    </div>
                  </div>
                ) : (
                  /* Fields tab */
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Thumbnail preview */}
                    <div className="aspect-video bg-bg-tertiary rounded-lg overflow-hidden border border-border flex items-center justify-center">
                      {selectedAsset.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={selectedAsset.thumbnail_url}
                          alt={selectedAsset.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-text-tertiary uppercase font-bold">
                          {selectedAsset.asset_type}
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-text-primary break-words">
                      {selectedAsset.name}
                    </h4>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-tertiary">Type</span>
                        <span className="text-xs text-text-primary capitalize">
                          {selectedAsset.asset_type.replace("_", " ")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-tertiary">
                          Uploaded
                        </span>
                        <span className="text-xs text-text-primary">
                          {formatRelativeTime(selectedAsset.created_at)}
                        </span>
                      </div>
                      {authorNames[selectedAsset.created_by] && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text-tertiary">
                            Uploaded by
                          </span>
                          <span className="text-xs text-text-primary">
                            {authorNames[selectedAsset.created_by]}
                          </span>
                        </div>
                      )}
                      {fileSizes[selectedAsset.id] != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text-tertiary">
                            File size
                          </span>
                          <span className="text-xs text-text-primary">
                            {formatBytes(fileSizes[selectedAsset.id])}
                          </span>
                        </div>
                      )}
                      {selectedAsset.latest_version && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text-tertiary">
                            Version
                          </span>
                          <span className="text-xs text-text-primary">
                            v{selectedAsset.latest_version.version_number}
                          </span>
                        </div>
                      )}
                      {selectedAsset.assignee_id &&
                        assigneesMap[selectedAsset.assignee_id] && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-text-tertiary">
                              Assignee
                            </span>
                            <div className="flex items-center gap-1.5">
                              <Avatar size="sm" className="h-5 w-5" />
                              <span className="text-xs text-text-primary">
                                {assigneesMap[selectedAsset.assignee_id].name}
                              </span>
                            </div>
                          </div>
                        )}
                    </div>

                    <div className="pt-3 border-t border-border grid grid-cols-2 gap-2">
                      <Button asChild className="w-full col-span-2" size="sm">
                        <Link
                          href={`/projects/${projectId}/assets/${selectedAsset.id}`}
                        >
                          Open in Player
                        </Link>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1"
                        onClick={async () => {
                          try {
                            const res = await api.get<{ url: string }>(
                              `/assets/${selectedAsset.id}/stream?download=true`,
                            );
                            if (res.url) {
                              const iframe = document.createElement("iframe");
                              iframe.style.display = "none";
                              iframe.src = res.url;
                              document.body.appendChild(iframe);
                              setTimeout(() => iframe.remove(), 30000);
                            }
                          } catch {
                            // Silent fail
                          }
                        }}
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  </div>
                )}
          </>
        </div>
      )}

      {/* Create folder dialog */}
      <NameDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        title="New Folder"
        placeholder="Folder name"
        submitLabel="Create"
        onSubmit={async (name) => {
          await createFolder(name, folderDialogParentId);
          mutateAssets();
          mutateSubfolders();
        }}
      />

      {/* Share dialog */}
      <Dialog.Root
        open={activeShare !== null}
        onOpenChange={(open) => {
          if (!open) setActiveShare(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-5 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
            <Dialog.Title className="text-base font-semibold text-text-primary">
              {activeShare?.kind === "folder"
                ? `Share ${activeShare.name}`
                : activeShare?.kind === "asset"
                  ? `Share ${activeShare.name}`
                : activeShare?.kind === "bulk"
                  ? activeShare.title
                  : "Share project"}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Create and copy a reviewer share link.
            </Dialog.Description>
            <div className="mt-4">
              {activeShare?.kind === "project" && (
                <SharePanel
                  target={{
                    kind: "project",
                    id: projectId,
                    name: project?.name ?? "Project",
                  }}
                  projectId={projectId}
                />
              )}
              {activeShare?.kind === "folder" && (
                <SharePanel
                  target={{ kind: "folder", id: activeShare.id }}
                  projectId={projectId}
                  withPeople
                />
              )}
              {activeShare?.kind === "asset" && (
                <SharePanel
                  target={{ kind: "asset", id: activeShare.id }}
                  projectId={projectId}
                  withPeople
                />
              )}
              {activeShare?.kind === "bulk" && (
                <BulkSharePanel
                  projectId={projectId}
                  assetIds={activeShare.assetIds}
                  folderIds={activeShare.folderIds}
                  title={activeShare.title}
                />
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={versionPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setVersionPrompt(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-5 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
            <Dialog.Title className="text-base font-semibold text-text-primary">
              Upload as a new version?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-text-secondary">
              &quot;{versionPrompt?.file.name}&quot; looks like a version of &quot;{versionPrompt?.candidate.name}&quot;.
            </Dialog.Description>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (!versionPrompt) return;
                  startVersionUpload(
                    versionPrompt.file,
                    versionPrompt.candidate.id,
                    versionPrompt.candidate.name,
                    projectId,
                  );
                  setVersionPrompt(null);
                }}
              >
                New version of &quot;{versionPrompt?.candidate.name}&quot;
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (!versionPrompt) return;
                  startUpload(
                    versionPrompt.file,
                    projectId,
                    versionPrompt.newAssetName,
                    project?.name,
                    currentFolderId,
                  );
                  setVersionPrompt(null);
                }}
              >
                Upload as a new asset
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Project members dialog */}
      <ProjectMembersDialog
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
        projectId={projectId}
        projectName={project?.name ?? ""}
      />

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={pendingBulkDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingBulkDelete(null);
        }}
        title={`Delete ${(pendingBulkDelete?.assetIds.length ?? 0) + (pendingBulkDelete?.folderIds.length ?? 0)} item${(pendingBulkDelete?.assetIds.length ?? 0) + (pendingBulkDelete?.folderIds.length ?? 0) !== 1 ? "s" : ""}?`}
        description="This will move the selected items to the trash. You can restore them later from Recently Deleted."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!pendingBulkDelete) return;
          for (const id of pendingBulkDelete.folderIds) await deleteFolder(id);
          for (const id of pendingBulkDelete.assetIds)
            await api.delete(`/assets/${id}`);
          mutateAssets();
          mutateSubfolders();
          mutateTree();
          setPendingBulkDelete(null);
        }}
      />

      {/* Rename asset dialog */}
      <NameDialog
        open={assetToRename !== null}
        onOpenChange={(open) => { if (!open) setAssetToRename(null); }}
        title="Rename asset"
        defaultValue={assetToRename?.name ?? ""}
        placeholder="Asset name..."
        submitLabel="Rename"
        onSubmit={async (name) => {
          if (!assetToRename) return;
          try {
            await api.patch(`/assets/${assetToRename.id}`, { name });
            mutateAssets();
          } catch {}
          setAssetToRename(null);
        }}
      />

      {/* Delete asset confirmation */}
      <ConfirmDialog
        open={assetToDelete !== null}
        onOpenChange={(open) => { if (!open) setAssetToDelete(null); }}
        title={`Delete "${assetToDelete?.name}"?`}
        description="This will move the asset to the trash. You can restore it later from Recently Deleted."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!assetToDelete) return;
          try {
            await api.delete(`/assets/${assetToDelete.id}`);
            mutateAssets();
            if (selectedAsset?.id === assetToDelete.id) setSelectedAsset(null);
          } catch {}
          setAssetToDelete(null);
        }}
      />
    </div>
  );
}
