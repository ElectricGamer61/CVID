import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { SharedVideoExtractorPool } from './shared-video-extractor'

const extractorState = vi.hoisted(() => ({
  instances: [] as Array<{
    init: ReturnType<typeof vi.fn>
    drawFrame: ReturnType<typeof vi.fn>
    drawFrameWithCapture: ReturnType<typeof vi.fn>
    captureFrame: ReturnType<typeof vi.fn>
    getLastFailureKind: ReturnType<typeof vi.fn>
    getDimensions: ReturnType<typeof vi.fn>
    getDuration: ReturnType<typeof vi.fn>
    prewarmBatch: ReturnType<typeof vi.fn>
    isBatchPrewarmAvailable: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('./canvas-video-extractor', () => ({
  VideoFrameExtractor: vi.fn(function VideoFrameExtractorMock(this: Record<string, unknown>) {
    const instance = {
      init: vi.fn(async () => true),
      drawFrame: vi.fn(async () => true),
      drawFrameWithCapture: vi.fn(async () => ({
        success: true,
        capturedFrame: null,
        capturedSourceTime: 0,
      })),
      captureFrame: vi.fn(async () => ({ success: true, frame: null, sourceTime: 0 })),
      getLastFailureKind: vi.fn(() => 'none'),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getDuration: vi.fn(() => 120),
      prewarmBatch: vi.fn(async () => 1),
      isBatchPrewarmAvailable: vi.fn(() => true),
      dispose: vi.fn(),
    }
    extractorState.instances.push(instance)
    Object.assign(this, instance)
  }),
}))

describe('SharedVideoExtractorPool', () => {
  beforeEach(() => {
    extractorState.instances = []
  })

  it('disposes source lanes after the last item using that source is released', async () => {
    const pool = new SharedVideoExtractorPool({ maxLanesPerSource: 2 })
    const ctx = {} as CanvasRenderingContext2D

    const first = pool.getOrCreateItemExtractor('item-1', 'blob:source')
    const second = pool.getOrCreateItemExtractor('item-2', 'blob:source')

    await first.drawFrame(ctx, 0, 0, 0, 1, 1)
    await second.drawFrame(ctx, 1, 0, 0, 1, 1)

    expect(extractorState.instances).toHaveLength(2)

    pool.releaseItem('item-1')

    expect(extractorState.instances[0]!.dispose).not.toHaveBeenCalled()
    expect(extractorState.instances[1]!.dispose).not.toHaveBeenCalled()

    pool.releaseItem('item-2')

    expect(extractorState.instances[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(extractorState.instances[1]!.dispose).toHaveBeenCalledTimes(1)
  })
})
