"use client";

import * as React from "react";
import * as Select from "@radix-ui/react-select";
import {
  Copy,
  Check,
  Link2,
  Users,
  ChevronDown,
  Loader2,
  Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ShareLink, SharePermission, Team, AssetResponse } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type AssetShareLink = Omit<ShareLink, "created_by" | "deleted_at"> &
  Partial<Pick<ShareLink, "created_by" | "deleted_at">> & { url?: string };

interface DirectShare {
  id: string;
  asset_id?: string | null;
  folder_id?: string | null;
  shared_with_user_id: string | null;
  shared_with_team_id?: string | null;
  permission: SharePermission;
  created_at?: string;
}

interface TeamsResponse {
  teams: Team[];
}

// ─── Permission select ────────────────────────────────────────────────────────

interface PermissionSelectProps {
  value: SharePermission;
  onChange: (value: SharePermission) => void;
  disabled?: boolean;
}

function PermissionSelect({
  value,
  onChange,
  disabled,
}: PermissionSelectProps) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => onChange(v as SharePermission)}
      disabled={disabled}
    >
      <Select.Trigger
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-bg-secondary px-3 text-sm text-text-primary",
          "focus:outline-none focus:border-border-focus",
          "data-[placeholder]:text-text-tertiary disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="z-[200] min-w-[160px] overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-xl"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {(["view", "comment", "approve"] as SharePermission[]).map((p) => (
              <Select.Item
                key={p}
                value={p}
                className="relative flex cursor-pointer select-none items-center rounded px-3 py-2 text-sm text-text-primary outline-none hover:bg-bg-hover data-[highlighted]:bg-bg-hover capitalize"
              >
                <Select.ItemText>{p}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-status-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

interface SingleLinkSectionProps {
  assetId: string;
}

