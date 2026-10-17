/**
 * 数据到三维星体视觉参数映射纯函数
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (恒星=项目, 信号=环绕体), §3 (双向状态契约)
 * - design.md Decision 2, Decision 3 (状态机与映射表格)
 * - tasks.md 2.2
 * - 中性色纪律与防 Slop (RL-15)：中性设计系统令牌，禁过度红光与刺眼高光
 */

import type { Project, ProjectPriority, ProjectStatus } from '@/lib/api/projects'
import type {
  ProjectSignal,
  ProjectSignalSeverity,
  ProjectSignalType,
} from '@/lib/api/project-signals'

export type StarGeometryType = 'sphere' | 'wireframe' | 'icosahedron' | 'grey_matt'
export type OrbiterShape = 'asteroid' | 'cone' | 'box' | 'needle'

export interface StarSignalVisual {
  id: number
  signalType: ProjectSignalType
  severity: ProjectSignalSeverity
  shape: OrbiterShape
  orbitRadius: number
  orbitPeriod: number // 公转周期 (秒, 8s ~ 15s)
  orbitSpeed: number // 角速度 (rad/s)
  orbitTilt: number // 轨道倾角 (rad)
  color: string
}

export interface StarVisualState {
  projectId: number
  name: string
  code: string | null
  departmentName: string | null
  category: string | null
  position: [number, number, number]
  radius: number
  accretionOuterRadius: number
  hasAccretionRing: boolean
  color: string
  luminosity: number
  geometryType: StarGeometryType
  signals: StarSignalVisual[]
  isMatch: boolean
  isSelected: boolean
  scale: number
  opacity: number
  emissiveMultiplier: number
  targetCameraPosition: [number, number, number]
  healthStatus: string
  progressPercent: number
  priority: ProjectPriority
  status: ProjectStatus
  stats?: { memberCount: number; taskCount: number; milestoneCount: number }
}

export interface MapProjectOptions {
  position?: [number, number, number]
  signals?: ProjectSignal[]
  query?: string
  selectedId?: number | null
}

/** 中性色彩常量映射（严密对齐 --nx- 色彩令牌） */
export const STAR_COLOR_TOKENS = {
  healthy: '#38bdf8', // --nx-space-cyan (冷青)
  warning: '#f59e0b', // --nx-status-warning (战术琥珀黄)
  critical: '#ef4444', // --nx-status-danger (克制战术暗红)
  muted: '#64748b', // --nx-text-muted (冷灰)
  accent: '#00f0ff', // --nx-space-ai (天青)
} as const

/** 能级光度映射契约 (design.md Decision 3) */
export const PRIORITY_LUMINOSITY: Record<ProjectPriority, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
}

/** 信号形状映射契约 (design.md Decision 2) */
export const SIGNAL_SHAPE_MAP: Record<ProjectSignalType, OrbiterShape> = {
  progress_deviation: 'asteroid', // 偏心椭圆小行星
  risk_surge: 'cone', // 双锥体警戒卫星
  resource_overload: 'box', // 四棱小方块
  milestone_slip: 'needle', // 细微信标针
}

/** 解析项目健康度颜色 */
export function resolveStarColor(healthStatus?: string | null): string {
  const norm = (healthStatus || '').toLowerCase()
  if (norm === 'healthy' || norm === 'on_track' || norm === 'green') {
    return STAR_COLOR_TOKENS.healthy
  }
  if (norm === 'warning' || norm === 'at_risk' || norm === 'yellow') {
    return STAR_COLOR_TOKENS.warning
  }
  if (norm === 'critical' || norm === 'delayed' || norm === 'red') {
    return STAR_COLOR_TOKENS.critical
  }
  return STAR_COLOR_TOKENS.muted
}

/** 解析项目几何形构态 */
export function resolveStarGeometryType(status: ProjectStatus): StarGeometryType {
  switch (status) {
    case 'active':
      return 'sphere'
    case 'draft':
    case 'planning':
      return 'wireframe'
    case 'completed':
      return 'icosahedron'
    case 'archived':
    case 'cancelled':
    case 'on_hold':
    default:
      return 'grey_matt'
  }
}

