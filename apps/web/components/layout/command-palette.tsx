"use client";

import * as React from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Home,
  Layers,
  FolderOpen,
  Settings,
  FolderPlus,
  Search,
  Film,
  Music,
  Image as ImageIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Project, AssetResponse } from "@/types";

const groupClass =
  "[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:pb-1 [&>[cmdk-group-heading]]:pt-2 [&>[cmdk-group-heading]]:text-[12px] [&>[cmdk-group-heading]]:text-text-tertiary";

const itemClass =
  "flex h-8 cursor-pointer items-center gap-2.5 rounded px-2 text-[13px] text-text-secondary data-[selected=true]:bg-bg-hover data-[selected=true]:text-text-primary";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
  group: "navigation" | "actions";
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const [debouncedQuery, setDebouncedQuery] = React.useState("");

  // Fetch projects when palette is open
  const { data: projects } = useSWR<Project[]>(open ? "/projects" : null, () =>
    api.get<Project[]>("/projects"),
  );

  // Debounce search query for asset search
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Search assets and folders when query is present
  const searchQ = debouncedQuery.trim();
  const { data: assets } = useSWR<AssetResponse[]>(
    open && searchQ.length >= 2
      ? `/me/assets?q=${encodeURIComponent(searchQ)}&limit=8`
      : null,
    (key: string) => api.get<AssetResponse[]>(key),
  );
  const { data: folders } = useSWR<
    {
      id: string;
      name: string;
      project_id: string;
      project_name: string | null;
    }[]
  >(
    open && searchQ.length >= 2
      ? `/me/folders?q=${encodeURIComponent(searchQ)}&limit=8`
      : null,
    (key: string) =>
      api.get<
        {
          id: string;
          name: string;
          project_id: string;
          project_name: string | null;
        }[]
      >(key),
  );

  // Reset query when dialog closes
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  const staticItems: CommandItem[] = [
    {
      id: "home",
      label: "Home",
      icon: Home,
      href: "/",
      group: "navigation",
    },
    {
      id: "projects",
      label: "Projects",
      icon: Layers,
      href: "/projects",
      group: "navigation",
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      href: "/settings",
      group: "navigation",
    },
    {
      id: "new-project",
      label: "New project",
      icon: FolderPlus,
      href: "/projects?new=1",
      group: "actions",
    },
  ];

  function handleSelect(item: CommandItem) {
    onOpenChange(false);
    if (item.href) router.push(item.href);
  }

  function handleProjectSelect(project: Project) {
    onOpenChange(false);
    router.push(`/projects/${project.id}`);
  }

  function handleAssetSelect(asset: AssetResponse) {
    onOpenChange(false);
    router.push(`/projects/${asset.project_id}/assets/${asset.id}`);
  }

  function handleFolderSelect(folder: { id: string; project_id: string }) {
    onOpenChange(false);
    router.push(`/projects/${folder.project_id}?folder=${folder.id}`);
  }

  function getAssetIcon(type: string) {
    switch (type) {
      case "video":
        return Film;
      case "audio":
        return Music;
      default:
        return ImageIcon;
    }
  }

  const navItems = staticItems.filter((i) => i.group === "navigation");
  const actionItems = staticItems.filter((i) => i.group === "actions");

  const hasQuery = query.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 -translate-y-0">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Dialog.Description className="sr-only">Search projects, folders and assets, or jump to a page.</Dialog.Description>
          <Command
            className="overflow-hidden rounded-md border border-border-strong bg-bg-elevated shadow-2xl"
            loop
            shouldFilter={true}
          >
            <div className="flex items-center border-b border-border px-3 gap-2">
              <Search className="h-[15px] w-[15px] shrink-0 text-text-tertiary" />
              <Command.Input
                placeholder="Search or jump to…"
                value={query}
                onValueChange={setQuery}
                className="h-11 w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-3 text-[13px] text-text-tertiary">
                No results.
              </Command.Empty>

              {/* Projects — show when searching */}
              {hasQuery && projects && projects.length > 0 && (
                <Command.Group
                  heading="Projects"
                  className={groupClass}
                >
                  {projects.map((project) => (
                    <Command.Item
                      key={`project-${project.id}`}
                      value={`project ${project.name} ${project.description || ""}`}
                      onSelect={() => handleProjectSelect(project)}
                      className={itemClass}
                    >
                      <FolderOpen className="h-[15px] w-[15px] shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <span className="shrink-0 font-mono text-[11.5px] text-text-tertiary">
                        {project.asset_count ?? 0}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Folders — show when searching (2+ chars) */}
              {hasQuery && folders && folders.length > 0 && (
                <Command.Group
                  heading="Folders"
                  className={groupClass}
                >
                  {folders.map((folder) => (
                    <Command.Item
                      key={`folder-${folder.id}`}
                      value={`folder ${folder.name} ${folder.project_name || ""}`}
                      onSelect={() => handleFolderSelect(folder)}
                      className={itemClass}
                    >
                      <FolderOpen className="h-[15px] w-[15px] shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      {folder.project_name && (
                        <span className="shrink-0 truncate text-[12px] text-text-tertiary">
                          {folder.project_name}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Assets — show when searching (2+ chars) */}
              {hasQuery && assets && assets.length > 0 && (
                <Command.Group
                  heading="Assets"
                  className={groupClass}
                >
                  {assets.map((asset) => {
                    const Icon = getAssetIcon(asset.asset_type);
                    return (
                      <Command.Item
                        key={`asset-${asset.id}`}
                        value={`asset ${asset.name} ${asset.asset_type}`}
                        onSelect={() => handleAssetSelect(asset)}
                        className={itemClass}
                      >
                        {asset.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.thumbnail_url}
                            alt=""
                            className="h-5 w-5 shrink-0 rounded-sm object-cover"
                          />
                        ) : (
                          <Icon className="h-[15px] w-[15px] shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}

              {/* Navigation */}
              <Command.Group
                heading="Navigation"
                className={groupClass}
              >
                {navItems.map((item) => (
                  <CommandItemRow
                    key={item.id}
                    item={item}
                    onSelect={() => handleSelect(item)}
                  />
                ))}
              </Command.Group>

              <Command.Separator className="my-1 h-px bg-border" />

              <Command.Group
                heading="Actions"
                className={groupClass}
              >
                {actionItems.map((item) => (
                  <CommandItemRow
                    key={item.id}
                    item={item}
                    onSelect={() => handleSelect(item)}
                  />
                ))}
              </Command.Group>
            </Command.List>

          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommandItemRow({
  item,
  onSelect,
}: {
  item: CommandItem;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <Command.Item
      value={item.label}
      onSelect={onSelect}
      className={itemClass}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" />
      <span className="flex-1">{item.label}</span>
    </Command.Item>
  );
}
