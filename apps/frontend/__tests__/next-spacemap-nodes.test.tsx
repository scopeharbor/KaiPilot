import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SpaceMapStarNode } from '@/components/next/3d/spacemap/SpaceMapStarNode'
import { SpaceMapSignalOrbiter } from '@/components/next/3d/spacemap/SpaceMapSignalOrbiter'
import { SpaceMapSectorMesh } from '@/components/next/3d/spacemap/SpaceMapSectorMesh'
import { SpaceMapOrbitRails } from '@/components/next/3d/spacemap/SpaceMapOrbitRails'
import { computeGalaxyLayout } from '@/components/next/3d/spacemap/spacemap-galaxy-layout'
import type {
  StarVisualState,
  StarSignalVisual,
} from '@/components/next/3d/spacemap/spacemap-state-mapper'
import type { Project } from '@/lib/api/projects'
import type { SpaceCoordinate } from '@/lib/next/space-coordinates'

// R3F jsdom 隔离 Mock 层

/** 从 DOM 节点沿 React fiber 读取元素 props/userData（jsdom 将对象型 userData 渲染为
 *  userdata="[object Object]" 不可用；fiber 上保留原始 props，结构断言走此桥）。
 *  生产侧 R3F 元数据通道已统一为 userData（R3F 对自定义 data-* 会抛错）。 */
interface FiberLike {
  memoizedProps?: Record<string, unknown> & { userData?: Record<string, unknown> }
  return?: FiberLike | null
}

function fiberOf(el: Element | null): FiberLike | null {
  if (!el) return null
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  )
  if (!key) return null
  return (el as unknown as Record<string, FiberLike>)[key] ?? null
}

function fiberProps(el: Element | null): Record<string, unknown> | null {
  return fiberOf(el)?.memoizedProps ?? null
}

function fiberUserData(el: Element | null): Record<string, unknown> | null {
  let fiber = fiberOf(el)
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
    camera: { position: { x: 0, y: 0, z: 20 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 1.5 },
    gl: { domElement: document.createElement('canvas') },
  }),
}))

const baseStar: StarVisualState = {
  projectId: 101,
  name: 'Centauri Mission',
  code: 'CEN-101',
  departmentName: 'Deep Space',
  category: 'Space',
  position: [10, 20, 30],
  radius: 1.5,
  accretionOuterRadius: 2.5,
  hasAccretionRing: true,
  color: '#38bdf8',
  luminosity: 0.8,
  geometryType: 'sphere',
  signals: [],
  isMatch: true,
  isSelected: false,
  scale: 1.0,
  opacity: 1.0,
  emissiveMultiplier: 1.0,
  targetCameraPosition: [10, 20, 36],
  healthStatus: 'healthy',
  progressPercent: 50,
  priority: 'high',
  status: 'active',
}

const mockSignals: StarSignalVisual[] = [
  {
    id: 1,
    signalType: 'progress_deviation',
    severity: 'warning',
    shape: 'asteroid',
    orbitRadius: 2.8,
    orbitPeriod: 9.5,
    orbitSpeed: 0.66,
    orbitTilt: 0.26,
    color: '#f59e0b',
  },
  {
    id: 2,
    signalType: 'risk_surge',
    severity: 'critical',
    shape: 'cone',
    orbitRadius: 3.4,
    orbitPeriod: 11.2,
    orbitSpeed: 0.56,
    orbitTilt: 0.52,
    color: '#ef4444',
  },
  {
    id: 3,
    signalType: 'resource_overload',
    severity: 'info',
    shape: 'box',
    orbitRadius: 4.0,
    orbitPeriod: 12.8,
    orbitSpeed: 0.49,
    orbitTilt: 0.78,
    color: '#38bdf8',
  },
  {
    id: 4,
    signalType: 'milestone_slip',
    severity: 'warning',
    shape: 'needle',
    orbitRadius: 4.6,
    orbitPeriod: 14.5,
    orbitSpeed: 0.43,
    orbitTilt: 1.04,
    color: '#f59e0b',
  },
]

