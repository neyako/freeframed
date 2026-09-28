"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { Plus, LayoutGrid, List, FolderOpen, X, Inbox } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  dialogCloseClass,
  dialogContentClass,
  dialogOverlayClass,
  dialogTitleClass,
} from "@/components/ui/surface";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/shared/empty-state";
import { useAuthStore } from "@/stores/auth-store";
import { useHomeModeStore } from "@/stores/home-mode-store";
import { useSearchParams } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Project } from "@/types";

type ViewMode = "grid" | "list";

interface CreateProjectForm {
  name: string;
  description: string;
}

function projectMeta(project: Project, showRole?: boolean): string {
  const count = project.asset_count ?? 0;
  const parts = [
    count > 0
      ? `${count} item${count !== 1 ? "s" : ""} · ${formatBytes(project.storage_bytes ?? 0)}`
      : "Empty",
  ];
  if (project.is_quick_share) parts.push("Quick shares");
  if (showRole && project.role && project.role !== "owner") parts.push("Editor");
  return parts.join(" · ");
}

function ProjectListRow({
  project,
  showRole,
}: {
  project: Project;
  showRole?: boolean;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex h-11 items-center gap-3 px-2 text-[13px] transition-colors duration-100 hover:bg-bg-hover"
    >
      <FolderOpen className="h-[15px] w-[15px] shrink-0 text-text-tertiary" />
      <span className="min-w-0 flex-1 truncate text-text-primary">{project.name}</span>
      <span className="hidden font-mono text-[12px] text-text-tertiary sm:inline">
        {projectMeta(project, showRole)}
      </span>
      <span className="hidden w-24 text-right font-mono text-[12px] text-text-tertiary md:inline">
        {new Date(project.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
    </Link>
  );
}

function ProjectSection({
  title,
  projects,
  viewMode,
  showRole,
  userId,
  onMutate,
}: {
  title: string;
  projects: Project[];
  viewMode: ViewMode;
  showRole?: boolean;
  userId?: string;
  onMutate?: () => void;
}) {
  if (projects.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 text-[13px] font-medium text-text-primary">
        {title}
        <span className="font-mono text-[12px] font-normal text-text-tertiary">
          {projects.length}
        </span>
      </h2>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              showRole={showRole}
              isOwner={!!userId && project.created_by === userId}
              onMutate={onMutate}
            />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {projects.map((project) => (
            <ProjectListRow key={project.id} project={project} showRole={showRole} />
          ))}
        </div>
      )}
    </section>
  );
}

function sortQuickShareFirst(projects: Project[]) {
  return [...projects].sort(
    (a, b) => Number(Boolean(b.is_quick_share)) - Number(Boolean(a.is_quick_share)),
  );
}

export default function ProjectsPage() {
  usePageTitle("Projects");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const homeMode = useHomeModeStore((s) => s.mode);
  const setHomeMode = useHomeModeStore((s) => s.setMode);
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Command palette / external links land on /projects?new=1 to open the
  // create dialog directly (there is no /projects/new route).
  React.useEffect(() => {
    if (searchParams.get("new")) {
      setDialogOpen(true);
      router.replace("/projects", { scroll: false });
    }
  }, [searchParams, router]);
  const [isCreating, setIsCreating] = React.useState(false);
  const [formError, setFormError] = React.useState("");

  const [form, setForm] = React.useState<CreateProjectForm>({
    name: "",
    description: "",
  });

  const {
    data: projects,
    isLoading,
    mutate,
  } = useSWR<Project[]>("/projects", () => api.get<Project[]>("/projects"));

  const myProjects = React.useMemo(
    () => sortQuickShareFirst((projects ?? []).filter((p) => p.created_by === user?.id)),
    [projects, user?.id],
  );

  const sharedProjects = React.useMemo(
    () => sortQuickShareFirst((projects ?? []).filter((p) => p.created_by !== user?.id && p.role)),
    [projects, user?.id],
  );

  const resetForm = () => {
    setForm({ name: "", description: "" });
    setFormError("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Project name is required.");
      return;
    }
    setIsCreating(true);
    setFormError("");
    try {
      const created = await api.post<Project>("/projects", {
        name: form.name.trim(),
        description: form.description.trim() || null,
      });
      await mutate();
      setDialogOpen(false);
      resetForm();
      router.push(`/projects/${created.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create project";
      setFormError(message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 pb-16 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[18px] font-semibold text-text-primary">Projects</h1>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => {
              setHomeMode("review");
              router.push("/");
            }}
            title={
              homeMode === "projects"
                ? "Switch your home screen back to the review feed"
                : "Open the review feed"
            }
          >
            <Inbox />
            Review home
          </Button>
          <Segmented
            options={[
              { value: "grid", label: "Grid view", icon: <LayoutGrid className="h-[15px] w-[15px]" /> },
              { value: "list", label: "List view", icon: <List className="h-[15px] w-[15px]" /> },
            ] as const}
            value={viewMode}
            onChange={setViewMode}
            optionClassName="px-1.5"
          />

          <Dialog.Root
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <Dialog.Trigger asChild>
              <Button size="sm">
                <Plus />
                New project
              </Button>
            </Dialog.Trigger>

            <Dialog.Portal>
              <Dialog.Overlay className={dialogOverlayClass} />
              <Dialog.Content className={cn(dialogContentClass, "max-w-md")}>
                <Dialog.Close className={dialogCloseClass} aria-label="Close">
                  <X />
                </Dialog.Close>
                <Dialog.Title className={dialogTitleClass}>New project</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Name the project and optionally describe it.
                </Dialog.Description>

                <form onSubmit={handleCreate} className="mt-3 space-y-3">
                  <Input
                    label="Name"
                    placeholder="Smarthome series"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    required
                  />

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="project-description" className="text-[12.5px] text-text-secondary">
                      Description
                    </label>
                    <textarea
                      id="project-description"
                      rows={2}
                      placeholder="Optional"
                      value={form.description}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, description: e.target.value }))
                      }
                      className="w-full resize-none rounded-md border border-border-strong bg-bg-secondary px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary transition-colors duration-100 focus:border-text-primary/60 focus:outline-none"
                    />
                  </div>

                  {formError && (
                    <p className="text-[12px] text-status-error">{formError}</p>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <Dialog.Close asChild>
                      <Button type="button" variant="ghost" size="sm">
                        Cancel
                      </Button>
                    </Dialog.Close>
                    <Button type="submit" size="sm" loading={isCreating}>
                      {isCreating ? "Creating…" : "Create project"}
                    </Button>
                  </div>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-text-tertiary">Loading…</p>
      ) : !projects || projects.length === 0 ? (
        <EmptyState
          title="No projects yet."
          action={{ label: "New project", onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <div className="space-y-8">
          <ProjectSection
            title="My projects"
            projects={myProjects}
            viewMode={viewMode}
            userId={user?.id}
            onMutate={() => mutate()}
          />
          <ProjectSection
            title="Shared with me"
            projects={sharedProjects}
            viewMode={viewMode}
            showRole
            userId={user?.id}
            onMutate={() => mutate()}
          />
        </div>
      )}
    </div>
  );
}
