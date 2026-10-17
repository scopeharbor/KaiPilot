/**
 * 确定性星系拓扑布局纯函数
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (域=星区, 项目=恒星, 信号=环绕体)
 * - design.md Decision 2, Decision 4
 * - tasks.md 2.1
 * - RL-14（确定性 UI 渲染器）：基于项目 ID 与类别哈希提供伪随机种子的确定性分布，禁止动态随机，执行耗时 < 3ms
 */

import type { Project } from '@/lib/api/projects'
import type { SpaceCoordinate } from '@/lib/next/space-coordinates'

export type GalaxySectorKey = 'core' | 'governance' | 'knowledge' | 'projects'

export interface GalaxySector {
  key: GalaxySectorKey
  name: string
  center: [number, number, number]
  radius: number
  description: string
  colorToken: string
}

export const GALAXY_SECTORS: Record<GalaxySectorKey, GalaxySector> = {
  core: {
    key: 'core',
    name: '核心中枢星区',
    center: [0, 45, 0],
    radius: 25,
    description: '平台核心导航与生成中枢',
    colorToken: '#facc15',
  },
  governance: {
    key: 'governance',
    name: '组织治理星区',
    center: [-60, 10, -20],
    radius: 35,
    description: 'PMO 决策、组织战略与合规治理',
    colorToken: '#00f0ff',
  },
  knowledge: {
    key: 'knowledge',
    name: '知识资源星区',
    center: [60, 10, -20],
    radius: 35,
    description: '知识底座、帮助中心与资料网格',
    colorToken: '#38bdf8',
  },
  projects: {
    key: 'projects',
    name: '业务项目星区',
    center: [0, -30, 40],
    radius: 55,
    description: '多维业务线与项目群星拓扑',
    colorToken: '#818cf8',
  },
}

export interface StarLayoutNode {
  projectId: number
  position: [number, number, number]
  sectorKey: GalaxySectorKey
  clusterTag: string
}

export interface CoordinateLayoutNode {
  coordinateId: string
  position: [number, number, number]
  sectorKey: GalaxySectorKey
}

export interface GalaxyLayoutResult {
  stars: StarLayoutNode[]
  starMap: Map<number, StarLayoutNode>
  coordinates: CoordinateLayoutNode[]
  sectors: GalaxySector[]
}

/** 确定性字符串哈希 */
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/** 确定性线性同余伪随机数 (LCG): ((seed * 9301 + 49297) % 233280) / 233280 */
export function getLcgRandom(seed: number): number {
  return ((Math.abs(seed) * 9301 + 49297) % 233280) / 233280
}

/**
 * 纯函数：根据项目列表与坐标清单计算三维拓扑位置
 */
interface ObjectWithPotentialArray {
  data?: unknown
  items?: unknown
  map?: unknown
  forEach?: unknown
}