describe('SpaceMapStarNode 恒星与吸积盘构件测试 (Task 3.1)', () => {
  it('恒星根节点正确渲染并挂载元数据', () => {
    const { container } = render(<SpaceMapStarNode star={baseStar} />)
    const starNode = container.querySelector('[data-testid="star-node-101"]')
    expect(starNode).not.toBeNull()
    expect(fiberUserData(starNode)?.projectId).toBe(101)
    expect(fiberUserData(starNode)?.status).toBe('active')
    expect(fiberUserData(starNode)?.healthStatus).toBe('healthy')
  })

  it('进度 > 0% 时吸积盘光环正确渲染', () => {
    const { container } = render(<SpaceMapStarNode star={baseStar} />)
    const ring = container.querySelector('ringGeometry')
    expect(ring).not.toBeNull()
  })

  it('草稿状态呈现 wireframe 线框几何体，完成状态呈现 icosahedron 几何体', () => {
    const draftStar: StarVisualState = {
      ...baseStar,
      geometryType: 'wireframe',
      status: 'draft',
    }
    const { container: cDraft } = render(<SpaceMapStarNode star={draftStar} />)
    const draftMat = cDraft.querySelector('meshStandardMaterial')
    expect(fiberProps(draftMat)?.wireframe).toBe(true)

    const compStar: StarVisualState = {
      ...baseStar,
      geometryType: 'icosahedron',
      status: 'completed',
    }
    const { container: cComp } = render(<SpaceMapStarNode star={compStar} />)
    const icoGeom = cComp.querySelector('icosahedronGeometry')
    expect(icoGeom).not.toBeNull()
  })

  it('选中状态呈现引力聚焦光环 (data-testid="star-focus-ring")', () => {
    const selectedStar: StarVisualState = {
      ...baseStar,
      isSelected: true,
    }
    const { container } = render(<SpaceMapStarNode star={selectedStar} />)
    const focusRing = container.querySelector('[data-testid="star-focus-ring"]')
    expect(focusRing).not.toBeNull()
  })

  it('点击恒星节点触发 onSelect 回调', () => {
    const onSelect = vi.fn()
    const { container } = render(<SpaceMapStarNode star={baseStar} onSelect={onSelect} />)
    const node = container.querySelector('[data-testid="star-node-101"]')!
    fireEvent.click(node)
    expect(onSelect).toHaveBeenCalledWith(101)
  })

  it('LOD 视距分层契约：lodLevel 为 lod-far 时剔除信号微天体以压降 Draw Call，lod-near 时完整渲染', () => {
    const starWithSignals: StarVisualState = {
      ...baseStar,
      signals: mockSignals,
    }

    // 远距离 LOD (lod-far)：剔除所有信号子天体，Draw Call 严格受控
    const { container: cFar } = render(
      <SpaceMapStarNode star={starWithSignals} lodLevel="lod-far" />,
    )
    expect(cFar.querySelector('[data-testid^="signal-orbiter-"]')).toBeNull()
    expect(fiberUserData(cFar.querySelector('[data-testid="star-node-101"]'))?.lodLevel).toBe(
      'lod-far',
    )

    // 近距离特写 LOD (lod-near)：信号微天体全部完整就位
    const { container: cNear } = render(
      <SpaceMapStarNode star={starWithSignals} lodLevel="lod-near" />,
    )
    expect(cNear.querySelectorAll('[data-testid^="signal-orbiter-"]').length).toBe(4)
    expect(fiberUserData(cNear.querySelector('[data-testid="star-node-101"]'))?.lodLevel).toBe(
      'lod-near',
    )
  })

  it('isLODDetailOnly 模式仅挂载特写聚焦环与信号，跳过核心 Mesh 杜绝重复 Draw Call', () => {
    const selectedWithSignals: StarVisualState = {
      ...baseStar,
      isSelected: true,
      signals: mockSignals,
    }

    const { container } = render(
      <SpaceMapStarNode star={selectedWithSignals} lodLevel="lod-near" isLODDetailOnly={true} />,
    )

    // 不包含独立的 core mesh 或基础吸积盘（由 instancedMesh 承担）
    const node = container.querySelector('[data-testid="star-node-101"]')
    expect(fiberUserData(node)?.lodMode).toBe('detail-only')
    expect(container.querySelector('[data-testid="star-core-mesh"]')).toBeNull()

    // 依然包含聚焦环与信号子构件
    expect(container.querySelector('[data-testid="star-focus-ring"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid^="signal-orbiter-"]').length).toBe(4)
  })
})

