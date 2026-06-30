import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'

function createStorage(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      store = {}
    },
  } as Storage
}

const _local = createStorage()
const _session = createStorage()

// defineProperty is not undone by vi.unstubAllGlobals(), unlike vi.stubGlobal
Object.defineProperty(globalThis, 'localStorage', { value: _local, configurable: true, writable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: _session, configurable: true, writable: true })

beforeEach(() => {
  _local.clear()
  _session.clear()
})