function SingleLinkSection({ assetId }: SingleLinkSectionProps) {
  const [link, setLink] = React.useState<AssetShareLink | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const links = await api.get<AssetShareLink[]>(`/assets/${assetId}/shares`);
        const existing =
          links.find((candidate) => candidate.is_enabled) ??
          links[0];
        if (existing) {
          if (!cancelled) setLink(existing);
          return;
        }

        const created = await api.post<AssetShareLink>(
          `/assets/${assetId}/share`,
          {
            permission: "comment",
            allow_download: false,
          },
        );
        if (!cancelled) setLink(created);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load share link");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const url =
    link?.url ??
    (link
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`
      : "");

  async function patchLink(
    updates: Partial<Pick<ShareLink, "permission" | "allow_download">>,
  ) {
    if (!link) return;
    const previous = link;
    setSaving(true);
    setError(null);
    setLink({ ...link, ...updates });
    try {
      const updated = await api.patch<AssetShareLink>(
        `/share/${link.token}`,
        updates,
      );
      setLink({ ...updated, url: previous.url ?? updated.url });
    } catch (err) {
      setLink(previous);
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        <span className="text-xs text-text-tertiary">
          Preparing share link…
        </span>
      </div>
    );
  }

  if (!link) {
    return (
      <p className="py-2 text-xs text-status-error">
        {error ?? "No share link"}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-text-tertiary" />
        <span className="text-sm font-medium text-text-primary">
          Anyone with the link
        </span>
        <div className="ml-auto">
          <PermissionSelect
            value={link.permission}
            onChange={(permission) => void patchLink({ permission })}
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2">
        <span className="flex-1 truncate font-mono text-xs text-text-primary">
          {url}
        </span>
        <CopyButton text={url} />
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={link.allow_download}
          onChange={(e) => void patchLink({ allow_download: e.target.checked })}
          disabled={saving}
          className="rounded border-border"
        />
        <span className="text-sm text-text-secondary">Allow download</span>
      </label>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}

// ─── Direct tab ───────────────────────────────────────────────────────────────

interface DirectTabProps {
  assetId: string;
  orgId?: string;
}

function DirectTab({ assetId, orgId }: DirectTabProps) {
  const [userEmail, setUserEmail] = React.useState("");
  const [userPermission, setUserPermission] =
    React.useState<SharePermission>("view");
  const [sharingUser, setSharingUser] = React.useState(false);
  const [userError, setUserError] = React.useState<string | null>(null);
  const [userSuccess, setUserSuccess] = React.useState(false);

  const [selectedTeamId, setSelectedTeamId] = React.useState("");
  const [teamPermission, setTeamPermission] =
    React.useState<SharePermission>("view");
  const [sharingTeam, setSharingTeam] = React.useState(false);
  const [teamError, setTeamError] = React.useState<string | null>(null);
  const [teamSuccess, setTeamSuccess] = React.useState(false);

  const [teams, setTeams] = React.useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = React.useState(false);

  const [shares, setShares] = React.useState<DirectShare[]>([]);
  const [loadingShares, setLoadingShares] = React.useState(true);

  // Load teams for selector
  React.useEffect(() => {
    if (!orgId) return;
    setLoadingTeams(true);
    api
      .get<TeamsResponse>(`/organizations/${orgId}/teams`)
      .then((res) => setTeams(res.teams))
      .catch(() => setTeams([]))
      .finally(() => setLoadingTeams(false));
  }, [orgId]);

  // Load current shares
  React.useEffect(() => {
    if (!assetId) return;
    setLoadingShares(true);
    api
      .get<DirectShare[]>(`/assets/${assetId}/direct-shares`)
      .then((res) => setShares(res))
      .catch(() => setShares([]))
      .finally(() => setLoadingShares(false));
  }, [assetId]);

  async function handleShareUser(e: React.FormEvent) {
    e.preventDefault();
    if (!userEmail.trim()) return;
    setSharingUser(true);
    setUserError(null);
    setUserSuccess(false);
    try {
      const res = await api.post<DirectShare>(
        `/assets/${assetId}/share/user`,
        {
          email: userEmail.trim(),
          permission: userPermission,
        },
      );
      setShares((prev) => [...prev, res]);
      setUserEmail("");
      setUserSuccess(true);
      setTimeout(() => setUserSuccess(false), 3000);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharingUser(false);
    }
  }

  async function handleShareTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTeamId) return;
    setSharingTeam(true);
    setTeamError(null);
    setTeamSuccess(false);
    try {
      const res = await api.post<DirectShare>(
        `/assets/${assetId}/share/team`,
        {
          team_id: selectedTeamId,
          permission: teamPermission,
        },
      );
      setShares((prev) => [...prev, res]);
      setSelectedTeamId("");
      setTeamSuccess(true);
      setTimeout(() => setTeamSuccess(false), 3000);
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setSharingTeam(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Share with user */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-secondary">
          Share with user
        </p>
        <form onSubmit={handleShareUser} className="space-y-2">
          <div>
            <input
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="user@example.com"
              className="flex h-9 w-full rounded-md border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
            />
          </div>
          <div className="flex items-center gap-2">
            <PermissionSelect
              value={userPermission}
              onChange={setUserPermission}
            />
            <Button
              type="submit"
              size="sm"
              loading={sharingUser}
              disabled={!userEmail.trim()}
              className="ml-auto"
            >
              Share
            </Button>
          </div>
        </form>
        {userError && <p className="text-xs text-status-error">{userError}</p>}
        {userSuccess && (
          <p className="text-xs text-status-success">Shared successfully!</p>
        )}
      </div>

      {/* Share with team */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-secondary">
          Share with team
        </p>
        <form onSubmit={handleShareTeam} className="space-y-2">
          <div>
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              disabled={loadingTeams}
              className="flex h-9 w-full rounded-md border border-border bg-bg-secondary px-3 text-sm text-text-primary focus:outline-none focus:border-border-focus disabled:opacity-50"
            >
              <option value="">Select a team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <PermissionSelect
              value={teamPermission}
              onChange={setTeamPermission}
            />
            <Button
              type="submit"
              size="sm"
              loading={sharingTeam}
              disabled={!selectedTeamId}
              className="ml-auto"
            >
              Share
            </Button>
          </div>
        </form>
        {teamError && <p className="text-xs text-status-error">{teamError}</p>}
        {teamSuccess && (
          <p className="text-xs text-status-success">Shared with team!</p>
        )}
      </div>

      {/* Current shares list */}
      {(loadingShares || shares.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">
            Current shares
          </p>
          {loadingShares ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
              <span className="text-xs text-text-tertiary">Loading…</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center justify-between rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Users className="h-3.5 w-3.5 text-text-tertiary shrink-0" />
                    <span className="text-text-secondary truncate">
                      {share.shared_with_user_id
                        ? `User ${share.shared_with_user_id.slice(0, 8)}…`
                        : `Team ${share.shared_with_team_id?.slice(0, 8)}…`}
                    </span>
                  </div>
                  <span className="text-text-tertiary capitalize shrink-0 ml-2">
                    {share.permission}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Share Dialog (Dropdown) ─────────────────────────────────────────────────

interface ShareDialogProps {
  assetId: string;
  assetName?: string;
  projectId?: string;
  asset?: AssetResponse | null;
}

export function ShareDialog({
  assetId,
  projectId,
}: ShareDialogProps) {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target;
      const isSelectPortal =
        target instanceof HTMLElement &&
        target.closest("[data-radix-popper-content-wrapper]");
      if (dropdownRef.current && !dropdownRef.current.contains(target as Node) && !isSelectPortal) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  // Close dropdown on Escape
  React.useEffect(() => {
    if (!dropdownOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [dropdownOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className={cn(dropdownOpen && "bg-bg-hover")}
      >
        <Share2 className="h-4 w-4" />
        Share
      </Button>

      {dropdownOpen && (
        <div
          className={cn(
            "fixed left-2 right-2 top-12 z-50 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80",
            "rounded-xl border border-border bg-bg-elevated p-3 shadow-xl",
            "animate-in fade-in-0 zoom-in-95 duration-150 space-y-4",
          )}
        >
          <SingleLinkSection assetId={assetId} />
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-text-secondary">
              Share with people
            </p>
            <DirectTab assetId={assetId} orgId={projectId} />
          </div>
        </div>
      )}
    </div>
  );
}
