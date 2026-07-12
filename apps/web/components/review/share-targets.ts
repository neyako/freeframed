import type { SharePermission, ShareVisibility } from "@/types";

export type { ShareVisibility } from "@/types";

export type ShareTarget =
  | { readonly kind: "asset"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string }
  | { readonly kind: "project"; readonly id: string; readonly name?: string };

export type PeopleShareTarget = ShareTarget;

export interface ShareListEnvelope {
  readonly share_links: readonly ShareLinkCandidate[];
}

export interface ShareLinkCandidate {
  readonly id: string;
  readonly token: string;
  readonly title: string;
  readonly description: string | null;
  readonly permission: SharePermission;
  readonly is_enabled: boolean;
  readonly allow_download?: boolean;
  readonly show_versions?: boolean;
  readonly show_watermark?: boolean;
  readonly visibility?: ShareVisibility;
  readonly expires_at?: string | null;
  readonly has_password?: boolean;
  readonly url?: string;
  readonly asset_id?: string | null;
  readonly folder_id?: string | null;
  readonly project_id?: string | null;
}

export interface ManagedShareLink extends ShareLinkCandidate {
  readonly allow_download: boolean;
}

export interface ShareLinkPatch {
  readonly permission?: SharePermission;
  readonly allow_download?: boolean;
  readonly visibility?: ShareVisibility;
  readonly show_watermark?: boolean;
  readonly expires_at?: string | null;
  readonly is_enabled?: boolean;
  readonly password?: string;
}

export function previewShareLinkPatch(
  link: ManagedShareLink,
  updates: ShareLinkPatch,
): ManagedShareLink {
  const { password, ...linkUpdates } = updates;
  return {
    ...link,
    ...linkUpdates,
    ...(password !== undefined ? { has_password: password.length > 0 } : {}),
  };
}

export interface DirectShare {
  readonly id: string;
  readonly asset_id?: string | null;
  readonly folder_id?: string | null;
  readonly project_id?: string | null;
  readonly shared_with_user_id: string;
  readonly permission: SharePermission;
  readonly created_at?: string;
}
