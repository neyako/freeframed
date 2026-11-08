import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '../utils'

// A plain-HTTP origin has no navigator.clipboard. execCommand('copy') fires a
// cancelable `copy` event; a listener that cancels it supplies the clipboard text.
let clipboard: string | null
let execCommand: ReturnType<typeof vi.fn>

function simulatedCopy(): boolean {
  const data: Record<string, string> = {}
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (type: string, value: string) => { data[type] = value } },
  })
  const target = document.activeElement ?? document.body
  if (!target.dispatchEvent(event)) clipboard = data['text/plain'] ?? ''
  return true
}

function setClipboardApi(api: { writeText: (t: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: api, configurable: true })
}

describe('copyToClipboard', () => {
  beforeEach(() => {
    clipboard = null
    execCommand = vi.fn((cmd: string) => cmd === 'copy' && simulatedCopy())
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    setClipboardApi(undefined)
  })
  afterEach(() => {
    setClipboardApi(undefined)
    document.body.innerHTML = ''
  })

  it('uses the Clipboard API when the page has one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboardApi({ writeText })
    expect(await copyToClipboard('https://ff.local/share/abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://ff.local/share/abc')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('copies over plain HTTP, where there is no Clipboard API', async () => {
    expect(await copyToClipboard('lan-text')).toBe(true)
    expect(clipboard).toBe('lan-text')
  })

  it('falls back to execCommand when the Clipboard API refuses', async () => {
    setClipboardApi({ writeText: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) })
    expect(await copyToClipboard('fallback-text')).toBe(true)
    expect(clipboard).toBe('fallback-text')
  })

  it('reports failure instead of claiming a copy that did not happen', async () => {
    execCommand.mockReturnValue(true) // the command "ran" but no copy event reached us
    expect(await copyToClipboard('x')).toBe(false)
    execCommand.mockImplementation(() => { throw new Error('SecurityError') })
    expect(await copyToClipboard('x')).toBe(false)
  })

  it('leaves no textarea behind', async () => {
    await copyToClipboard('once')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
