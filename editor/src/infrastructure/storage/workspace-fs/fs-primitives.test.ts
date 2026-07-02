import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    startEvent: () => ({ set: vi.fn(), merge: vi.fn(), success: vi.fn(), failure: vi.fn() }),
    child: vi.fn(),
    setLevel: vi.fn(),
  }),
  createOperationId: () => 'op-test',
}))

vi.mock('./root', () => ({
  notifyPermissionLost: vi.fn(),
}))

import { readJson, writeJsonAtomic, WorkspaceFileCorruptError } from './fs-primitives'
import { asHandle, createRoot, MemDir } from './__tests__/in-memory-handle'

/** Plant raw text into the in-memory FS. */
async function writeRawText(dir: MemDir, name: string, text: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true })
  const writable = await fh.createWritable()
  await writable.write(text)
  await writable.close()
}

describe('fs-primitives readJson', () => {
  it('returns null for a missing file', async () => {
    const root = createRoot()
    const result = await readJson(asHandle(root), ['nonexistent.json'])
    expect(result).toBeNull()
  })

  it('throws WorkspaceFileCorruptError on invalid JSON', async () => {
    const root = createRoot()
    await writeRawText(root, 'bad.json', '{not json')
    await expect(readJson(asHandle(root), ['bad.json'])).rejects.toThrow(WorkspaceFileCorruptError)
  })

  it('WorkspaceFileCorruptError includes the path and a SyntaxError cause', async () => {
    const root = createRoot()
    await writeRawText(root, 'corrupt.json', '{not json')

    let caught: unknown
    try {
      await readJson(asHandle(root), ['corrupt.json'])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(WorkspaceFileCorruptError)
    const err = caught as WorkspaceFileCorruptError
    expect(err.path).toBe('corrupt.json')
    expect(err.cause).toBeInstanceOf(SyntaxError)
  })

  it('returns parsed object for valid JSON', async () => {
    const root = createRoot()
    await writeJsonAtomic(asHandle(root), ['valid.json'], { hello: 'world' })
    const result = await readJson<{ hello: string }>(asHandle(root), ['valid.json'])
    expect(result).toEqual({ hello: 'world' })
  })
})
