import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LoginSpaceCanvas } from '@/components/next/3d/login/LoginSpaceCanvas'

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
    camera: { position: { x: 0, y: 0, z: 5 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: mockDomElement },
  }),
}))

describe('三档降级契约与 WebGL 异常自愈测试（v3-next-layer1-login-3d-m0 任务 4.2）', () => {
  beforeEach(() => {
    mockOnCreatedCallback = null
    document.documentElement.removeAttribute('data-immersion')
    vi.clearAllMocks()
  })

  test('fallback 降级档：DOM 绝对零 Canvas 且零 R3F 节点，纯渲染静态底图', () => {
    const { container } = render(<LoginSpaceCanvas forceTier="fallback" />)

    // 断言 DOM 中绝无 canvas 元素
    expect(container.querySelector('canvas')).toBeNull()
    // 断言 R3F Canvas 组件完全未被挂载
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    // 断言纯 CSS 静态底图正常渲染
    expect(screen.getByTestId('login-static-fallback')).not.toBeNull()
    expect(screen.getByTestId('login-static-fallback').getAttribute('aria-hidden')).toBe('true')
  })

  test('low 轻量档：激活 WebGL 但设置 frameloop="demand"，DPR 固定为 1.0', () => {
    render(<LoginSpaceCanvas forceTier="low" />)

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock).not.toBeNull()
    expect(canvasMock.getAttribute('data-frameloop')).toBe('demand')
    expect(canvasMock.getAttribute('data-dpr')).toBe('1')
  })

  test('high 沉浸档：激活 WebGL，设置 frameloop="always"，DPR 为 [1, 1.5]', () => {
    render(<LoginSpaceCanvas forceTier="high" />)

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock).not.toBeNull()
    expect(canvasMock.getAttribute('data-frameloop')).toBe('always')
    expect(canvasMock.getAttribute('data-dpr')).toContain('1.5')
  })

  test('WebGL Context Lost 自愈降级：捕获事件后自动切入 fallback 纯 CSS 静态底图', () => {
    const { rerender } = render(<LoginSpaceCanvas forceTier="high" />)

    expect(screen.getByTestId('r3f-canvas-mock')).not.toBeNull()

    // 触发 onCreated 绑定事件
    act(() => {
      mockOnCreatedCallback?.({ gl: { domElement: mockDomElement } })
    })

    // 模拟 dispatch webglcontextlost 事件
    act(() => {
      const event = new Event('webglcontextlost', { cancelable: true })
      mockDomElement.dispatchEvent(event)
    })

    // 重新渲染后已自愈切入 fallback 档
    rerender(<LoginSpaceCanvas />)

    // Canvas 节点已被卸载
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    // 渲染纯 CSS 降级底图
    expect(screen.getByTestId('login-static-fallback')).not.toBeNull()
  })

  test('无障碍与焦点隔离：Canvas 容器强制声明 aria-hidden、tabIndex=-1 与 pointer-events-none', () => {
    render(<LoginSpaceCanvas forceTier="high" />)

    const container = screen.getByTestId('login-space-container')
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(container.getAttribute('tabindex')).toBe('-1')
    expect(container.className).toContain('pointer-events-none')

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock.getAttribute('aria-hidden')).toBe('true')
    expect(canvasMock.getAttribute('tabindex')).toBe('-1')
  })
})
