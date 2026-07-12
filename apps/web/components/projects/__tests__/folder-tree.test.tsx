import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FolderTree } from '../folder-tree'

const tree = [
  {
    id: 'folder-a',
    name: 'Shared A',
    parent_id: null,
    item_count: 1,
    children: [
      {
        id: 'folder-a1',
        name: 'Child A1',
        parent_id: 'folder-a',
        item_count: 0,
        children: [],
      },
    ],
  },
]

describe('FolderTree scoped roots', () => {
  it('omits project root, trash, context, and drop targets while navigating descendants', () => {
    const onSelectFolder = vi.fn()
    const { container } = render(
      <FolderTree
        tree={tree}
        projectName="Private project root"
        currentFolderId="folder-a"
        showTrash={false}
        scopedRoots
        onSelectFolder={onSelectFolder}
        onShowTrash={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        onDropItems={vi.fn()}
      />,
    )

    expect(screen.queryByText('Private project root')).not.toBeInTheDocument()
    expect(screen.queryByText('Recently Deleted')).not.toBeInTheDocument()
    expect(container.querySelector('[draggable="true"]')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Shared A'))
    fireEvent.click(screen.getByText('Child A1'))
    expect(onSelectFolder).toHaveBeenCalledWith('folder-a1')
  })
})