export function computeGalaxyLayout(
  projects: Project[] = [],
  coordinates: readonly SpaceCoordinate[] = [],
): GalaxyLayoutResult {
  if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
    const obj = projects as unknown as ObjectWithPotentialArray
    if (typeof obj.map !== 'function') {
      try {
        Object.defineProperty(projects, 'map', {
          value: function (cb: (item: unknown, index: number) => unknown) {
            const self = this as ObjectWithPotentialArray
            const arr = Array.isArray(self.data)
              ? self.data
              : Array.isArray(self.items)
                ? self.items
                : []
            return arr.map(cb)
          },
          configurable: true,
          writable: true,
        })
      } catch {
        // ignore
      }
    }
    if (typeof obj.forEach !== 'function') {
      try {
        Object.defineProperty(projects, 'forEach', {
          value: function (cb: (item: unknown, index: number) => void) {
            const self = this as ObjectWithPotentialArray
            const arr = Array.isArray(self.data)
              ? self.data
              : Array.isArray(self.items)
                ? self.items
                : []
            return arr.forEach(cb)
          },
          configurable: true,
          writable: true,
        })
      } catch {
        // ignore
      }
    }
  }

  const potentialObj = (
    projects && typeof projects === 'object' ? projects : null
  ) as ObjectWithPotentialArray | null
  const safeProjects: Project[] = Array.isArray(projects)
    ? (projects as Project[])
    : Array.isArray(potentialObj?.data)
      ? (potentialObj.data as Project[])
      : Array.isArray(potentialObj?.items)
        ? (potentialObj.items as Project[])
        : []
  const safeCoordinates = Array.isArray(coordinates) ? coordinates : []

  const stars: StarLayoutNode[] = []
  const starMap = new Map<number, StarLayoutNode>()

  // 1. 计算项目恒星位置
  const projectSector = GALAXY_SECTORS.projects
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)) // ~2.39996 rad (137.5 deg)

  safeProjects.forEach((project, index) => {
    const clusterTag = project.departmentName || project.category || 'default'
    const tagHash = hashString(clusterTag)

    // 基于斐波那契螺旋扩散
    const i = index + 1
    const baseRadius = 8 + Math.sqrt(i) * 5.5
    const baseAngle = i * goldenAngle

    // 结合 LCG 伪随机种子进行微扰，杜绝完全规则重叠，维持 100% 确定性
    const s1 = (Math.abs(project.id) * 9301 + 49297) % 233280
    const r1 = s1 / 233280
    const s2 = (s1 * 9301 + 49297) % 233280
    const r2 = s2 / 233280
    const s3 = (s2 * 9301 + 49297) % 233280
    const r3 = s3 / 233280

    // 分簇偏移角
    const clusterAngleOffset = ((tagHash % 360) * Math.PI) / 180
    const finalAngle = baseAngle * 0.4 + clusterAngleOffset * 0.6 + (r1 - 0.5) * 0.4
    const finalRadius = Math.min(baseRadius + (r2 - 0.5) * 6, projectSector.radius)
    const heightOffset = (r3 - 0.5) * 16

    const x = Number((projectSector.center[0] + finalRadius * Math.cos(finalAngle)).toFixed(3))
    const y = Number((projectSector.center[1] + heightOffset).toFixed(3))
    const z = Number((projectSector.center[2] + finalRadius * Math.sin(finalAngle)).toFixed(3))

    const node: StarLayoutNode = {
      projectId: project.id,
      position: [x, y, z],
      sectorKey: 'projects',
      clusterTag,
    }

    stars.push(node)
    starMap.set(project.id, node)
  })

  // 2. 计算 47 个功能空间坐标拓扑位置
  const coordinateNodes: CoordinateLayoutNode[] = []
  safeCoordinates.forEach((coord, index) => {
    let sectorKey: GalaxySectorKey = 'core'
    const p = coord.path.toLowerCase()

    if (p.includes('/organization') || p.includes('/pmo') || p.includes('/admin')) {
      sectorKey = 'governance'
    } else if (p.includes('/knowledge') || p.includes('/help')) {
      sectorKey = 'knowledge'
    } else if (p.includes('/projects/')) {
      sectorKey = 'projects'
    } else {
      sectorKey = 'core'
    }

    const sec = GALAXY_SECTORS[sectorKey]
    const coordAngle = index * goldenAngle
    const dist = 5 + (index % 7) * 3.2
    const h = ((index % 5) - 2) * 2.5

    const cx = Number((sec.center[0] + dist * Math.cos(coordAngle)).toFixed(3))
    const cy = Number((sec.center[1] + h).toFixed(3))
    const cz = Number((sec.center[2] + dist * Math.sin(coordAngle)).toFixed(3))

    coordinateNodes.push({
      coordinateId: coord.id,
      position: [cx, cy, cz],
      sectorKey,
    })
  })

  return {
    stars,
    starMap,
    coordinates: coordinateNodes,
    sectors: Object.values(GALAXY_SECTORS),
  }
}
