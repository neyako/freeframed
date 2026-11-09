import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const stats = vi.hoisted(() => ({ current: {} as Record<string, number | null> }))
vi.mock('swr', () => ({ default: () => ({ data: stats.current }) }))

import { StorageMeter } from '../storage-meter'

const GB = 1024 ** 3

describe('StorageMeter', () => {
  it('fills by how full the disk is, not by the app share alone, and warns near full', () => {
    // 16 MB of app data on a 16 GB disk that other files have filled to 95%
    stats.current = { used_bytes: 16 * 1024 ** 2, disk_total_bytes: 16 * GB, disk_free_bytes: 0.8 * GB }
    const { container } = render(<StorageMeter />)

    const disk = container.querySelector('[title] > div') as HTMLDivElement
    expect(disk.style.width).toBe('95%')
    expect(disk.className).toContain('bg-accent')
    expect(screen.getByText(/ free$/).className).toContain('text-accent')
  })
})
