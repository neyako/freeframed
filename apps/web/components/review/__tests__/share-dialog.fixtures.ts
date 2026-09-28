export function createdShareLink() {
  return {
    id: "link-1",
    token: "token",
    title: "Hero.mov",
    description: null,
    asset_id: "asset-1",
    folder_id: null,
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
  } as const;
}

export function folderShareLink() {
  return {
    ...createdShareLink(),
    id: "folder-link-1",
    token: "folder-token",
    title: "Shots",
    asset_id: null,
    folder_id: "folder-1",
  } as const;
}
