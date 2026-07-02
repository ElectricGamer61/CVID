import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuWheelsPanel } from './gpu-wheels-panel'

const definition = getGpuEffect('gpu-color-wheels')!

function makeProps(params: Record<string, number | boolean | string> = {}) {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-color-wheels',
    params: { ...getGpuEffectDefaultParams('gpu-color-wheels'), ...params },
  }
  const effect: ItemEffect = { id: 'fx-wheels', effect: gpuEffect, enabled: true }
  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onParamsBatchChange: vi.fn(),
    onParamsBatchLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuWheelsPanel', () => {
  it('renders a Resolve-style four-wheel primaries dock', () => {
    render(<GpuWheelsPanel {...makeProps()} layout="dock" />)

    expect(screen.getByText('Primaries - Color Wheels')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Lift wheel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Gamma wheel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Gain wheel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Offset wheel' })).toBeInTheDocument()

    for (const label of [
      'Temperature',
      'Tint',
      'Contrast',
      'Pivot',
      'Mid/Detail',
      'Color Boost',
      'Shadows',
      'Highlights',
      'Saturation',
      'Hue',
      'Lum Mix',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('previews numeric wheel value edits live and commits once on blur', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    const input = screen.getByLabelText('Lift')
    fireEvent.change(input, { target: { value: '0.03' } })
    fireEvent.change(input, { target: { value: '0.05' } })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.03)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
    expect(props.onParamChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(props.onParamChange).toHaveBeenCalledTimes(1)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
  })

  it('scrubs the numeric field horizontally and commits once on release', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    // lift display step 0.01, one step per dragged pixel
    const input = screen.getByLabelText('Lift')
    fireEvent.pointerDown(input, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(input, { clientX: 110, pointerId: 1 })
    fireEvent.pointerMove(input, { clientX: 120, pointerId: 1 })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.1)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.2)
    expect(props.onParamChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(input, { clientX: 120, pointerId: 1 })

    expect(props.onParamChange).toHaveBeenCalledTimes(1)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.2)
  })

  it('shows master-inclusive RGB chips and decomposes edits into master + hue/amount', () => {
    const props = makeProps({ shadowsHue: 0, shadowsAmount: 0.3, lift: 0.05 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    // Pure red push of 0.3 mean-centers to (+0.2, -0.1, -0.1); chips add the
    // lift master (0.05) so the thumb wheel moves all three together.
    const red = screen.getByLabelText('Lift Red') as HTMLInputElement
    expect(red.value).toBe('0.25')
    expect((screen.getByLabelText('Lift Green') as HTMLInputElement).value).toBe('-0.05')
    expect((screen.getByLabelText('Lift Blue') as HTMLInputElement).value).toBe('-0.05')

    fireEvent.change(red, { target: { value: '0.55' } })
    expect(props.onParamsBatchLiveChange).toHaveBeenCalledWith('fx-wheels', {
      lift: 0.15,
      shadowsHue: 0,
      shadowsAmount: 0.6,
    })
    expect(props.onParamsBatchChange).not.toHaveBeenCalled()

    fireEvent.blur(red)
    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    expect(props.onParamsBatchChange).toHaveBeenCalledWith('fx-wheels', {
      lift: 0.15,
      shadowsHue: 0,
      shadowsAmount: 0.6,
    })
  })

  it('updates chip readouts in realtime during live drags', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    fireEvent.change(screen.getByLabelText('Lift thumb wheel'), { target: { value: '0.05' } })

    // No commit yet — readouts track the live preview value.
    expect(props.onParamChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Lift') as HTMLInputElement).value).toBe('0.05')
    expect((screen.getByLabelText('Lift Red') as HTMLInputElement).value).toBe('0.05')
    expect((screen.getByLabelText('Lift Green') as HTMLInputElement).value).toBe('0.05')
    expect((screen.getByLabelText('Lift Blue') as HTMLInputElement).value).toBe('0.05')
  })

  it('resets a wheel including its master level', () => {
    const props = makeProps({ shadowsHue: 120, shadowsAmount: 0.4, lift: 0.1 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset Lift' }))

    expect(props.onParamsBatchChange).toHaveBeenCalledWith('fx-wheels', {
      shadowsHue: 0,
      shadowsAmount: 0,
      lift: 0,
    })
  })

  it('shows the parameter rows in Resolve display scales', () => {
    const props = makeProps({ temperature: 25, saturation: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    // Temperature param 25 reads as 1000.0 on Resolve's +/-4000 scale
    const temp = screen.getByLabelText('Temperature') as HTMLInputElement
    expect(temp.value).toBe('1000.0')
    // Saturation param 0 reads as Resolve's 50.00 (0..100 anchored at 50)
    expect((screen.getByLabelText('Saturation') as HTMLInputElement).value).toBe('50.00')
    expect((screen.getByLabelText('Contrast') as HTMLInputElement).value).toBe('1.000')
    expect((screen.getByLabelText('Lum Mix') as HTMLInputElement).value).toBe('100.00')

    // Typing in display units converts back to the stored param
    fireEvent.change(temp, { target: { value: '-2000' } })
    fireEvent.blur(temp)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'temperature', -50)
  })

  it('picks a black point with the eyedropper and commits the lift', async () => {
    const windowWithEyeDropper = window as unknown as {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
    }
    windowWithEyeDropper.EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: '#808080' })
      }
    }
    try {
      const props = makeProps({ lift: 0 })
      render(<GpuWheelsPanel {...props} layout="dock" />)

      fireEvent.click(screen.getByRole('button', { name: 'Pick black point' }))

      // 50% gray luma is ~0.502 — lift drops by that to map it to black
      await waitFor(() => {
        expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', -0.502)
      })
    } finally {
      delete windowWithEyeDropper.EyeDropper
    }
  })

  it('omits the master chip on the Offset wheel like Resolve', () => {
    render(<GpuWheelsPanel {...makeProps()} layout="dock" />)

    expect(screen.queryByLabelText('Offset')).toBeNull()
    // Offset chips read in Resolve's 25-anchored units (-175..225)
    expect((screen.getByLabelText('Offset Red') as HTMLInputElement).value).toBe('25.00')
    expect((screen.getByLabelText('Offset Green') as HTMLInputElement).value).toBe('25.00')
    expect((screen.getByLabelText('Offset Blue') as HTMLInputElement).value).toBe('25.00')
    expect(screen.getByLabelText('Offset thumb wheel')).toBeInTheDocument()
  })

  it('maps offset chip edits from Resolve units back to the normalized param', () => {
    const props = makeProps()
    render(<GpuWheelsPanel {...props} layout="dock" />)

    const red = screen.getByLabelText('Offset Red')
    fireEvent.change(red, { target: { value: '55' } })
    fireEvent.blur(red)

    // 55 display -> mean 35 -> master param (35-25)/100 = 0.1; the remaining
    // (+0.2, -0.1, -0.1) deviation is a red push of amount 0.3
    expect(props.onParamsBatchChange).toHaveBeenCalledWith('fx-wheels', {
      offset: 0.1,
      offsetHue: 0,
      offsetAmount: 0.3,
    })
  })

  it('scrubs wheel level values live and commits once on release', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    const thumb = screen.getByLabelText('Lift thumb wheel')
    fireEvent.change(thumb, { target: { value: '0.05' } })
    fireEvent.change(thumb, { target: { value: '0.07' } })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.07)
    expect(props.onParamChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(thumb)

    expect(props.onParamChange).toHaveBeenCalledTimes(1)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.07)
  })
})
