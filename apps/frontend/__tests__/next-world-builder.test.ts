/**
 * Cinematic World Builder（世界构建器）单测。
 *
 * 覆盖（v3-next-cinematic-techniques-completion D1）：
 * - 图层按 背景→中景→前景 稳定排序（乱序输入确定性归位）；
 * - 纵深分区 z 区间映射正确且只读；
 * - LOGIN_WORLD_SPEC 台本完整性（星云/星野/核心三层 + 大气/相机/后处理参数）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildWorldComposition,
  LOGIN_WORLD_SPEC,
  WORLD_DEPTH_BANDS,
  type WorldSpec,
} from '@/lib/next/3d/world-builder'

describe('buildWorldComposition：三段构图编排', () => {
  it('乱序图层按 背景→中景→前景 确定性归位并附 z 区间', () => {
    const spec: WorldSpec = {
      id: 'test',
      atmosphere: LOGIN_WORLD_SPEC.atmosphere,
      camera: LOGIN_WORLD_SPEC.camera,
      post: LOGIN_WORLD_SPEC.post,
      layers: [
        { id: 'fg', band: 'foreground', component: 'C' },
        { id: 'bg', band: 'background', component: 'A' },
        { id: 'mid', band: 'midground', component: 'B' },
      ],
    }
    const composition = buildWorldComposition(spec)
    expect(composition.layers.map((layer) => layer.id)).toEqual(['bg', 'mid', 'fg'])
    expect(composition.layers[0]!.zRange).toBe(WORLD_DEPTH_BANDS.background)
    expect(composition.layers[1]!.zRange).toBe(WORLD_DEPTH_BANDS.midground)
    expect(composition.layers[2]!.zRange).toBe(WORLD_DEPTH_BANDS.foreground)
  })

  it('同分区图层保持原顺序（稳定排序）', () => {
    const spec: WorldSpec = {
      ...LOGIN_WORLD_SPEC,
      layers: [
        { id: 'a', band: 'background', component: 'A' },
        { id: 'b', band: 'background', component: 'B' },
      ],
    }
    expect(buildWorldComposition(spec).layers.map((layer) => layer.id)).toEqual(['a', 'b'])
  })
})

describe('LOGIN_WORLD_SPEC：登录页深空导演台本', () => {
  it('三层语义与组件映射正确', () => {
    expect(LOGIN_WORLD_SPEC.layers.map((layer) => [layer.id, layer.band, layer.component])).toEqual(
      [
        ['nebula', 'background', 'ProceduralNebula'],
        ['starfield', 'midground', 'InstancedStarfield'],
        ['core', 'foreground', 'VolumetricCore'],
      ],
    )
  })

  it('后处理参数克制（防 Slop 上限内）', () => {
    const { post } = LOGIN_WORLD_SPEC
    expect(post.enabled).toBe(true)
    expect(post.vignette).toBeLessThanOrEqual(0.45)
    expect(post.bloomLite).toBeLessThanOrEqual(0.25)
    expect(post.grain).toBeLessThanOrEqual(0.06)
  })

  it('纵深分区语义连续（背景远于中景远于前景）', () => {
    expect(WORLD_DEPTH_BANDS.background[1]).toBeLessThanOrEqual(WORLD_DEPTH_BANDS.midground[0])
    expect(WORLD_DEPTH_BANDS.midground[1]).toBeLessThanOrEqual(WORLD_DEPTH_BANDS.foreground[0])
  })
})
