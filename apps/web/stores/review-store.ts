import { create } from 'zustand'
import type { Asset, AssetVersion } from '@/types'

type DrawingTool = 'pen' | 'rectangle' | 'arrow' | 'line'
export type TimeFormat = 'standard' | 'timecode' | 'frames'

interface ReviewState {
  currentAsset: Asset | null
  currentVersion: AssetVersion | null
  playheadTime: number
  rangeStart: number | null
  rangeEnd: number | null
  seekTarget: { time: number; id: number; pause?: boolean } | null
  focusedCommentId: string | null
  pendingAnnotation: Record<string, unknown> | null
  activeAnnotation: Record<string, unknown> | null
  timeFormat: TimeFormat
  isDrawingMode: boolean
  drawingTool: DrawingTool
  drawingColor: string
  brushSize: number
  setCurrentAsset: (asset: Asset) => void
  setCurrentVersion: (version: AssetVersion) => void
  setPlayheadTime: (time: number) => void
  setRangeStart: (time: number | null) => void
  setRangeEnd: (time: number | null) => void
  clearRange: () => void
  seekTo: (time: number, pause?: boolean) => void
  setFocusedCommentId: (id: string | null) => void
  setPendingAnnotation: (data: Record<string, unknown> | null) => void
  setActiveAnnotation: (data: Record<string, unknown> | null) => void
  setTimeFormat: (format: TimeFormat) => void
  toggleDrawingMode: () => void
  setIsDrawingMode: (mode: boolean) => void
  setDrawingTool: (tool: DrawingTool) => void
  setDrawingColor: (color: string) => void
  setBrushSize: (size: number) => void
  reset: () => void
}

const initialState = {
  currentAsset: null,
  currentVersion: null,
  playheadTime: 0,
  rangeStart: null,
  rangeEnd: null,
  seekTarget: null,
  focusedCommentId: null,
  pendingAnnotation: null,
  activeAnnotation: null,
  timeFormat: 'timecode' as TimeFormat,
  isDrawingMode: false,
  drawingTool: 'pen' as DrawingTool,
  drawingColor: '#FF3B30',
  brushSize: 4,
}

export const useReviewStore = create<ReviewState>()((set, get) => ({
  ...initialState,

  setCurrentAsset: (asset: Asset) => {
    // Polling refreshes the same asset; only a real switch resets the playhead,
    // the I/O range and any drawing left over from the previous asset.
    if (get().currentAsset?.id === asset.id) {
      set({ currentAsset: asset })
      return
    }
    set({
      currentAsset: asset,
      playheadTime: 0,
      seekTarget: null,
      rangeStart: null,
      rangeEnd: null,
      isDrawingMode: false,
      pendingAnnotation: null,
      activeAnnotation: null,
    })
  },

  setCurrentVersion: (version: AssetVersion) => {
    // Polling refreshes the same version; only a real switch drops the old
    // version's focused comment and annotation overlay.
    if (get().currentVersion?.id === version.id) set({ currentVersion: version })
    else set({ currentVersion: version, focusedCommentId: null, activeAnnotation: null })
  },

  setPlayheadTime: (time: number) => {
    set({ playheadTime: time })
  },

  setRangeStart: (time: number | null) => {
    set({ rangeStart: time })
  },

  setRangeEnd: (time: number | null) => {
    set({ rangeEnd: time })
  },

  clearRange: () => {
    set({ rangeStart: null, rangeEnd: null })
  },

  seekTo: (time: number, pause?: boolean) => {
    set({ seekTarget: { time, id: Date.now(), pause }, playheadTime: time })
  },

  setFocusedCommentId: (id: string | null) => {
    set({ focusedCommentId: id })
  },

  setPendingAnnotation: (data: Record<string, unknown> | null) => {
    set({ pendingAnnotation: data })
  },

  setActiveAnnotation: (data: Record<string, unknown> | null) => {
    set({ activeAnnotation: data })
  },

  setTimeFormat: (format: TimeFormat) => {
    set({ timeFormat: format })
  },

  toggleDrawingMode: () => {
    set((state) => ({ isDrawingMode: !state.isDrawingMode }))
  },

  setIsDrawingMode: (mode: boolean) => {
    set({ isDrawingMode: mode })
  },

  setDrawingTool: (tool: DrawingTool) => {
    set({ drawingTool: tool })
  },

  setDrawingColor: (color: string) => {
    set({ drawingColor: color })
  },

  setBrushSize: (size: number) => {
    set({ brushSize: size })
  },

  reset: () => {
    set(initialState)
  },
}))

/** The current version's frame rate, for SMPTE timecode and frame counts */
export const selectFps = (s: ReviewState): number =>
  s.currentVersion?.files?.find((f) => f.fps)?.fps ?? 24
