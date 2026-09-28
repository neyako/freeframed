"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Upload,
  X,
  Plus,
  FolderPlus,
  Folder as FolderIcon,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StorageMeter } from "@/components/dashboard/storage-meter";
import { api, ApiError } from "@/lib/api";
import { findVersionCandidate } from "@/lib/version-match";
import { Button } from "@/components/ui/button";
import {
  dialogCloseClass,
  dialogContentClass,
  dialogOverlayClass,
  dialogTitleClass,
} from "@/components/ui/surface";
import { AssetGrid } from "@/components/projects/asset-grid";
import { useUploadStore } from "@/stores/upload-store";
import { useViewStore } from "@/stores/view-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { useFolders, useTrash } from "@/hooks/use-folders";
import { FolderTree } from "@/components/projects/folder-tree";
import { NameDialog } from "@/components/projects/name-dialog";
import { SingleLinkSection } from "@/components/review/share-link-section";
import { loadLink } from "@/components/review/share-link-requests";
import type { ManagedShareLink } from "@/components/review/share-targets";
import { ProjectMembersDialog } from "@/components/projects/project-members-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/shared/toast";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Project, AssetResponse, User, Folder } from "@/types";

type ActiveShare = {
  kind: "folder" | "asset";
  id: string;
  name: string;
  /** Loaded before the dialog opens so it doesn't jump in size mid-animation */
  link?: ManagedShareLink | null;
};

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

  const { leftPanelOpen, toggleLeftPanel } = useViewStore();
  const toast = useToast();

  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(
    searchParams.get("folder") || null,
  );
  const [showTrash, setShowTrash] = React.useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [folderDialogParentId, setFolderDialogParentId] = React.useState<
    string | null
  >(null);
  const [activeShare, setActiveShare] = React.useState<ActiveShare | null>(null);
  const openShare = async (share: ActiveShare) => {
    const link = await loadLink({ kind: share.kind, id: share.id }).catch(() => undefined);
    setActiveShare({ ...share, link });
  };
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
  const uploadInputRef = React.useRef<HTMLInputElement>(null);

  const { files: uploadFiles, startUpload, startVersionUpload } = useUploadStore();

  const {
    tree,
    mutateTree,
    createFolder,
    renameFolder,
    deleteFolder,
    bulkMove,
    restoreAsset,
    restoreFolder,
  } = useFolders(projectId);

  const { data: project, error: projectError, isLoading: loadingProject } = useSWR<Project, ApiError>(
    `/projects/${projectId}`,
    () => api.get<Project>(`/projects/${projectId}`),
  );
  const projectReady = project !== undefined && projectError === undefined;
  const { trash, mutateTrash } = useTrash(projectId, projectReady);

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

  // Same ghost-crumb guard as the asset review page: folder crumbs must not
  // outlive the library route.
  React.useEffect(() => () => setExtraCrumbs([]), [setExtraCrumbs]);

  const folderParam = currentFolderId
    ? `folder_id=${currentFolderId}`
    : "folder_id=root";
  const {
    data: assets,
    isLoading: loadingAssets,
    mutate: mutateAssets,
  } = useSWR<AssetResponse[]>(
    showTrash || !projectReady ? null : `/projects/${projectId}/assets?${folderParam}`,
    (key: string) => api.get<AssetResponse[]>(key),
  );

  // Subfolders for current view
  const { data: subfolders, mutate: mutateSubfolders } = useSWR<Folder[]>(
    showTrash || !projectReady
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
    for (const u of authorUsers ?? []) map[u.id] = u.name;
    return map;
  }, [authorUsers]);

  // Owner and editor share everything except member management.
  const canManageMembers = project?.role === "owner";

  // Refetch only when an upload for this project newly completes, not on
  // every progress tick (completed history items stay in the store).
  const completedUploadKey = uploadFiles
    .filter((f) => f.projectId === projectId && f.status === "complete")
    .map((f) => f.id)
    .join(",");
  React.useEffect(() => {
    if (!completedUploadKey) return;
    mutateAssets();
    mutateSubfolders();
  }, [completedUploadKey, mutateAssets, mutateSubfolders]);

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

  // Hidden-iframe download so the browser keeps the page (presigned URL)
  const downloadAsset = React.useCallback(async (id: string) => {
    const data = await api.get<{ url: string }>(`/assets/${id}/stream?download=true`);
    if (!data?.url) return;
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = data.url;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 30000);
  }, []);

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

  if (loadingProject) {
    return <p className="px-4 py-6 text-[13px] text-text-tertiary">Loading…</p>;
  }

  if (projectError) {
    const accessDenied = projectError.status === 403 || projectError.status === 404;
    return (
      <div className="px-4 py-6 text-[13px]">
        <h1 className="font-medium text-text-primary">
          {accessDenied ? "Access denied" : "Unable to load project"}
        </h1>
        <p className="mt-1 text-text-secondary">
          {accessDenied ? "Your access to this project is no longer active." : "Please try again."}
        </p>
      </div>
    );
  }

  const openNewFolder = () => {
    setFolderDialogParentId(currentFolderId);
    setFolderDialogOpen(true);
  };

  const refreshListing = () => {
    mutateAssets();
    mutateSubfolders();
  };

  const mobileChip = (active: boolean) =>
    cn(
      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors duration-100",
      active ? "bg-bg-hover text-text-primary" : "text-text-secondary hover:text-text-primary",
    );

  return (
    <div className="flex h-full flex-col overflow-hidden lg:flex-row">
      {/* Left sidebar */}
      {!leftPanelOpen && (
        <div className="hidden w-10 shrink-0 flex-col items-center border-r border-border pt-2 lg:flex">
          <Button variant="ghost" size="sm" className="w-[30px] px-0" onClick={toggleLeftPanel} aria-label="Show folders">
            <PanelLeftOpen />
          </Button>
        </div>
      )}
      {leftPanelOpen && (
        <nav className="hidden w-52 shrink-0 flex-col border-r border-border p-2 lg:flex">
          <FolderTree
            tree={tree}
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
              refreshListing();
            }}
            onDropItems={async (targetFolderId, assetIds, folderIds) => {
              await bulkMove(assetIds, folderIds, targetFolderId);
              refreshListing();
            }}
          />
          <button
            type="button"
            onClick={openNewFolder}
            className="mt-0.5 flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-text-tertiary transition-colors duration-100 hover:text-text-primary"
          >
            <Plus className="h-[15px] w-[15px]" />
            New folder
          </button>

          <div className="flex-1" />

          <div className="flex items-end gap-1 px-1 pb-1">
            <StorageMeter usedBytes={project?.storage_bytes ?? 0} className="min-w-0 flex-1" />
            <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={toggleLeftPanel} aria-label="Hide folders">
              <PanelLeftClose />
            </Button>
          </div>
        </nav>
      )}

      {/* Main content */}
      <div
        className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto"
        onDragEnter={(e) => {
          if (showTrash || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current += 1;
          setIsDraggingFiles(true);
        }}
        onDragOver={(e) => {
          if (showTrash || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (showTrash || !e.dataTransfer.types.includes("Files")) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDraggingFiles(false);
        }}
        onDrop={(e) => {
          if (showTrash || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragDepth.current = 0;
          setIsDraggingFiles(false);
          handleDropFiles(e.dataTransfer.files);
        }}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-md border border-dashed border-text-primary/50 bg-bg-primary/90 animate-ff-fade-in">
            <p className="text-[13px] text-text-primary">
              Drop files to upload{" "}
              <span className="text-text-secondary">
                to {currentFolderId ? "this folder" : "the project root"}
              </span>
            </p>
          </div>
        )}
        {/* Mobile app bar: global header is hidden on this route below lg */}
        <div className="flex h-12 items-center gap-2 border-b border-border px-2 lg:hidden">
          <Button variant="ghost" size="sm" className="w-[30px] px-0" aria-label="Back" onClick={() => router.push("/projects")}>
            <ArrowLeft />
          </Button>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">
            {project?.name ?? "Project"}
          </span>
          {canManageMembers && (
            <Button variant="ghost" size="sm" className="w-[30px] px-0" aria-label="Members" onClick={() => setMembersDialogOpen(true)}>
              <Users />
            </Button>
          )}
        </div>
        {/* Mobile folder strip: desktop uses the sidebar */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 [scrollbar-width:none] lg:hidden">
          <button type="button" onClick={() => handleSelectFolder(null)} className={mobileChip(currentFolderId === null && !showTrash)}>
            All files
          </button>
          {(tree ?? []).map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => handleSelectFolder(node.id)}
              className={mobileChip(currentFolderId === node.id)}
            >
              <FolderIcon className="h-[15px] w-[15px]" />
              {node.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setShowTrash(true); setCurrentFolderId(null); }}
            className={mobileChip(showTrash)}
          >
            <Trash2 className="h-[15px] w-[15px]" />
            Trash
          </button>
        </div>
        <div className="p-4">
          {showTrash ? (
            <div className="space-y-2">
              <h2 className="text-[13px] font-medium text-text-primary">Trash</h2>
              {trash.folders.length === 0 && trash.assets.length === 0 ? (
                <p className="text-[13px] text-text-tertiary">Trash is empty.</p>
              ) : (
                <div className="divide-y divide-border border-y border-border">
                  {[
                    ...trash.folders.map((item) => ({ id: item.id, name: item.name, kind: "folder" as const })),
                    ...trash.assets.map((item) => ({ id: item.id, name: item.name, kind: "asset" as const })),
                  ].map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="flex h-11 items-center gap-2 px-2 text-[13px]">
                      {item.kind === "folder" && (
                        <FolderIcon className="h-[15px] w-[15px] shrink-0 text-text-tertiary" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-text-primary">{item.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={async () => {
                          try {
                            if (item.kind === "folder") await restoreFolder(item.id);
                            else await restoreAsset(item.id);
                            mutateTrash();
                            refreshListing();
                            mutateTree();
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Could not restore");
                          }
                        }}
                      >
                        Restore
                      </Button>
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
              projectName={project?.name ?? "Project"}
              folderTree={tree ?? []}
              isLoading={loadingAssets}
              thumbnails={thumbnails}
              versionCounts={versionCounts}
              authorNames={authorNames}
              fileSizes={fileSizes}
              onUpload={() => uploadInputRef.current?.click()}
              onAssetOpen={(asset) =>
                router.push(`/projects/${projectId}/assets/${asset.id}`)
              }
              onFolderOpen={(folder) => handleSelectFolder(folder.id)}
              onFolderRename={async (id, name) => {
                await renameFolder(id, name);
                mutateSubfolders();
                mutateTree();
              }}
              onFolderDelete={async (id) => {
                await deleteFolder(id);
                refreshListing();
              }}
              onFolderShare={async (folderId, folderName) => {
                void openShare({ kind: "folder", id: folderId, name: folderName });
              }}
              onDropToFolder={async (targetFolderId, assetIds, folderIds) => {
                await bulkMove(assetIds, folderIds, targetFolderId);
                refreshListing();
              }}
              onAssetShare={(asset) => {
                void openShare({ kind: "asset", id: asset.id, name: asset.name });
              }}
              onAssetDownload={async (asset) => {
                try {
                  await downloadAsset(asset.id);
                } catch {
                  toast.error(`Could not download "${asset.name}"`);
                }
              }}
              onAssetRename={(asset) => setAssetToRename(asset as AssetResponse)}
              onAssetDelete={(asset) => setAssetToDelete(asset as AssetResponse)}
              onBulkMove={async (assetIds, folderIds, targetFolderId) => {
                await bulkMove(assetIds, folderIds, targetFolderId);
                refreshListing();
                mutateTree();
              }}
              onBulkDelete={(assetIds, folderIds) => {
                setPendingBulkDelete({ assetIds, folderIds });
              }}
              onBulkDownload={async (assetIds, folderIds) => {
                let failed = 0;
                const ids = [...assetIds];
                for (const folderId of folderIds) {
                  try {
                    const folderAssets = await api.get<AssetResponse[]>(
                      `/projects/${projectId}/assets?folder_id=${folderId}&skip=0&limit=100`,
                    );
                    ids.push(...folderAssets.map((fa) => fa.id));
                  } catch {
                    failed += 1;
                  }
                }
                for (const id of ids) {
                  try {
                    await downloadAsset(id);
                    // Browsers drop rapid back-to-back iframe downloads
                    await new Promise((r) => setTimeout(r, 300));
                  } catch {
                    failed += 1;
                  }
                }
                if (failed > 0) toast.error(`${failed} download${failed !== 1 ? "s" : ""} failed`);
              }}
              actions={
                <>
                  {canManageMembers && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="hidden lg:inline-flex"
                      onClick={() => setMembersDialogOpen(true)}
                    >
                      <Users />
                      Members
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={openNewFolder}>
                    <FolderPlus />
                    New folder
                  </Button>
                  <Button size="sm" onClick={() => uploadInputRef.current?.click()}>
                    <Upload />
                    Upload
                  </Button>
                </>
              }
            />
          )}

          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleDropFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Create folder dialog */}
      <NameDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        title="New folder"
        placeholder="Folder name"
        submitLabel="Create"
        onSubmit={async (name) => {
          await createFolder(name, folderDialogParentId);
          refreshListing();
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
          <Dialog.Overlay className={dialogOverlayClass} />
          <Dialog.Content className={cn(dialogContentClass, "max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto overscroll-contain")}>
            <Dialog.Close className={dialogCloseClass} aria-label="Close">
              <X />
            </Dialog.Close>
            <Dialog.Title className={cn(dialogTitleClass, "truncate pr-8")}>
              Share {activeShare?.name}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Create and copy a share link.
            </Dialog.Description>
            <div className="mt-3">
              {activeShare && (
                <SingleLinkSection
                  target={{ kind: activeShare.kind, id: activeShare.id }}
                  initialLink={activeShare.link}
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
          <Dialog.Overlay className={dialogOverlayClass} />
          <Dialog.Content className={cn(dialogContentClass, "max-w-md")}>
            <Dialog.Close className={dialogCloseClass} aria-label="Close">
              <X />
            </Dialog.Close>
            <Dialog.Title className={dialogTitleClass}>
              Upload as a new version?
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[13px] text-text-secondary">
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
        description="They move to trash, where you can restore them."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!pendingBulkDelete) return;
          try {
            for (const id of pendingBulkDelete.folderIds) await deleteFolder(id);
            for (const id of pendingBulkDelete.assetIds)
              await api.delete(`/assets/${id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete");
          }
          refreshListing();
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
        placeholder="Asset name"
        submitLabel="Rename"
        onSubmit={async (name) => {
          if (!assetToRename) return;
          try {
            await api.patch(`/assets/${assetToRename.id}`, { name });
            mutateAssets();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not rename");
          }
          setAssetToRename(null);
        }}
      />

      {/* Delete asset confirmation */}
      <ConfirmDialog
        open={assetToDelete !== null}
        onOpenChange={(open) => { if (!open) setAssetToDelete(null); }}
        title={`Delete "${assetToDelete?.name}"?`}
        description="It moves to trash, where you can restore it."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!assetToDelete) return;
          try {
            await api.delete(`/assets/${assetToDelete.id}`);
            mutateAssets();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete");
          }
          setAssetToDelete(null);
        }}
      />
    </div>
  );
}
