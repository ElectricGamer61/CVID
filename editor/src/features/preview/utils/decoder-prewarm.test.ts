import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  backgroundPreseek,
  disposePrewarmWorker,
  warmDecoderPrewarmWorkerPool,
} from './decoder-prewarm'
import {
  clearObjectUrlRegistry,
  registerObjectUrl,
} from '@/infrastructure/browser/object-url-registry'

type MockWorkerMessage = {
  type: string
  id?: string
  timestamp?: number
  blob?: Blob
  src?: string
  sourceMetadata?: {
    storageType: 'opfs'
    opfsPath: string
    fileSize?: number
  }
}

class MockWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly addEventListener = vi.fn()
  readonly terminate = vi.fn()
  readonly postMessage = vi.fn((message: MockWorkerMessage) => {
    if (message.type !== 'preseek' || !autoRespondPreseek) {
      return
    }

    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'preseek_done',
          id: message.id,
          success: true,
          timestamp: message.timestamp,
          bitmap: mockBitmap,
        },
      } as MessageEvent)
    })
  })
}

let createdWorkers: MockWorker[] = []
let fetchMock: ReturnType<typeof vi.fn>
let mockBitmap: ImageBitmap
let autoRespondPreseek = true

beforeEach(() => {
  createdWorkers = []
  mockBitmap = { close: vi.fn() } as unknown as ImageBitmap
  fetchMock = vi.fn()
  autoRespondPreseek = true

  vi.stubGlobal('fetch', fetchMock)
  class WorkerStub extends MockWorker {
    constructor() {
      super()
      createdWorkers.push(this)
    }
  }

  vi.stubGlobal('Worker', WorkerStub as unknown as typeof Worker)
})

afterEach(() => {
  disposePrewarmWorker()
  clearObjectUrlRegistry()
  vi.unstubAllGlobals()
})

describe('decoder prewarm', () => {
  it('uses registered object URL blobs without re-fetching them', async () => {
    const blob = new Blob(['video'])
    registerObjectUrl('blob:clip-1', blob)

    const bitmap = await backgroundPreseek('blob:clip-1', 1)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(1)
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-1',
      timestamp: 1,
      blob,
    })
    expect(bitmap).toBe(mockBitmap)
  })

  it('prefers direct OPFS metadata over cloning blobs into the worker', async () => {
    const blob = new Blob(['video'])
    registerObjectUrl('blob:clip-opfs', blob, {
      storageType: 'opfs',
      opfsPath: 'content/aa/bb/data',
      fileSize: blob.size,
    })

    const bitmap = await backgroundPreseek('blob:clip-opfs', 2)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(1)
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-opfs',
      timestamp: 2,
      sourceMetadata: {
        storageType: 'opfs',
        opfsPath: 'content/aa/bb/data',
        fileSize: blob.size,
      },
    })
    expect(preseekPosts[0]?.blob).toBeUndefined()
    expect(bitmap).toBe(mockBitmap)
  })

  it('fails fast for unregistered blob URLs without ever calling fetch', async () => {
    // Any blob: URL that isn't in the object-url registry is, by
    // construction, unreachable from our JS — `blobUrlManager` is the
    // only place we create blob URLs, and it always registers. Calling
    // fetch() in that case would produce an uncatchable ERR_FILE_NOT_FOUND
    // in the DevTools console (Chrome logs network errors before the JS
    // .catch runs). The module now bails silently instead.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const firstResult = await backgroundPreseek('blob:stale', 1)
    const secondResult = await backgroundPreseek('blob:stale', 2)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(firstResult).toBeNull()
    expect(secondResult).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(0)
  })
  it('warmDecoderPrewarmWorkerPool eagerly spawns the pool exactly once', () => {
    warmDecoderPrewarmWorkerPool()

    expect(createdWorkers.length).toBeGreaterThan(0)
    for (const worker of createdWorkers) {
      // Each worker preloads mediabunny WASM on creation.
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'warmup' })
    }

    const spawnedCount = createdWorkers.length
    warmDecoderPrewarmWorkerPool()
    expect(createdWorkers.length).toBe(spawnedCount)
  })

  it('drops speculative preseek work when every worker is already busy', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const poolSize = createdWorkers.length
    expect(poolSize).toBeGreaterThan(0)

    const inflightPromises: ReturnType<typeof backgroundPreseek>[] = []
    for (let index = 0; index < poolSize; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      inflightPromises.push(backgroundPreseek(src, index))
    }

    // A duplicate request for an already-inflight src/timestamp needs no extra
    // worker capacity — even with the pool saturated it must reuse the pending
    // promise rather than be dropped to null like genuinely new decode work.
    const duplicateResult = backgroundPreseek('blob:busy-0', 0)
    expect(duplicateResult).toBe(inflightPromises[0])

    registerObjectUrl('blob:overflow', new Blob(['overflow']))
    const overflowResult = await backgroundPreseek('blob:overflow', 999)

    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(overflowResult).toBeNull()
    expect(preseekPosts).toHaveLength(poolSize)
  })

  it('closes bitmaps from late worker replies after a request is no longer pending', () => {
    warmDecoderPrewarmWorkerPool()

    const worker = createdWorkers[0]!
    worker.onmessage?.({
      data: {
        type: 'preseek_done',
        id: 'missing-request',
        success: true,
        bitmap: mockBitmap,
      },
    } as MessageEvent)

    expect(mockBitmap.close).toHaveBeenCalledTimes(1)
  })
})
