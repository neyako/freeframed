"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Plus,
  LayoutGrid,
  List,
  FolderOpen,
  X,
  Users,
  Share2,
  Globe,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/shared/empty-state";
import { useAuthStore } from "@/stores/auth-store";
import { usePageTitle } from "@/hooks/use-page-title";
import type { Project, ProjectType } from "@/types";

type ViewMode = "grid" | "list";

interface CreateProjectForm {
  name: string;
  description: string;
  project_type: ProjectType;
}

function ProjectListRow({
  project,
  showRole,
}: {
  project: Project;
  showRole?: boolean;
}) {
  const roleName =
    project.role === "owner"
      ? "Owner"
      : project.role === "editor"
        ? "Editor"
        : project.role === "reviewer"
          ? "Reviewer"
          : project.role === "viewer"
            ? "Viewer"
            : "Member";

  return (
    <a
      href={`/projects/${project.id}`}
      className="flex items-center gap-4 px-4 py-3 hover:bg-bg-hover transition-colors border-b border-border last:border-b-0"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-bg-tertiary">
        <FolderOpen className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-text-primary truncate block">
          {project.name}
        </span>
        <span className="font-mono text-[10px] tracking-[0.04em] text-text-tertiary">
          {(project.asset_count ?? 0) > 0
            ? `${project.asset_count} item${(project.asset_count ?? 0) !== 1 ? "s" : ""} · ${formatBytes(project.storage_bytes ?? 0)}`
            : "No assets yet"}
        </span>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-text-tertiary">
        <Users className="h-3 w-3" />
        {project.member_count ?? 1}
      </div>
      <span className="hidden md:block text-xs text-text-tertiary w-28">
        {new Date(project.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      {showRole && (
        <span className="hidden sm:inline-flex items-center rounded-[2px] border border-border-strong px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
          {roleName}
        </span>
      )}
    </a>
  );
}

function ProjectSection({
  title,
  icon,
  projects,
  viewMode,
  emptyMessage,
  onNewProject,
  showNewButton,
  showRole,
  userId,
  onMutate,
}: {
  title: string;
  icon?: React.ReactNode;
  projects: Project[];
  viewMode: ViewMode;
  emptyMessage: string;
  onNewProject?: () => void;
  showNewButton?: boolean;
  showRole?: boolean;
  userId?: string;
  onMutate?: () => void;
}) {
  if (projects.length === 0 && !showNewButton) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">
          {title}
        </h2>
        <span className="rounded-[2px] border border-border px-[7px] py-0.5 font-dot text-xs font-bold text-text-tertiary">
          {projects.length}
        </span>
      </div>

      {projects.length === 0 && showNewButton ? (
        <button
          onClick={onNewProject}
          className="flex w-full items-center gap-4 rounded-lg border border-dashed border-border-strong bg-transparent px-5 py-8 text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-secondary"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded border border-border-strong bg-bg-secondary">
            <Plus className="h-[18px] w-[18px]" />
          </span>
          <div className="text-left">
            <p className="text-sm font-medium text-text-primary">
              Create your first project
            </p>
            <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
              Organize and review your media assets
            </p>
          </div>
        </button>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              showRole={showRole}
              isOwner={!!userId && project.created_by === userId}
              onMutate={onMutate}
            />
          ))}
          {showNewButton && onNewProject && (
            <button
              onClick={onNewProject}
              className="flex min-h-[280px] flex-col items-center justify-center gap-3.5 rounded-lg border border-dashed border-border-strong text-text-tertiary transition-colors hover:border-text-secondary hover:text-text-secondary"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded border border-border-strong bg-bg-secondary">
                <Plus className="h-[18px] w-[18px]" />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                New project
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden bg-bg-secondary">
          {projects.map((project) => (
            <ProjectListRow
              key={project.id}
              project={project}
              showRole={showRole}
            />
          ))}
          {showNewButton && onNewProject && (
            <button
              onClick={onNewProject}
              className="flex items-center gap-3 px-4 py-3 w-full hover:bg-bg-hover transition-colors text-left border-t border-border"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-border-strong text-text-tertiary">
                <Plus className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm text-text-secondary">New Project</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  usePageTitle("Projects");
  const router = useRouter();
  const { user } = useAuthStore();
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [formError, setFormError] = React.useState("");

  const [form, setForm] = React.useState<CreateProjectForm>({
    name: "",
    description: "",
    project_type: "personal",
  });

  const {
    data: projects,
    isLoading,
    mutate,
  } = useSWR<Project[]>("/projects", () => api.get<Project[]>("/projects"));

  const myProjects = React.useMemo(
    () => (projects ?? []).filter((p) => p.created_by === user?.id),
    [projects, user?.id],
  );

  const sharedProjects = React.useMemo(
    () => (projects ?? []).filter((p) => p.created_by !== user?.id && p.role),
    [projects, user?.id],
  );

  const publicProjects = React.useMemo(
    () =>
      (projects ?? []).filter(
        (p) => p.is_public && p.created_by !== user?.id && !p.role,
      ),
    [projects, user?.id],
  );

  const resetForm = () => {
    setForm({ name: "", description: "", project_type: "personal" });
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
        project_type: form.project_type,
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
    <div className="mx-auto w-full max-w-[1360px] px-4 sm:px-8 lg:px-10 pt-6 sm:pt-10 pb-24 space-y-9">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="font-sans text-[clamp(26px,4vw,36px)] font-medium tracking-[-0.02em] leading-none text-text-primary">
            Projects
          </h1>
          {projects && projects.length > 0 && (
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
              <span className="font-dot text-[13px] font-bold text-text-secondary">
                {projects.length}
              </span>{" "}
              project{projects.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Segmented
            options={[
              {
                value: "grid",
                label: "Grid view",
                icon: <LayoutGrid className="h-[13px] w-[13px]" />,
              },
              {
                value: "list",
                label: "List view",
                icon: <List className="h-[13px] w-[13px]" />,
              },
            ] as const}
            value={viewMode}
            onChange={setViewMode}
          />

          <Dialog.Root
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <Dialog.Trigger asChild>
              <Button size="sm" className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </Dialog.Trigger>

            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-secondary p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                <Dialog.Close className="absolute right-4 top-4 text-text-tertiary hover:text-text-primary transition-colors">
                  <X className="h-4 w-4" />
                </Dialog.Close>

                <Dialog.Title className="text-base font-semibold text-text-primary">
                  New Project
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-text-secondary">
                  Create a new project to organize your assets.
                </Dialog.Description>

                <form onSubmit={handleCreate} className="mt-5 space-y-4">
                  <Input
                    label="Project name"
                    placeholder="e.g. Brand Campaign 2025"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    required
                  />

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-text-secondary">
                      Description
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Optional description..."
                      value={form.description}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, description: e.target.value }))
                      }
                      className="flex w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus"
                    />
                  </div>

                  {formError && (
                    <p className="text-sm text-status-error">{formError}</p>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Dialog.Close asChild>
                      <Button type="button" variant="secondary" size="sm">
                        Cancel
                      </Button>
                    </Dialog.Close>
                    <Button type="submit" size="sm" loading={isCreating}>
                      Create project
                    </Button>
                  </div>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col rounded-lg overflow-hidden border border-border"
            >
              <div className="aspect-square animate-pulse bg-bg-tertiary" />
              <div className="px-3 py-2.5">
                <div className="h-3 w-2/3 animate-pulse rounded bg-bg-tertiary" />
              </div>
            </div>
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-secondary">
          <EmptyState
            icon={FolderOpen}
            title="No projects yet"
            description="Create your first project to start organizing assets."
            action={{
              label: "New Project",
              onClick: () => setDialogOpen(true),
            }}
          />
        </div>
      ) : (
        <div className="space-y-8">
          <ProjectSection
            title="My Projects"
            icon={<FolderOpen className="h-4 w-4 text-text-tertiary" />}
            projects={myProjects}
            viewMode={viewMode}
            emptyMessage="You haven't created any projects yet."
            onNewProject={() => setDialogOpen(true)}
            showNewButton
            userId={user?.id}
            onMutate={() => mutate()}
          />
          {sharedProjects.length > 0 && (
            <ProjectSection
              title="Shared with Me"
              icon={<Share2 className="h-4 w-4 text-text-tertiary" />}
              projects={sharedProjects}
              viewMode={viewMode}
              emptyMessage=""
              showRole
              userId={user?.id}
              onMutate={() => mutate()}
            />
          )}
          {publicProjects.length > 0 && (
            <ProjectSection
              title="Public Projects"
              icon={<Globe className="h-4 w-4 text-text-tertiary" />}
              projects={publicProjects}
              viewMode={viewMode}
              emptyMessage=""
              userId={user?.id}
              onMutate={() => mutate()}
            />
          )}
        </div>
      )}
    </div>
  );
}
