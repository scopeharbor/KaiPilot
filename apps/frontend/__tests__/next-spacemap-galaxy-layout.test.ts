import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/drei', () => ({
  Billboard: () => null,
  Html: () => null,
  OrbitControls: () => null,
  Stars: () => null,
}))
vi.mock('@react-three/fiber', () => ({ useFrame: () => {}, useThree: () => ({}) }))

import { layoutGalaxy } from '@/components/next/3d/spacemap/SpaceMapGalaxyScene'
import type { StarVisualState } from '@/components/next/3d/spacemap/spacemap-state-mapper'

const star = (projectId: number, taskCount = 10) =>
  ({ projectId, stats: { taskCount, memberCount: 1, milestoneCount: 0 } }) as StarVisualState

describe('空间地图项目星系布局', () => {
  it('两个项目左右排开（不会前后挡在同一条视线上）', () => {
    const { placements, radius } = layoutGalaxy([star(1), star(2)])
    expect(radius).toBe(10)
    const [a, b] = placements
    expect(Math.sign(a!.position[0])).toBe(-Math.sign(b!.position[0]))
    expect(Math.abs(a!.position[2])).toBeLessThan(0.001)
  })

  it('超过 10 个项目分多圈，任务越多星越大且有上限', () => {
    const stars = Array.from({ length: 25 }, (_, i) => star(i + 1, i === 0 ? 5000 : 1))
    const { placements, radius } = layoutGalaxy(stars)
    expect(radius).toBe(24) // 三圈：10 / 17 / 24
    const big = placements[0]!.size
    const small = placements[1]!.size
    expect(big).toBeGreaterThan(small)
    expect(big).toBeLessThanOrEqual(2.0)
    const r = (i: number) => Math.hypot(placements[i]!.position[0], placements[i]!.position[2])
    expect(r(0)).toBeCloseTo(10)
    expect(r(12)).toBeCloseTo(17)
    expect(r(24)).toBeCloseTo(24)
  })
})
