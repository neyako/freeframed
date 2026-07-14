"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { Film, Clock, Trash2, UserCheck, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { formatRelativeTime } from "@/lib/utils";
import { QuickShare } from "@/components/dashboard/quick-share";
import { StorageMeter } from "@/components/dashboard/storage-meter";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AssetResponse } from "@/types";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Time/locale-derived text must not be server-rendered: the container renders
// in UTC while the client hydrates in the viewer's timezone, and any mismatch
// breaks hydration (React #425) and crashes later SPA navigation.
function useMounted(): boolean {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

interface AssetCardProps {
  asset: AssetResponse;
  onDelete: (asset: AssetResponse) => Promise<void>;
}

function AssetCard({ asset, onDelete }: AssetCardProps) {
  const mounted = useMounted();
  const [imgError, setImgError] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  function handleDeleteClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDeleteError(null);
    setConfirmOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setConfirmOpen(open);
    if (!open) setDeleteError(null);
  }

  async function handleConfirmDelete() {
    setDeleteError(null);
    try {
      await onDelete(asset);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to delete asset.";
      setDeleteError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  return (
    <div className="group relative">
      <Link
        href={`/assets/${asset.id}`}
        className="flex flex-col gap-2 rounded-lg border border-border bg-bg-secondary p-3 hover:border-border-strong transition-colors"
      >
        <div className="aspect-video w-full rounded-md bg-bg-tertiary overflow-hidden flex items-center justify-center text-text-tertiary">
          {asset.thumbnail_url && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.thumbnail_url}
              alt={asset.name}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <Film className="h-6 w-6" />
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-text-primary line-clamp-1">
              {asset.name}
            </p>
          </div>
          <p className="text-xs text-text-tertiary">
            {mounted ? formatRelativeTime(asset.updated_at) : " "}
          </p>
          {mounted && asset.due_date && (
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
              Due {new Date(asset.due_date).toLocaleDateString()}
            </p>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={handleDeleteClick}
        className="pointer-events-none absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded bg-bg-secondary/90 text-text-tertiary opacity-0 shadow-sm transition-colors hover:bg-bg-hover hover:text-accent group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
        aria-label={`Delete ${asset.name}`}
        title={`Delete ${asset.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleDialogOpenChange}
        title={`Delete "${asset.name}"?`}
        description={
          deleteError
            ? `Could not delete "${asset.name}": ${deleteError}`
            : "This will move the asset to the trash. You can restore it later from Recently Deleted."
        }
        confirmLabel="Delete asset"
        variant="danger"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: LucideIcon;
  assets: AssetResponse[] | undefined;
  isLoading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onDelete: (asset: AssetResponse) => Promise<void>;
}

function Section({
  title,
  icon: Icon,
  assets,
  isLoading,
  emptyTitle,
  emptyDescription,
  onDelete,
}: SectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-secondary" />
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">
          {title}
        </h2>
        {assets && assets.length > 0 && (
          <span className="font-dot text-xs font-bold text-text-tertiary">
            {assets.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-video animate-pulse rounded-lg bg-bg-tertiary"
            />
          ))}
        </div>
      ) : !assets || assets.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-secondary">
          <EmptyState
            icon={Icon}
            title={emptyTitle}
            description={emptyDescription}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.slice(0, 8).map((asset) => (
            <AssetCard key={asset.id} asset={asset} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const mounted = useMounted();
  const { user } = useAuthStore();

  const {
    data: recentAssets,
    isLoading: loadingRecent,
    mutate: mutateRecentAssets,
  } = useSWR<AssetResponse[]>(
    "/me/assets?filter=owned",
    () => api.get<AssetResponse[]>("/me/assets?filter=owned"),
  );

  const {
    data: assignedAssets,
    isLoading: loadingAssigned,
    mutate: mutateAssignedAssets,
  } = useSWR<AssetResponse[]>(
    "/me/assets?filter=assigned",
    () => api.get<AssetResponse[]>("/me/assets?filter=assigned"),
  );

  const handleDeleteAsset = React.useCallback(
    async (asset: AssetResponse) => {
      await api.delete<void>(`/assets/${asset.id}`);
      await Promise.all([mutateRecentAssets(), mutateAssignedAssets()]);
    },
    [mutateAssignedAssets, mutateRecentAssets],
  );

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 sm:px-8 lg:px-10 pt-6 sm:pt-10 pb-24 space-y-8">
      {/* Greeting + storage */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            {mounted ? getGreeting() : "Welcome"},{" "}
            <span className="text-accent">
              {user?.name?.split(" ")[0] ?? "there"}
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Here&apos;s what&apos;s happening with your assets today.
          </p>
        </div>
        <div className="hidden sm:block w-56 shrink-0 pt-1">
          <StorageMeter />
        </div>
      </div>

      {/* Sections */}
      <QuickShare />

      <Section
        title="Recent"
        icon={Clock}
        assets={recentAssets}
        isLoading={loadingRecent}
        emptyTitle="No assets yet"
        emptyDescription="Assets you create or own will appear here."
        onDelete={handleDeleteAsset}
      />

      <Section
        title="Assigned to me"
        icon={UserCheck}
        assets={assignedAssets}
        isLoading={loadingAssigned}
        emptyTitle="Nothing assigned"
        emptyDescription="Assets assigned to you for review will appear here."
        onDelete={handleDeleteAsset}
      />

    </div>
  );
}
