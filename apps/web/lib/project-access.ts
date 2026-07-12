import type {
  FolderDirectAccess,
  FolderDirectProject,
  FolderTreeNode,
  ProjectAccessResponse,
  SharePermission,
} from '@/types'

const permissionRank: Readonly<Record<SharePermission, number>> = {
  view: 1,
  comment: 2,
  approve: 3,
}

export function isFolderDirectProject(
  project: ProjectAccessResponse | undefined,
): project is FolderDirectProject {
  return project?.folder_access?.kind === 'folder_direct'
}

export function hasFullProjectAccess(project: ProjectAccessResponse | undefined): boolean {
  return !isFolderDirectProject(project) && (project?.role != null || project?.is_public === true)
}

export function findFolderPath(
  tree: readonly FolderTreeNode[],
  folderId: string,
): readonly string[] | null {
  for (const node of tree) {
    if (node.id === folderId) return [node.id]
    const childPath = findFolderPath(node.children, folderId)
    if (childPath !== null) return [node.id, ...childPath]
  }
  return null
}

export function resolveFolderPermission(
  access: FolderDirectAccess,
  folderId: string,
  tree: readonly FolderTreeNode[],
): SharePermission | null {
  const path = findFolderPath(tree, folderId)
  if (path === null) return null
  const ancestors = new Set(path)
  let resolved: SharePermission | null = null
  for (const grant of access.grants) {
    if (!ancestors.has(grant.folder_id)) continue
    if (resolved === null || permissionRank[grant.permission] > permissionRank[resolved]) {
      resolved = grant.permission
    }
  }
  return resolved
}
