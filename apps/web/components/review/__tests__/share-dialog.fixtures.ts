export function createdShareLink() {
  return {
    id: "link-1",
    token: "token",
    title: "Hero.mov",
    description: null,
    share_type: "asset",
    target_name: "Hero.mov",
    asset_id: "asset-1",
    folder_id: null,
    project_id: "project-1",
    permission: "comment",
    expires_at: null,
    allow_download: false,
    show_versions: true,
    is_enabled: true,
    appearance: null,
    created_by: "user-1",
    created_at: "2026-06-29T00:00:00Z",
    deleted_at: null,
    has_password: false,
    password_value: null,
  } as const;
}

export function directShare() {
  return {
    id: "direct-share-1",
    asset_id: "asset-1",
    folder_id: null,
    shared_with_user_id: "user-12345678",
    shared_with_team_id: null,
    permission: "view",
    created_at: "2026-06-29T00:00:00Z",
  } as const;
}

export function folderShareLink() {
  return {
    ...createdShareLink(),
    id: "folder-link-1",
    token: "folder-token",
    title: "Shots",
    share_type: "folder",
    target_name: "Shots",
    asset_id: null,
    folder_id: "folder-1",
  } as const;
}

export function assetShareListItem() {
  return {
    id: "asset-link-1",
    token: "asset-token",
    title: "Hero.mov",
    description: null,
    is_enabled: true,
    permission: "comment",
    share_type: "asset",
    target_name: "Hero.mov",
    view_count: 0,
    last_viewed_at: null,
  } as const;
}

export function projectShareListItem() {
  return {
    id: "project-link-1",
    token: "project-token",
    title: "Launch Film",
    description: null,
    is_enabled: true,
    permission: "view",
    share_type: "folder",
    target_name: "Launch Film",
    view_count: 0,
    last_viewed_at: null,
  } as const;
}

export function legacyProjectShareListItem() {
  return {
    ...projectShareListItem(),
    title: "Shared Project",
    target_name: "Shared Project",
  } as const;
}

export function projectShareDetails() {
  return {
    ...createdShareLink(),
    id: "project-link-1",
    token: "project-token",
    title: "Launch Film",
    share_type: "folder",
    target_name: "Launch Film",
    asset_id: null,
    folder_id: null,
    project_id: "project-1",
    permission: "view",
    allow_download: true,
  } as const;
}

export function legacyProjectShareDetails() {
  return {
    ...projectShareDetails(),
    title: "Shared Project",
    target_name: "Shared Project",
  } as const;
}

export function bulkShareLink() {
  return {
    ...createdShareLink(),
    id: "bulk-link-1",
    token: "bulk-token",
    title: "Share 2 items",
    share_type: "multi",
    target_name: "Share 2 items",
    asset_id: null,
    folder_id: null,
  } as const;
}
