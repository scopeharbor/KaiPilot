/**
 * 空间地图 3D 视距 LOD (Level of Detail) 分级契约与策略计算
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - design.md §Risks 第 299 行: 前景恒星启用距离衰减 LOD（远距离合并几何体），控制总 Draw Call < 40
 * - 门禁硬判据: instancedMesh 恒星=1 次 Draw Call + 星区+环绕体+轨道若干，总计 < 40
 * - 杜绝刺眼高光与过度动态，中性色彩驱动（RL-15）
 */

export type SpaceMapLODLevel = 'lod-far' | 'lod-medium' | 'lod-near'

export const SPACE_MAP_LOD_DISTANCES = {
  NEAR: 45, // 视距 <= 45: 近距特写，激活高精度聚焦引力环与雷达信号环绕微星
  MEDIUM: 85, // 视距 45 ~ 85: 中距过渡，恒星核心与吸积盘合批渲染
  FAR: 140, // 视距 > 85: 远距离概览，纯单 Draw Call instancedMesh，剔除细粒子以节约资源
} as const

/**
 * 根据相机距星系坐标原点或目标天体的三维欧几里得距离计算 LOD 档位
 */
export function computeSpaceMapLOD(distance: number): SpaceMapLODLevel {
  if (distance <= SPACE_MAP_LOD_DISTANCES.NEAR) return 'lod-near'
  if (distance <= SPACE_MAP_LOD_DISTANCES.MEDIUM) return 'lod-medium'
  return 'lod-far'
}