/** 解析信号颜色 */
export function resolveSignalColor(severity: ProjectSignalSeverity): string {
  if (severity === 'critical') return STAR_COLOR_TOKENS.critical
  if (severity === 'warning') return STAR_COLOR_TOKENS.warning
  return STAR_COLOR_TOKENS.healthy
}

/**
 * 纯函数：将业务 Project 实体映射为三维视觉状态
 */
export function mapProjectToStarVisualState(
  project: Project,
  options: MapProjectOptions = {},
): StarVisualState {
  const { position = [0, 0, 0], signals = [], query = '', selectedId = null } = options

  // 1. 半径与吸积盘计算: starRadius = 1.0 + (progress / 100) * 1.2
  const progress = Math.max(0, Math.min(100, project.progressPercent ?? 0))
  const radius = Number((1.0 + (progress / 100) * 1.2).toFixed(3))
  const accretionOuterRadius = Number((radius + (progress / 100) * 1.5).toFixed(3))
  const hasAccretionRing = progress > 0

  // 2. 能级与色彩
  const luminosity = PRIORITY_LUMINOSITY[project.priority] ?? 0.5
  const color = resolveStarColor(project.healthStatus)
  const geometryType = resolveStarGeometryType(project.status)

  // 3. 4 类被动雷达信号环绕体 (最多 4 个 open 状态信号)
  const relatedSignals = signals
    .filter((s) => s.projectId === project.id && s.status === 'open')
    .slice(0, 4)

  const signalVisuals: StarSignalVisual[] = relatedSignals.map((sig, idx) => {
    const orbitRadius = Number((radius * 1.8 + idx * 0.6).toFixed(3))
    const orbitPeriod = Number((8 + idx * 2.2).toFixed(2)) // 8s ~ 15s
    const orbitSpeed = Number(((2 * Math.PI) / orbitPeriod).toFixed(4))
    const orbitTilt = Number((((idx * 45 + 15) * Math.PI) / 180).toFixed(4))
    const shape = SIGNAL_SHAPE_MAP[sig.signalType] || 'asteroid'
    const sigColor = resolveSignalColor(sig.severity)

    return {
      id: sig.id,
      signalType: sig.signalType,
      severity: sig.severity,
      shape,
      orbitRadius,
      orbitPeriod,
      orbitSpeed,
      orbitTilt,
      color: sigColor,
    }
  })

  // 4. 检索匹配与高亮虚化状态契约
  const q = query.trim().toLowerCase()
  let isMatch = true
  if (q.length > 0) {
    const nameMatch = project.name.toLowerCase().includes(q)
    const codeMatch = Boolean(project.code && project.code.toLowerCase().includes(q))
    const deptMatch = Boolean(
      project.departmentName && project.departmentName.toLowerCase().includes(q),
    )
    const catMatch = Boolean(project.category && project.category.toLowerCase().includes(q))
    isMatch = nameMatch || codeMatch || deptMatch || catMatch
  }

  // 5. 选中状态与聚焦机位目标
  const isSelected = selectedId === project.id
  const targetCameraPosition: [number, number, number] = [position[0], position[1], position[2] + 6]

  let scale = 1.0
  let opacity = 1.0
  let emissiveMultiplier = 1.0

  if (isMatch) {
    if (isSelected) {
      scale = 1.35
      emissiveMultiplier = 2.0
    } else if (q.length > 0) {
      scale = 1.2
      emissiveMultiplier = 1.5
    }
    opacity = 1.0
  } else {
    // 未命中项虚化退后
    opacity = 0.15
    scale = 0.85
    emissiveMultiplier = 0.2
  }

  return {
    projectId: project.id,
    name: project.name,
    code: project.code,
    departmentName: project.departmentName ?? null,
    category: project.category ?? null,
    position,
    radius,
    accretionOuterRadius,
    hasAccretionRing,
    color,
    luminosity,
    geometryType,
    signals: signalVisuals,
    isMatch,
    isSelected,
    scale,
    opacity,
    emissiveMultiplier,
    targetCameraPosition,
    healthStatus: project.healthStatus,
    progressPercent: progress,
    priority: project.priority,
    status: project.status,
    stats: project.stats,
  }
}
