import type { SharePermission, Team } from "@/types";

export type ShareTarget =
  | { readonly kind: "asset"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string }
  | { readonly kind: "project"; readonly id: string; readonly name?: string };

export type PeopleShareTarget =
  | { readonly kind: "asset"; readonly id: string }
  | { readonly kind: "folder"; readonly id: string };

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
  readonly url?: string;
  readonly asset_id?: string | null;
  readonly folder_id?: string | null;
  readonly project_id?: string | null;
}

export interface ManagedShareLink extends ShareLinkCandidate {
  readonly allow_download: boolean;
}

export interface DirectShare {
  readonly id: string;
  readonly asset_id?: string | null;
  readonly folder_id?: string | null;
  readonly shared_with_user_id: string | null;
  readonly shared_with_team_id?: string | null;
  readonly permission: SharePermission;
  readonly created_at?: string;
}

export interface TeamsResponse {
  readonly teams: readonly Team[];
}
