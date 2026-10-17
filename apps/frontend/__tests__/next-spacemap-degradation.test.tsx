import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SpaceMap3DCanvas } from '@/components/next/3d/spacemap/SpaceMap3DCanvas'
import { probeWebGLCapabilities } from '@/lib/next/3d/webgl-capabilities'
import type { StarVisualState } from '@/components/next/3d/spacemap/spacemap-state-mapper'

const mockStar = {
  projectId: 401,
  name: 'Nebula Protocol',
  code: 'NEB-401',
  departmentName: 'Infra Core',
  category: 'Infra',
  position: [0, 0, 10],
  radius: 1.2,
  accretionOuterRadius: 2.4,
  hasAccretionRing: false,
  color: '#38bdf8',
  luminosity: 1,
  geometryType: 'sphere',
  signals: [],
  isMatch: true,
  isSelected: false,
  scale: 1,
  opacity: 1,
  emissiveMultiplier: 1,
  targetCameraPosition: [0, 26, 44],
  healthStatus: 'healthy',
  progressPercent: 65,
  priority: 'high',
  status: 'active',
  stats: { memberCount: 15, taskCount: 80, milestoneCount: 8 },
} as unknown as StarVisualState

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
    camera: { position: { x: 0, y: 45, z: 105 }, lookAt: vi.fn() },
    scene: { traverse: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: mockDomElement },
  }),
}))

vi.mock('@react-three/drei', () => ({
  Billboard: () => null,
  OrbitControls: () => null,
  Stars: () => null,
}))

describe('空间地图 3D 三档降级契约与 Context Lost 自愈测试 (Task 5.3)', () => {
  beforeEach(() => {
    mockOnCreatedCallback = null
    document.documentElement.removeAttribute('data-immersion')
    vi.clearAllMocks()
  })

  test('fallback 降级档：DOM 绝对零 Canvas 且零 R3F 视口容器，直接返回 null 并通知降级', () => {
    const onDegrade = vi.fn()
    const { container } = render(
      <SpaceMap3DCanvas forceTier="fallback" onDegradeToFallback={onDegrade} />,
    )

    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    expect(screen.queryByTestId('spacemap-3d-container')).toBeNull()
    expect(onDegrade).toHaveBeenCalled()
  })

  test('low 轻量档：设置 frameloop="demand"，DPR 固定为 1.0', () => {
    render(<SpaceMap3DCanvas forceTier="low" />)

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock).not.toBeNull()
    expect(canvasMock.getAttribute('data-frameloop')).toBe('demand')
    expect(canvasMock.getAttribute('data-dpr')).toBe('1')
  })

  test('high 沉浸档：设置 frameloop="always"，DPR 为 [1, 1.5]', () => {
    render(<SpaceMap3DCanvas forceTier="high" />)

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
    const onContextLost = vi.fn()
    const onDegrade = vi.fn()

    const { rerender } = render(
      <SpaceMap3DCanvas
        forceTier="high"
        onContextLost={onContextLost}
        onDegradeToFallback={onDegrade}
      />,
    )

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

    expect(onContextLost).toHaveBeenCalled()
    expect(onDegrade).toHaveBeenCalled()

    // 重新渲染后已自愈切入 fallback 档
    rerender(<SpaceMap3DCanvas />)

    // Canvas 视口已被完全卸载
    expect(screen.queryByTestId('r3f-canvas-mock')).toBeNull()
    expect(screen.queryByTestId('spacemap-3d-container')).toBeNull()
  })

  test('卸载期 forceContextLoss 触发的 webglcontextlost 不得触发降级回调（镜头切换后切回应保持 3D）', () => {
    const onContextLost = vi.fn()
    const onDegrade = vi.fn()

    const { unmount } = render(
      <SpaceMap3DCanvas
        forceTier="high"
        onContextLost={onContextLost}
        onDegradeToFallback={onDegrade}
      />,
    )

    // 绑定事件（真实浏览器中 R3F 卸载 Canvas 时会调用 gl.forceContextLoss()，
    // 浏览器随之向该 canvas 派发 webglcontextlost —— 这是卸载流程的一部分）
    act(() => {
      mockOnCreatedCallback?.({ gl: { domElement: mockDomElement } })
    })

    unmount()

    // 卸载后模拟 R3F forceContextLoss 派发的 webglcontextlost
    act(() => {
      const event = new Event('webglcontextlost', { cancelable: true })
      mockDomElement.dispatchEvent(event)
    })

    expect(onContextLost).not.toHaveBeenCalled()
    expect(onDegrade).not.toHaveBeenCalled()
  })

  test('stage 星系标签 DOM 覆盖层：核心与每颗星体常驻标签渲染，不依赖 drei Html 嵌套 root', () => {
    render(
      <SpaceMap3DCanvas
        variant="stage"
        forceTier="high"
        stars={[mockStar]}
        selectedId={401}
        coreLabel="我的默认组织"
      />,
    )

    const layer = screen.getByTestId('spacemap-galaxy-label-layer')
    expect(layer).toBeInTheDocument()

    // 核心标签 + 每个项目一个标签
    const labels = layer.querySelectorAll('[data-galaxy-label]')
    expect(labels.length).toBe(2)
    expect(layer.querySelector('[data-galaxy-label="core"]')?.textContent).toContain('我的默认组织')
    expect(layer.querySelector('[data-galaxy-label="401"]')?.textContent).toContain(
      'Nebula Protocol',
    )
    // 选中态描边与进度内容
    expect(layer.querySelector('[data-galaxy-label="401"]')?.textContent).toContain('进度 65%')
  })

  test('无障碍与焦点隔离：3D 容器强制带有 aria-hidden="true"、tabindex="-1" 与 pointer-events-none', () => {
    render(<SpaceMap3DCanvas forceTier="high" />)

    const container = screen.getByTestId('spacemap-3d-container')
    expect(container.getAttribute('aria-hidden')).toBe('true')
    expect(container.getAttribute('tabindex')).toBe('-1')
    expect(container.className).toContain('pointer-events-none')

    const canvasMock = screen.getByTestId('r3f-canvas-mock')
    expect(canvasMock.getAttribute('aria-hidden')).toBe('true')
    expect(canvasMock.getAttribute('tabindex')).toBe('-1')
  })
})
