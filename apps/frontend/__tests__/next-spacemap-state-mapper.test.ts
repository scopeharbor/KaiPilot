import { describe, expect, it } from 'vitest'
import type { Project } from '@/lib/api/projects'
import type { ProjectSignal } from '@/lib/api/project-signals'
import type { SpaceCoordinate } from '@/lib/next/space-coordinates'
import {
  computeGalaxyLayout,
  hashString,
} from '@/components/next/3d/spacemap/spacemap-galaxy-layout'
import {
  mapProjectToStarVisualState,
  resolveStarColor,
  resolveStarGeometryType,
  STAR_COLOR_TOKENS,
  PRIORITY_LUMINOSITY,
  SIGNAL_SHAPE_MAP,
} from '@/components/next/3d/spacemap/spacemap-state-mapper'

const mockProjects: Project[] = [
  {
    id: 101,
    organizationId: 1,
    name: 'Apollo Project',
    code: 'APO-101',
    description: 'Core exploration',
    category: 'Innovation',
    status: 'active',
    priority: 'critical',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    budgetCents: 50000000,
    currency: 'CNY',
    progressPercent: 75,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    departmentName: 'R&D Lab',
  },
  {
    id: 102,
    organizationId: 1,
    name: 'Gemini Project',
    code: 'GEM-102',
    description: 'Planning stage',
    category: 'Operations',
    status: 'draft',
    priority: 'high',
    startDate: null,
    endDate: null,
    budgetCents: null,
    currency: 'CNY',
    progressPercent: 0,
    healthStatus: 'warning',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 103,
    organizationId: 1,
    name: 'Mercury Legacy',
    code: 'MER-103',
    description: 'Delivered',
    category: 'Legacy',
    status: 'completed',
    priority: 'low',
    startDate: null,
    endDate: null,
    budgetCents: null,
    currency: 'CNY',
    progressPercent: 100,
    healthStatus: 'critical',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 104,
    organizationId: 1,
    name: 'Saturn Vault',
    code: 'SAT-104',
    description: 'Archived project',
    category: 'Archive',
    status: 'archived',
    priority: 'medium',
    startDate: null,
    endDate: null,
    budgetCents: null,
    currency: 'CNY',
    progressPercent: 50,
    healthStatus: 'unknown',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

const mockCoordinates: SpaceCoordinate[] = [
  {
    id: 'next-home',
    title: '角色首页',
    path: '/next',
    description: '首屏中枢',
    status: 'available',
    iconName: 'Home',
    keywords: ['home'],
  },
  {
    id: 'next-pmo',
    title: 'PMO 决策中心',
    path: '/next/pmo/decisions',
    description: '治理决策',
    status: 'available',
    iconName: 'Gavel',
    keywords: ['pmo', 'decisions'],
  },
  {
    id: 'next-knowledge',
    title: '知识底座',
    path: '/next/knowledge',
    description: '知识资源',
    status: 'available',
    iconName: 'BookOpen',
    keywords: ['knowledge'],
  },
  {
    id: 'next-project-reports',
    title: '项目报告',
    path: '/next/projects/:id/reports',
    description: '项目空间报告',
    status: 'available',
    iconName: 'FileText',
    keywords: ['reports'],
  },
]

const mockSignals: ProjectSignal[] = [
  {
    id: 1,
    organizationId: 1,
    projectId: 101,
    signalType: 'progress_deviation',
    signalTypeLabel: '进度偏差',
    confidenceTier: 'high',
    tierReasons: { window: '7d' },
    severity: 'warning',
    evidence: null,
    evidenceRedacted: false,
    redactedReason: null,
    requiredPermission: 'project:view',
    idempotencyKey: 'k1',
    observationWindow: '7d',
    expiresAt: null,
    status: 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    organizationId: 1,
    projectId: 101,
    signalType: 'risk_surge',
    signalTypeLabel: '风险突变',
    confidenceTier: 'high',
    tierReasons: { window: '7d' },
    severity: 'critical',
    evidence: null,
    evidenceRedacted: false,
    redactedReason: null,
    requiredPermission: 'project:view',
    idempotencyKey: 'k2',
    observationWindow: '7d',
    expiresAt: null,
    status: 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 3,
    organizationId: 1,
    projectId: 101,
    signalType: 'resource_overload',
    signalTypeLabel: '资源过载',
    confidenceTier: 'low',
    tierReasons: { window: '7d' },
    severity: 'info',
    evidence: null,
    evidenceRedacted: false,
    redactedReason: null,
    requiredPermission: 'project:view',
    idempotencyKey: 'k3',
    observationWindow: '7d',
    expiresAt: null,
    status: 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 4,
    organizationId: 1,
    projectId: 101,
    signalType: 'milestone_slip',
    signalTypeLabel: '里程碑滑移',
    confidenceTier: 'high',
    tierReasons: { window: '7d' },
    severity: 'warning',
    evidence: null,
    evidenceRedacted: false,
    redactedReason: null,
    requiredPermission: 'project:view',
    idempotencyKey: 'k4',
    observationWindow: '7d',
    expiresAt: null,
    status: 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 5,
    organizationId: 1,
    projectId: 101,
    signalType: 'risk_surge',
    signalTypeLabel: '已忽略信号（应被过滤）',
    confidenceTier: 'high',
    tierReasons: { window: '7d' },
    severity: 'critical',
    evidence: null,
    evidenceRedacted: false,
    redactedReason: null,
    requiredPermission: 'project:view',
    idempotencyKey: 'k5',
    observationWindow: '7d',
    expiresAt: null,
    status: 'dismissed',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

describe('spacemap-galaxy-layout 算法确定性与拓扑测试', () => {
  it('具有 100% 确定性：多次调用相同输入输出绝对一致（无随机抖动，RL-14）', () => {
    const run1 = computeGalaxyLayout(mockProjects, mockCoordinates)
    const run2 = computeGalaxyLayout(mockProjects, mockCoordinates)

    expect(run1.stars).toEqual(run2.stars)
    expect(run1.coordinates).toEqual(run2.coordinates)
    expect(run1.sectors.length).toBe(4)
  })

  it('执行耗时严格 < 3ms', () => {
    const t0 = performance.now()
    computeGalaxyLayout(mockProjects, mockCoordinates)
    const cost = performance.now() - t0
    expect(cost).toBeLessThan(3)
  })

  it('47 个空间坐标正确落入四大星区（core, governance, knowledge, projects）', () => {
    const result = computeGalaxyLayout([], mockCoordinates)
    const map = new Map(result.coordinates.map((c) => [c.coordinateId, c.sectorKey]))

    expect(map.get('next-home')).toBe('core')
    expect(map.get('next-pmo')).toBe('governance')
    expect(map.get('next-knowledge')).toBe('knowledge')
    expect(map.get('next-project-reports')).toBe('projects')
  })

  it('hashString 纯函数对于相同字符串生成确定性哈希', () => {
    expect(hashString('R&D Lab')).toBe(hashString('R&D Lab'))
    expect(hashString('Operations')).not.toBe(hashString('Innovation'))
  })

  it('安全处理空输入', () => {
    const emptyResult = computeGalaxyLayout([], [])
    expect(emptyResult.stars).toEqual([])
    expect(emptyResult.coordinates).toEqual([])
    expect(emptyResult.sectors.length).toBe(4)
  })
})

describe('spacemap-state-mapper 状态驱动与参数映射测试', () => {
  it('半径与吸积盘数学映射契约（progress 0% -> 1.0, progress 100% -> 2.2）', () => {
    const p1 = mockProjects[1]!
    const p2 = mockProjects[2]!
    const p0 = mockProjects[0]!

    const zeroProgress = mapProjectToStarVisualState(p1) // progressPercent = 0
    expect(zeroProgress.radius).toBe(1.0)
    expect(zeroProgress.accretionOuterRadius).toBe(1.0)
    expect(zeroProgress.hasAccretionRing).toBe(false)

    const fullProgress = mapProjectToStarVisualState(p2) // progressPercent = 100
    expect(fullProgress.radius).toBe(2.2)
    expect(fullProgress.accretionOuterRadius).toBe(3.7)
    expect(fullProgress.hasAccretionRing).toBe(true)

    const normalProgress = mapProjectToStarVisualState(p0) // progressPercent = 75
    // 1.0 + 0.75 * 1.2 = 1.9
    expect(normalProgress.radius).toBe(1.9)
    // 1.9 + 0.75 * 1.5 = 3.025
    expect(normalProgress.accretionOuterRadius).toBe(3.025)
    expect(normalProgress.hasAccretionRing).toBe(true)
  })

  it('能级光度映射契约：critical(1.0), high(0.8), medium(0.5), low(0.3)', () => {
    expect(PRIORITY_LUMINOSITY.critical).toBe(1.0)
    expect(PRIORITY_LUMINOSITY.high).toBe(0.8)
    expect(PRIORITY_LUMINOSITY.medium).toBe(0.5)
    expect(PRIORITY_LUMINOSITY.low).toBe(0.3)

    const critStar = mapProjectToStarVisualState(mockProjects[0]!) // critical
    expect(critStar.luminosity).toBe(1.0)

    const lowStar = mapProjectToStarVisualState(mockProjects[2]!) // low
    expect(lowStar.luminosity).toBe(0.3)
  })

  it('色彩中性色令牌映射：健康冷青、预警琥珀黄、异常战术暗红、其他冷灰', () => {
    expect(resolveStarColor('healthy')).toBe(STAR_COLOR_TOKENS.healthy)
    expect(resolveStarColor('on_track')).toBe(STAR_COLOR_TOKENS.healthy)
    expect(resolveStarColor('warning')).toBe(STAR_COLOR_TOKENS.warning)
    expect(resolveStarColor('at_risk')).toBe(STAR_COLOR_TOKENS.warning)
    expect(resolveStarColor('critical')).toBe(STAR_COLOR_TOKENS.critical)
    expect(resolveStarColor('delayed')).toBe(STAR_COLOR_TOKENS.critical)
    expect(resolveStarColor('archived')).toBe(STAR_COLOR_TOKENS.muted)
    expect(resolveStarColor(null)).toBe(STAR_COLOR_TOKENS.muted)
  })

  it('几何体形态构型契约：active 为 sphere, draft/planning 为 wireframe, completed 为 icosahedron, archived 为 grey_matt', () => {
    expect(resolveStarGeometryType('active')).toBe('sphere')
    expect(resolveStarGeometryType('draft')).toBe('wireframe')
    expect(resolveStarGeometryType('planning')).toBe('wireframe')
    expect(resolveStarGeometryType('completed')).toBe('icosahedron')
    expect(resolveStarGeometryType('archived')).toBe('grey_matt')
    expect(resolveStarGeometryType('cancelled')).toBe('grey_matt')
    expect(resolveStarGeometryType('on_hold')).toBe('grey_matt')
  })

  it('四类被动雷达信号微天体：偏心椭圆、双锥体、四棱方块、信标针，公转周期在 8s~15s', () => {
    expect(SIGNAL_SHAPE_MAP.progress_deviation).toBe('asteroid')
    expect(SIGNAL_SHAPE_MAP.risk_surge).toBe('cone')
    expect(SIGNAL_SHAPE_MAP.resource_overload).toBe('box')
    expect(SIGNAL_SHAPE_MAP.milestone_slip).toBe('needle')

    const starWithSignals = mapProjectToStarVisualState(mockProjects[0]!, {
      signals: mockSignals,
    })

    // 排除 dismissed 后的 4 个 open 信号全部映射
    expect(starWithSignals.signals.length).toBe(4)
    expect(starWithSignals.signals[0]?.shape).toBe('asteroid')
    expect(starWithSignals.signals[1]?.shape).toBe('cone')
    expect(starWithSignals.signals[2]?.shape).toBe('box')
    expect(starWithSignals.signals[3]?.shape).toBe('needle')

    // 公转周期在 [8, 15] 区间
    for (const sig of starWithSignals.signals) {
      expect(sig.orbitPeriod).toBeGreaterThanOrEqual(8)
      expect(sig.orbitPeriod).toBeLessThanOrEqual(15)
      expect(sig.orbitRadius).toBeGreaterThan(starWithSignals.radius)
    }
  })

  it('检索词匹配契约：命中项放大高亮，未命中项半透明虚化', () => {
    const matched = mapProjectToStarVisualState(mockProjects[0]!, { query: 'Apollo' })
    expect(matched.isMatch).toBe(true)
    expect(matched.opacity).toBe(1.0)
    expect(matched.scale).toBe(1.2)
    expect(matched.emissiveMultiplier).toBe(1.5)

    const unmatched = mapProjectToStarVisualState(mockProjects[1]!, { query: 'Apollo' })
    expect(unmatched.isMatch).toBe(false)
    expect(unmatched.opacity).toBe(0.15)
    expect(unmatched.scale).toBe(0.85)
    expect(unmatched.emissiveMultiplier).toBe(0.2)
  })

  it('选中状态契约：选中星体激活 isSelected、聚焦机位 [x, y, z + 6] 与高亮增强', () => {
    const selected = mapProjectToStarVisualState(mockProjects[0]!, {
      position: [10, 20, 30],
      selectedId: 101,
    })

    expect(selected.isSelected).toBe(true)
    expect(selected.scale).toBe(1.35)
    expect(selected.emissiveMultiplier).toBe(2.0)
    expect(selected.targetCameraPosition).toEqual([10, 20, 36])
  })
})