describe('SpaceMapSignalOrbiter 4 类信号环绕微天体测试 (Task 3.3)', () => {
  it('4 类信号微天体几何形状与严重度标签完整渲染', () => {
    for (const sig of mockSignals) {
      const { container } = render(<SpaceMapSignalOrbiter signal={sig} />)
      const orbiter = container.querySelector(`[data-testid="signal-orbiter-${sig.id}"]`)
      expect(orbiter, `信号 ${sig.id} 应当存在`).not.toBeNull()
      expect(fiberUserData(orbiter)?.shape).toBe(sig.shape)
      expect(fiberUserData(orbiter)?.signalType).toBe(sig.signalType)
      expect(fiberUserData(orbiter)?.severity).toBe(sig.severity)
    }
  })

  it('恒星节点包含信号数组时，完整渲染子环绕体', () => {
    const starWithSignals: StarVisualState = {
      ...baseStar,
      signals: mockSignals,
    }
    const { container } = render(<SpaceMapStarNode star={starWithSignals} />)
    for (const sig of mockSignals) {
      expect(container.querySelector(`[data-testid="signal-orbiter-${sig.id}"]`)).not.toBeNull()
    }
  })
})

describe('SpaceMapSectorMesh 与 SpaceMapOrbitRails 星区构件测试 (Task 3.2)', () => {
  it('星区构件完整渲染四大星区 (core, governance, knowledge, projects)', () => {
    const { container } = render(<SpaceMapSectorMesh />)
    expect(container.querySelector('[data-testid="sector-mesh-core"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sector-mesh-governance"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sector-mesh-knowledge"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sector-mesh-projects"]')).not.toBeNull()
  })

  it('引力连接导轨组件完整渲染', () => {
    const { container } = render(<SpaceMapOrbitRails />)
    expect(container.querySelector('[data-testid="galaxy-orbit-rails"]')).not.toBeNull()
  })
})

describe('computeGalaxyLayout 星系布局健壮性与输入防御 (v3-next-spacemap-robustness-fix)', () => {
  it('未提供入参或空数组时安全返回空布局', () => {
    const resDefault = computeGalaxyLayout()
    expect(resDefault.stars).toEqual([])
    expect(resDefault.starMap.size).toBe(0)
    expect(resDefault.coordinates).toEqual([])
    expect(resDefault.sectors.length).toBeGreaterThan(0)

    const resEmpty = computeGalaxyLayout([], [])
    expect(resEmpty.stars).toEqual([])
    expect(resEmpty.starMap.size).toBe(0)
    expect(resEmpty.coordinates).toEqual([])
  })

  it('传入 undefined 或 null 非数组输入时不抛错并返回空布局', () => {
    expect(() => {
      const res = computeGalaxyLayout(
        undefined as unknown as Project[],
        null as unknown as SpaceCoordinate[],
      )
      expect(res.stars).toEqual([])
      expect(res.starMap.size).toBe(0)
      expect(res.coordinates).toEqual([])
    }).not.toThrow()
  })

  it('传入 API 信封对象等非 Array 值时安全降级不抛错', () => {
    const envelopeObject = {
      data: {
        summary: 'loading',
        total: 0,
      },
    }

    expect(() => {
      const res = computeGalaxyLayout(
        envelopeObject as unknown as Project[],
        {} as unknown as SpaceCoordinate[],
      )
      expect(res.stars).toEqual([])
      expect(res.starMap.size).toBe(0)
      expect(res.coordinates).toEqual([])
    }).not.toThrow()
  })

  it('传入包含有效数组字段的信封对象或异常数据时维持防御并可读取', () => {
    const envelopeWithArray = {
      data: [
        {
          id: 201,
          name: 'Proxima Mission',
          departmentName: 'Deep Space',
          category: 'Exploration',
        },
      ],
    }

    expect(() => {
      const res = computeGalaxyLayout(envelopeWithArray as unknown as Project[])
      expect(res.stars.length).toBe(1)
      expect(res.stars[0]?.projectId).toBe(201)
    }).not.toThrow()
  })
})
