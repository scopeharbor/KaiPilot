import { describe, expect, it, vi } from 'vitest'

const connect = vi.fn()
vi.mock('@react-three/fiber', () => ({
  events: () => ({ priority: 1, enabled: true, connect, disconnect: vi.fn() }),
}))

import { safeCanvasEvents } from '@/components/next/3d/shared/safe-canvas-events'

describe('safeCanvasEvents（画布提前卸载时的空目标保护）', () => {
  it('目标为空时跳过连接，不抛 addEventListener 空引用', () => {
    const manager = safeCanvasEvents({} as never)
    expect(() => manager.connect(null as unknown as HTMLElement)).not.toThrow()
    expect(connect).not.toHaveBeenCalled()
  })

  it('目标存在时照常连接，其余字段原样保留', () => {
    const manager = safeCanvasEvents({} as never)
    const target = document.createElement('div')
    manager.connect(target)
    expect(connect).toHaveBeenCalledWith(target)
    expect(manager).toMatchObject({ priority: 1, enabled: true })
  })
})
