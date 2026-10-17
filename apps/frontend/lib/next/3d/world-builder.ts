/**
 * Cinematic World Builder（电影级世界构建器，v3-next-cinematic-techniques-completion D1）。
 *
 * 三面 3D 场景（登录/生成剧场/空间地图）的统一声明式场景编排层：
 * - 把「大气/照明/空间层（背景·中景·前景）/后处理」抽象为纯数据 spec；
 * - `buildWorldComposition(spec)` 输出带纵深分区与相机参数的有序构图描述，
 *   供场景组件按序装配（RL-14 确定性：同 spec 同构图）；
 * - 不替代 R3F 场景图，只做「导演台本」——场景元素仍由各面既有组件渲染。
 *
 * 深度分区（z 轴语义）：background z∈[-60,-30]（星云雾/远空），
 * midground z∈[-30,-8]（星野/结构体），foreground z∈[-8,2]（核心光体/主视觉）。
 */

export type WorldDepthBand = 'background' | 'midground' | 'foreground'

export interface WorldAtmosphereSpec {
  /** 深空雾色（hex）。 */
  fogColor: string
  /** 指数雾密度（FogExp2 density）。 */
  fogDensity: number
  /** 环境光强度。 */
  ambientIntensity: number
  /** 方向光强度与方位。 */
  directional: { intensity: number; position: [number, number, number] }
}

export interface WorldLayerSpec {
  /** 图层语义 id（如 nebula / starfield / core）。 */
  id: string
  /** 纵深分区。 */
  band: WorldDepthBand
  /** 对应组件（场景侧注册表按 key 渲染）。 */
  component: string
  /** 透传给组件的确定性参数。 */
  props?: Record<string, unknown>
}

export interface WorldPostSpec {
  /** 免库后处理总开关（仅 high 档启用）。 */
  enabled: boolean
  /** 暗角强度（0-1，建议 ≤0.45）。 */
  vignette: number
  /** 微 bloom 提升（0-1，建议 ≤0.25）。 */
  bloomLite: number
  /** 胶片颗粒强度（0-1，建议 ≤0.06）。 */
  grain: number
}

export interface WorldCameraSpec {
  position: [number, number, number]
  fov: number
}

export interface WorldSpec {
  id: string
  atmosphere: WorldAtmosphereSpec
  layers: readonly WorldLayerSpec[]
  camera: WorldCameraSpec
  post: WorldPostSpec
}

export interface WorldCompositionLayer extends WorldLayerSpec {
  /** 解析后的 z 区间（来自 band 语义）。 */
  zRange: readonly [number, number]
}

export interface WorldComposition {
  id: string
  atmosphere: WorldAtmosphereSpec
  camera: WorldCameraSpec
  post: WorldPostSpec
  /** 按 背景→中景→前景 排序的图层（渲染顺序稳定）。 */
  layers: readonly WorldCompositionLayer[]
}

/** 纵深分区 → z 区间映射（导演台本的确定性纵深契约）。 */
export const WORLD_DEPTH_BANDS: Record<WorldDepthBand, readonly [number, number]> = {
  background: [-60, -30],
  midground: [-30, -8],
  foreground: [-8, 2],
}

const BAND_ORDER: Record<WorldDepthBand, number> = {
  background: 0,
  midground: 1,
  foreground: 2,
}

/** 把声明式 spec 编排为有序构图（确定性：图层按分区序+原顺序稳定排序）。 */
export function buildWorldComposition(spec: WorldSpec): WorldComposition {
  const layers = spec.layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) =>
      BAND_ORDER[a.layer.band] === BAND_ORDER[b.layer.band]
        ? a.index - b.index
        : BAND_ORDER[a.layer.band] - BAND_ORDER[b.layer.band],
    )
    .map(({ layer }) => ({ ...layer, zRange: WORLD_DEPTH_BANDS[layer.band] }))
  return {
    id: spec.id,
    atmosphere: spec.atmosphere,
    camera: spec.camera,
    post: spec.post,
    layers,
  }
}

/** 登录页深空世界的导演台本（与 LoginSpaceScene 既有视觉一一对应）。 */
export const LOGIN_WORLD_SPEC: WorldSpec = {
  id: 'login-deep-space',
  atmosphere: {
    fogColor: '#05070f',
    fogDensity: 0.08,
    ambientIntensity: 0.4,
    directional: { intensity: 0.8, position: [5, 5, 5] },
  },
  camera: { position: [0, 0, 5.0], fov: 60 },
  layers: [
    { id: 'nebula', band: 'background', component: 'ProceduralNebula' },
    { id: 'starfield', band: 'midground', component: 'InstancedStarfield' },
    { id: 'core', band: 'foreground', component: 'VolumetricCore' },
  ],
  post: { enabled: true, vignette: 0.42, bloomLite: 0.18, grain: 0.045 },
}
