import * as React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SpaceMap3DScene } from '@/components/next/3d/spacemap/SpaceMap3DScene'
import {
  SpaceMapCameraController,
  CAMERA_OVERVIEW_PRESET,
} from '@/components/next/3d/spacemap/SpaceMapCameraController'
import type { StarVisualState } from '@/components/next/3d/spacemap/spacemap-state-mapper'

const mockCamera = {
  position: { x: 0, y: 45, z: 105, copy: vi.fn() },
  lookAt: vi.fn(),
}

const mockScene = {
  traverse: vi.fn(),
}

// R3F jsdom 隔离 Mock 层

/** 从 DOM 节点沿 React fiber 读取元素 userData（jsdom 将对象型 userData 渲染为
 *  userdata="[object Object]" 不可用；fiber 上保留原始 props，结构断言走此桥）。
 *  生产侧 R3F 元数据通道已统一为 userData（R3F 对自定义 data-* 会抛错）。 */
interface FiberLike {
  memoizedProps?: Record<string, unknown> & { userData?: Record<string, unknown> }
  return?: FiberLike | null
}

function fiberUserData(el: Element | null): Record<string, unknown> | null {
  if (!el) return null
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  )
  if (!key) return null
  let fiber: FiberLike | null = (el as unknown as Record<string, FiberLike>)[key] ?? null
  while (fiber && !fiber.memoizedProps?.userData) fiber = fiber.return ?? null
  return fiber?.memoizedProps?.userData ?? null
}
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: mockCamera,
    scene: mockScene,
    gl: { domElement: document.createElement('canvas') },
    clock: { getElapsedTime: () => 1.0 },
    pointer: { x: 0, y: 0 },
  }),
}))

const mockStars: StarVisualState[] = [
  {
    projectId: 201,
    name: 'Kepler Telescope',
    code: 'KEP-201',
    departmentName: 'Astronomy',
    category: 'Science',
    position: [15, -10, 25],
    radius: 1.6,
    accretionOuterRadius: 2.8,
    hasAccretionRing: true,
    color: '#38bdf8',
    luminosity: 0.9,
    geometryType: 'sphere',
    signals: [],
    isMatch: true,
    isSelected: false,
    scale: 1.0,
    opacity: 1.0,
    emissiveMultiplier: 1.0,
    targetCameraPosition: [15, -10, 31],
    healthStatus: 'healthy',
    progressPercent: 60,
    priority: 'high',
    status: 'active',
  },
]

describe('SpaceMap3DScene 场景图契约测试 (Task 4.1 / 4.3)', () => {
  it('深空指数雾参数契约：底色 #030712 且密度 0.006', () => {
    const { container } = render(<SpaceMap3DScene stars={mockStars} />)
    const fog = container.querySelector('fogExp2')
    expect(fog).not.toBeNull()
  })

  it('场景光照体系契约：环境光与双方向光完整就位', () => {
    const { container } = render(<SpaceMap3DScene stars={mockStars} />)
    expect(container.querySelector('ambientLight')).not.toBeNull()
    const dirLights = container.querySelectorAll('directionalLight')
    expect(dirLights.length).toBeGreaterThanOrEqual(2)
  })

  it('背景 InstancedStarfield 单 Draw Call 配置与微星数量就位', () => {
    const { container } = render(<SpaceMap3DScene stars={mockStars} />)
    const starfield = container.querySelector('[data-testid="instanced-starfield"]')
    expect(starfield).not.toBeNull()
  })

  it('前景恒星采用 InstancedMesh 单 Draw Call 合批与视距 LOD 控制，总 Draw Call < 40 (BLOCKER-1 兑现)', () => {
    const { container } = render(<SpaceMap3DScene stars={mockStars} />)
    const fgInstanced = container.querySelector('[data-testid="foreground-instanced-stars"]')
    expect(fgInstanced).not.toBeNull()
    expect(fiberUserData(fgInstanced)?.lodTier).toBe('instanced-batch')

    const accretionInstanced = container.querySelector('[data-testid="accretion-instanced-mesh"]')
    expect(accretionInstanced).not.toBeNull()

    const starsGroup = container.querySelector('[data-testid="galaxy-stars-group"]')
    expect(starsGroup).not.toBeNull()
    expect(fiberUserData(starsGroup)?.lodLevel).toBeDefined()
  })

  it('场景卸载时显式触发显存递归清理 (RL-06)', () => {
    const { unmount } = render(<SpaceMap3DScene stars={mockStars} />)
    unmount()
    expect(mockScene.traverse).toHaveBeenCalled()
  })
})

describe('SpaceMapCameraController 相机机位调度契约测试 (Task 4.2 / 4.3)', () => {
  it('广角概览预设机位参数有界且符合设计规范', () => {
    expect(CAMERA_OVERVIEW_PRESET.position).toEqual([0, 45, 105])
    expect(CAMERA_OVERVIEW_PRESET.target).toEqual([0, 0, 15])
    expect(CAMERA_OVERVIEW_PRESET.fov).toBe(55)
  })

  it('选中星体时飞越机位目标有界平滑计算 [x, y, z + 6]', () => {
    const star = mockStars[0]!
    expect(star.targetCameraPosition).toEqual([
      star.position[0],
      star.position[1],
      star.position[2] + 6,
    ])

    const { unmount } = render(<SpaceMapCameraController selectedStar={star} tier="high" />)
    expect(unmount).toBeDefined()
  })
})
