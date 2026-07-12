"use client";

import * as React from "react";
import { Loader2, Users } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { SharePermission } from "@/types";
import { PermissionSelect } from "./share-permission-select";
import type { DirectShare, PeopleShareTarget } from "./share-targets";

const PROJECT_SHARE_PERMISSIONS = [
  "view",
  "approve",
] satisfies readonly SharePermission[];
const ASSET_SHARE_PERMISSIONS = [
  "view",
  "comment",
  "approve",
] satisfies readonly SharePermission[];

const DIRECT_SHARES_PATH = {
  asset: (id) => `/assets/${id}/direct-shares`,
  folder: (id) => `/folders/${id}/direct-shares`,
} satisfies Record<
  Exclude<PeopleShareTarget["kind"], "project">,
  (id: string) => string
>;

const DIRECT_USER_PATH: Record<PeopleShareTarget["kind"], (id: string) => string> = {
  asset: (id) => `/assets/${id}/share/user`,
  folder: (id) => `/folders/${id}/share/user`,
  project: (id) => `/projects/${id}/share/user`,
};

interface DirectTabProps {
  readonly target: PeopleShareTarget;
}

export function DirectTab({ target }: DirectTabProps) {
  const [userEmail, setUserEmail] = React.useState("");
  const [userPermission, setUserPermission] =
    React.useState<SharePermission>("view");
  const [sharingUser, setSharingUser] = React.useState(false);
  const [userError, setUserError] = React.useState<string | null>(null);
  const [userSuccess, setUserSuccess] = React.useState(false);

  const [shares, setShares] = React.useState<readonly DirectShare[]>([]);
  const [loadingShares, setLoadingShares] = React.useState(true);

  React.useEffect(() => {
    if (!target.id) return;
    if (target.kind === "project") {
      setShares([]);
      setLoadingShares(false);
      return;
    }
    setLoadingShares(true);
    api
      .get<readonly DirectShare[]>(DIRECT_SHARES_PATH[target.kind](target.id))
      .then((res) => setShares(res))
      .catch(() => setShares([]))
      .finally(() => setLoadingShares(false));
  }, [target.id, target.kind]);

  async function handleShareUser(event: React.FormEvent) {
    event.preventDefault();
    if (!userEmail.trim()) return;
    setSharingUser(true);
    setUserError(null);
    setUserSuccess(false);
    try {
      const res = await api.post<DirectShare>(
        DIRECT_USER_PATH[target.kind](target.id),
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

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-secondary">
          Share with user
        </p>
        <form onSubmit={handleShareUser} className="space-y-2">
          <input
            type="email"
            value={userEmail}
            onChange={(event) => setUserEmail(event.target.value)}
            placeholder="user@example.com"
            className="flex h-9 w-full rounded-md border border-border bg-bg-secondary px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-focus"
          />
          <div className="flex items-center gap-2">
            <PermissionSelect
              value={userPermission}
              onChange={setUserPermission}
              permissions={
                target.kind === "project"
                  ? PROJECT_SHARE_PERMISSIONS
                  : ASSET_SHARE_PERMISSIONS
              }
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

      {(loadingShares || shares.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">
            Current shares
          </p>
          {loadingShares ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
              <span className="text-xs text-text-tertiary">Loading...</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center justify-between rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    <span className="truncate text-text-secondary">
                      User {share.shared_with_user_id.slice(0, 8)}...
                    </span>
                  </div>
                  <span className="ml-2 shrink-0 text-text-tertiary capitalize">
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
