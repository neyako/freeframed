// ─── Enums ───────────────────────────────────────────────────────────────────

export type AssetType = "image" | "audio" | "video";

export type AssetStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";

export type AssetVersionStatus = "uploading" | "processing" | "ready" | "failed";

export type ProjectRole = "owner" | "editor";

export type SharePermission = "view" | "comment";

export type UserStatus = "active" | "deactivated" | "pending_invite" | "pending_verification";

export type FileType = "image" | "audio" | "video" | "document";

export type ApprovalStatus = "approved" | "rejected" | "pending";

// ─── Core Entities ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  status: UserStatus;
  is_superadmin: boolean;
  email_verified: boolean;
  preferences: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  poster_url?: string | null;
  is_quick_share?: boolean;
  created_at: string;
  deleted_at: string | null;
  asset_count?: number;
  storage_bytes?: number;
  member_count?: number;
  role?: ProjectRole | null;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  invited_by: string | null;
  invited_at: string | null;
  deleted_at: string | null;
}

// ─── Asset & Media Entities ───────────────────────────────────────────────────

export interface Asset {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  asset_type: AssetType;
  status: AssetStatus;
  folder_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AssetVersion {
  id: string;
  asset_id: string;
  version_number: number;
  processing_status: AssetVersionStatus;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
  files?: MediaFile[];
}

/** Backend returns AssetResponse with latest_version embedded */
export interface AssetResponse extends Asset {
  latest_version: AssetVersion | null;
  thumbnail_url: string | null;
  /** Runtime goal (e.g. 180 for Shorts), compared to the after-cut runtime */
  target_duration_seconds?: number | null;
}

export interface MediaFile {
  id: string;
  version_id: string;
  file_type: FileType;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  s3_key_raw: string | null;
  s3_key_processed: string | null;
  s3_key_thumbnail: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  fps: number | null;
  sequence_order: number | null;
  created_at: string;
}

// ─── Comments & Annotations ───────────────────────────────────────────────────

export interface GuestUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface CommentAuthor {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface GuestAuthor {
  id: string;
  name: string;
}

export interface Comment {
  id: string;
  asset_id: string;
  version_id: string;
  parent_id: string | null;
  author_id: string | null;
  guest_author_id: string | null;
  timecode_start: number | null;
  timecode_end: number | null;
  body: string;
  resolved: boolean;
  visibility: string;
  /** The range should come out of the edit */
  is_cut?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  author?: CommentAuthor | null;
  guest_author?: GuestAuthor | null;
}

export interface Annotation {
  id: string;
  comment_id: string;
  drawing_data: Record<string, unknown>;
  frame_number: number | null;
}

export interface CommentAttachment {
  id: string;
  comment_id: string;
  file_type: FileType;
  s3_key: string;
  original_filename: string;
  file_size_bytes: number;
  created_at: string;
}

export interface CommentReaction {
  id: string;
  comment_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

// ─── Approvals & Sharing ──────────────────────────────────────────────────────

export interface Approval {
  id: string;
  asset_id: string;
  version_id: string;
  user_id: string;
  status: ApprovalStatus;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface ShareLinkAppearance {
  layout: "grid" | "list"
  theme: "dark" | "light"
  accent_color: string | null
  open_in_viewer: boolean
  sort_by: "name" | "created_at" | "file_size"
  card_size: "s" | "m" | "l"
  aspect_ratio: "landscape" | "square" | "portrait"
  thumbnail_scale: "fit" | "fill"
  show_card_info: boolean
}

export type ShareVisibility = "public" | "secure";

export interface ShareLink {
  id: string;
  asset_id: string | null;
  folder_id: string | null;
  token: string;
  title: string;
  description: string | null;
  created_by: string;
  expires_at: string | null;
  permission: SharePermission;
  allow_download: boolean;
  is_enabled: boolean;
  visibility: ShareVisibility;
  show_versions: boolean;
  show_watermark: boolean;
  appearance: ShareLinkAppearance | null;
  created_at: string;
  deleted_at: string | null;
  has_password: boolean;
}

export interface FolderShareAssetItem {
  id: string
  name: string
  asset_type: string
  thumbnail_url: string | null
  file_size: number | null
  duration_seconds: number | null
  comment_count: number
  created_by_name: string | null
  created_at: string
}

export interface FolderShareSubfolder {
  id: string
  name: string
  item_count: number
  thumbnail_urls: string[]
}

export interface FolderShareAssetsResponse {
  assets: FolderShareAssetItem[]
  subfolders: FolderShareSubfolder[]
  total: number
  page: number
  per_page: number
}

// ─── Folders ──────────────────────────────────────────────────────────────────

export interface Folder {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  created_by: string
  created_at: string
  updated_at: string
  item_count: number
}

export interface FolderTreeNode {
  id: string
  name: string
  parent_id: string | null
  item_count: number
  children: FolderTreeNode[]
}

export interface TrashItem {
  id: string
  name: string
  type: string
  parent_id?: string | null
  folder_id?: string | null
  deleted_at: string | null
}

export interface TrashResponse {
  folders: TrashItem[]
  assets: TrashItem[]
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiError {
  detail: string;
  status_code: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface SetupStatus {
  needs_setup: boolean;
}

export interface MagicCodeResponse {
  message: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}
