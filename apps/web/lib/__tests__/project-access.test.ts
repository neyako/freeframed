import { describe, expect, it } from 'vitest'

import { isFolderDirectProject, resolveFolderPermission } from '@/lib/project-access'
import type { FolderDirectProject } from '@/types'

describe('folder-direct project envelope', () => {
  it('keeps every grant while exposing only minimal browse roots', () => {
    const project: FolderDirectProject = {
      id: 'project-1',
      name: 'Scoped project',
      asset_count: 5,
      storage_bytes: 150,
      member_count: 0,
      role: null,
      folder_access: {
        kind: 'folder_direct',
        accessible_root_ids: ['folder-a', 'folder-b'],
        grants: [
          { folder_id: 'folder-a', permission: 'view' },
          { folder_id: 'folder-a1', permission: 'approve' },
          { folder_id: 'folder-b', permission: 'comment' },
        ],
      },
    }

    expect(project.folder_access?.accessible_root_ids).toEqual(['folder-a', 'folder-b'])
    expect(project.folder_access?.grants).toHaveLength(3)
    expect(isFolderDirectProject(project)).toBe(true)
    if (!project.folder_access) throw new Error('missing fixture access')
    const tree = [
      {
        id: 'folder-a', name: 'A', parent_id: null, item_count: 0,
        children: [{ id: 'folder-a1', name: 'A1', parent_id: 'folder-a', item_count: 0, children: [] }],
      },
      { id: 'folder-b', name: 'B', parent_id: null, item_count: 0, children: [] },
    ]
    expect(resolveFolderPermission(project.folder_access, 'folder-a', tree)).toBe('view')
    expect(resolveFolderPermission(project.folder_access, 'folder-a1', tree)).toBe('approve')
    expect(resolveFolderPermission(project.folder_access, 'folder-b', tree)).toBe('comment')
  })
})
