"use client";

import * as React from "react";
import useSWR from "swr";
import Link from "next/link";
import { Film, LayoutGrid, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { mediaAspect } from "@/lib/aspect";
import { useAuthStore } from "@/stores/auth-store";
import { useHomeModeStore } from "@/stores/home-mode-store";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "@/lib/utils";
import { QuickShare } from "@/components/dashboard/quick-share";
import { StorageMeter } from "@/components/dashboard/storage-meter";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
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

  const aspect = mediaAspect(asset);
  return (
    // Justified row item: as wide as the media's shape needs at ROW_HEIGHT
    <div className="group relative min-w-0" style={{ flexGrow: aspect, flexBasis: aspect * ROW_HEIGHT }}>
      <Link href={`/projects/${asset.project_id}/assets/${asset.id}`} className="block">
        <div
          className="flex w-full items-center justify-center overflow-hidden rounded-sm border border-border bg-bg-tertiary text-text-tertiary transition-colors duration-100 group-hover:border-border-strong"
          style={{ aspectRatio: aspect }}
        >
          {asset.thumbnail_url && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.thumbnail_url}
              alt={asset.name}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Film className="h-[15px] w-[15px]" />
          )}
        </div>
        <p className="mt-1.5 truncate text-[12.5px] text-text-primary">{asset.name}</p>
        <p className="text-[11.5px] text-text-tertiary">
          {mounted ? formatRelativeTime(asset.updated_at) : "\u00a0"}
        </p>
      </Link>
      <button
        type="button"
        onClick={handleDeleteClick}
        className="pointer-events-none absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-text-secondary opacity-0 transition-colors duration-100 hover:text-accent group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-text-primary/60 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
        aria-label={`Delete ${asset.name}`}
        title={`Delete ${asset.name}`}
      >
        <Trash2 className="h-[15px] w-[15px]" />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleDialogOpenChange}
        title={`Delete "${asset.name}"?`}
        description={
          deleteError
            ? `Could not delete "${asset.name}": ${deleteError}`
            : "It moves to the project's trash, where you can restore it."
        }
        confirmLabel="Delete asset"
        variant="danger"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

const ROW_HEIGHT = 180;

interface SectionProps {
  title: string;
  assets: AssetResponse[] | undefined;
  isLoading: boolean;
  emptyTitle: string;
  onDelete: (asset: AssetResponse) => Promise<void>;
}

function Section({ title, assets, isLoading, emptyTitle, onDelete }: SectionProps) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-[13px] font-medium text-text-primary">
        {title}
        {assets && assets.length > 0 && (
          <span className="font-mono text-[12px] font-normal text-text-tertiary">
            {assets.length}
          </span>
        )}
      </h2>

      {isLoading ? (
        <p className="text-[13px] text-text-tertiary">Loading…</p>
      ) : !assets || assets.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-4">
          {assets.slice(0, 8).map((asset) => (
            <AssetCard key={asset.id} asset={asset} onDelete={onDelete} />
          ))}
          {/* Absorbs the last row's spare width so its cards keep row height */}
          <div aria-hidden className="h-0" style={{ flexGrow: 1e6, flexBasis: 0 }} />
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const mounted = useMounted();
  const { user } = useAuthStore();
  const router = useRouter();
  const homeMode = useHomeModeStore((s) => s.mode);
  const setHomeMode = useHomeModeStore((s) => s.setMode);

  // Projects-style home preference: the review feed here is only one of two
  // landing modes (Appearance → Home screen). Hand the route over.
  React.useEffect(() => {
    if (mounted && homeMode === "projects") router.replace("/projects");
  }, [mounted, homeMode, router]);

  const {
    data: recentAssets,
    isLoading: loadingRecent,
    mutate: mutateRecentAssets,
  } = useSWR<AssetResponse[]>(
    "/me/assets?filter=owned",
    () => api.get<AssetResponse[]>("/me/assets?filter=owned"),
  );

  const handleDeleteAsset = React.useCallback(
    async (asset: AssetResponse) => {
      await api.delete<void>(`/assets/${asset.id}`);
      await mutateRecentAssets();
    },
    [mutateRecentAssets],
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-8 px-4 pb-16 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-6">
        <h1 className="text-[18px] font-semibold text-text-primary">
          {mounted ? getGreeting() : "Welcome"}, {user?.name?.split(" ")[0] ?? "there"}
        </h1>
        <div className="hidden shrink-0 items-center gap-4 sm:flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHomeMode("projects")}
            title="Use the projects grid as your home screen"
          >
            <LayoutGrid />
            Projects home
          </Button>
          <StorageMeter className="w-48" />
        </div>
      </div>

      <QuickShare />

      <Section
        title="Recent"
        assets={recentAssets}
        isLoading={loadingRecent}
        emptyTitle="No assets yet."
        onDelete={handleDeleteAsset}
      />
    </div>
  );
}
