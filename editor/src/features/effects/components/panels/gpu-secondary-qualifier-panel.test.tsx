import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuSecondaryQualifierPanel } from './gpu-secondary-qualifier-panel'

const definition = getGpuEffect('gpu-secondary-qualifier')!

function makeProps(params: Record<string, number | boolean | string> = {}) {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-secondary-qualifier',
    params,
  }
  const effect: ItemEffect = { id: 'fx-secondary', effect: gpuEffect, enabled: true }
  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuSecondaryQualifierPanel', () => {
  it('renders the qualifier as key, matte, and correction sections', () => {
    render(<GpuSecondaryQualifierPanel {...makeProps()} />)

    expect(screen.getByText('Secondary Qualifier')).toBeInTheDocument()
    expect(screen.getByText('Key')).toBeInTheDocument()
    expect(screen.getByText('Matte')).toBeInTheDocument()
    expect(screen.getByText('Correction')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Hue range selector' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
  })

  it('nudges the hue center from the hue range selector', () => {
    const props = makeProps({ hueCenter: 42 })
    render(<GpuSecondaryQualifierPanel {...props} />)

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue range selector' }), {
      key: 'ArrowRight',
    })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-secondary', 'hueCenter', 43)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'hueCenter', 43)
  })

  it('toggles matte preview and inverted matte params', () => {
    const props = makeProps({ showMask: false, invertMask: false })
    render(<GpuSecondaryQualifierPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show Mask' }))
    fireEvent.click(screen.getByRole('button', { name: 'Invert Mask' }))

    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'showMask', true)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-secondary', 'invertMask', true)
  })
})
