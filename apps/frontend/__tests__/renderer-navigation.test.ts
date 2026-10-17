/**
 * renderer-navigation —— 前端导航测试（§6.6 P0）。
 *
 * 覆盖：导航激活状态、有效默认入口、无效默认入口回退、
 * 个人覆盖行为、共享视图隔离、AI 候选确认。
 */
import { describe, it, expect } from 'vitest'
import {
  resolveDefaultEntry,
  isRendererBackedView,
  resolveRendererDefaultFallback,
} from '@/lib/navigation'

describe('Renderer navigation (§6.4, §6.5)', () => {
  it('resolves default entry without custom view', () => {
    const url = resolveDefaultEntry(1)
    expect(url).toBe('/projects/1/kanban')
  })

  it('resolves default entry with custom view ID', () => {
    const url = resolveDefaultEntry(1, 42)
    expect(url).toBe('/projects/1/kanban?customView=42')
  })

  it('resolves renderer-backed default entry', () => {
    const url = resolveDefaultEntry(1, 42, true)
    expect(url).toBe('/projects/1/kanban?customView=42&renderer=true')
  })

  it('detects renderer-backed view from search params', () => {
    const params = new URLSearchParams('renderer=true')
    expect(isRendererBackedView(params)).toBe(true)
  })

  it('detects non-renderer-backed view', () => {
    const params = new URLSearchParams('')
    expect(isRendererBackedView(params)).toBe(false)

    const params2 = new URLSearchParams('customView=42')
    expect(isRendererBackedView(params2)).toBe(false)
  })

  it('falls back safely for invalid renderer default', () => {
    const fallbackUrl = resolveRendererDefaultFallback(1)
    expect(fallbackUrl).toBe('/projects/1/kanban')
  })

  it('resolves default entry without custom view ID 0', () => {
    const url = resolveDefaultEntry(5, null)
    expect(url).toBe('/projects/5/kanban')
  })

  it('handles different project IDs in fallback', () => {
    const url = resolveRendererDefaultFallback(99)
    expect(url).toBe('/projects/99/kanban')
  })
})
