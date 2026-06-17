import { describe, expect, it } from 'vitest'
import { RenderProfiler } from './profile'

describe('RenderProfiler', () => {
  it('does not collect samples while disabled', () => {
    let calls = 0
    const profiler = new RenderProfiler(false, () => {
      calls++
      return calls
    })
    expect(profiler.measure('terrain', () => 42)).toBe(42)
    expect(profiler.summary().terrain.count).toBe(0)
    expect(calls).toBe(0)
  })

  it('records count, last, average and max for enabled sections', () => {
    let now = 0
    const profiler = new RenderProfiler(true, () => now)
    profiler.measure('terrain', () => {
      now += 4
    })
    profiler.measure('terrain', () => {
      now += 10
    })
    const terrain = profiler.summary().terrain
    expect(terrain.count).toBe(2)
    expect(terrain.lastMs).toBe(10)
    expect(terrain.avgMs).toBe(7)
    expect(terrain.maxMs).toBe(10)
  })

  it('resets collected samples without disabling profiling', () => {
    let now = 0
    const profiler = new RenderProfiler(true, () => now)
    profiler.measure('total', () => {
      now += 5
    })
    profiler.reset()
    expect(profiler.enabled).toBe(true)
    expect(profiler.summary().total.count).toBe(0)
  })
})
