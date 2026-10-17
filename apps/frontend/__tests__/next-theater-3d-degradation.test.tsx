import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Theater3DCanvas } from '@/components/next/3d/theater/Theater3DCanvas'
import { probeWebGLCapabilities } from '@/lib/next/3d/webgl-capabilities'

let mockOnCreatedCallback: ((state: unknown) => void) | null | undefined = null
const mockDomElement = document.createElement('canvas')

vi.mock('@react-three/fiber', () => ({
  Canvas: ({
    children,
    onCreated,
    frameloop,
    dpr,
    ...props
  }: React.ComponentProps<'div'> & {
    onCreated?: (state: unknown) => void
    frameloop?: string
    dpr?: number | number[]
  }) => {
    mockOnCreatedCallback = onCreated
    return (
      <div
        data-testid="r3f-canvas-mock"
        data-frameloop={frameloop}
        data-dpr={typeof dpr === 'number' ? dpr : JSON.stringify(dpr)}
        aria-hidden="true"
        {...props}
      >
        {children}
      </div>
    )
  },
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 0, z: 12 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: mockDomElement },
  }),
}))

describe('生成剧场 3D 三档降级契约与 Context Lost 自愈测试（v3-next-layer1-theater-3d-m1 tasks 5.1 / 5.3）', () => {
  beforeEach(() => {
    mockOnCreatedCallback = null
    document.documentElement.removeAttribute('data-immersion')
    vi.clearAllMocks()
  })

  test('fallback 降级档：DOM 绝对零 Canvas 且零 R3F 视口容器，直接返回 null', () => {
    const { container } = render(<Theater3DCanvas forceTier="fallback" />)

    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    expect(screen.queryByTestId('theater-3d-container')).toBeNull()
  })

  test('low 轻量档：设置 frameloop="demand"，DPR 固定为 1.0', () => {
    render(<Theater3DCanvas forceTier="low" />)

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock).not.toBeNull()
    expect(canvasMock.getAttribute('data-frameloop')).toBe('demand')
    expect(canvasMock.getAttribute('data-dpr')).toBe('1')
  })

  test('high 沉浸档：设置 frameloop="always"，DPR 为 [1, 1.5]', () => {
    render(<Theater3DCanvas forceTier="high" />)

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock).not.toBeNull()
    expect(canvasMock.getAttribute('data-frameloop')).toBe('always')
    expect(canvasMock.getAttribute('data-dpr')).toContain('1.5')
  })

  test('精确档属性（data-immersion="precise"）触发自动降级探测为 fallback', () => {
    document.documentElement.setAttribute('data-immersion', 'precise')
    const caps = probeWebGLCapabilities()
    expect(caps.tier).toBe('fallback')
  })

  test('WebGL Context Lost 自愈降级：捕获事件后自动切入 fallback 档卸载 Canvas 节点', () => {
    const { rerender } = render(<Theater3DCanvas forceTier="high" />)

    expect(screen.getByTestId('r3f-canvas-mock')).not.toBeNull()

    // 绑定事件
    act(() => {
      mockOnCreatedCallback?.({ gl: { domElement: mockDomElement } })
    })

    // 触发 webglcontextlost
    act(() => {
      const event = new Event('webglcontextlost', { cancelable: true })
      mockDomElement.dispatchEvent(event)
    })

    // 重新渲染后已自愈切入 fallback 档
    rerender(<Theater3DCanvas />)

    // Canvas 视口已被完全卸载
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    expect(screen.queryByTestId('theater-3d-container')).toBeNull()
  })

  test('无障碍与焦点隔离：3D 容器强制带有 aria-hidden="true"、tabindex="-1" 与 pointer-events-none', () => {
    render(<Theater3DCanvas forceTier="high" />)

    const container = screen.getByTestId('theater-3d-container')
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(container.getAttribute('tabindex')).toBe('-1')
    expect(container.className).toContain('pointer-events-none')

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock.getAttribute('aria-hidden')).toBe('true')
    expect(canvasMock.getAttribute('tabindex')).toBe('-1')
  })
})
