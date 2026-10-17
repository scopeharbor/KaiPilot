/**
 * RL-15 3D / WebGL 白名单机制配置与路径校验工具
 *
 * 根据立项决策与三件套（proposal.md / design.md Decision 8）：
 * 默认禁止引入 3D 库（three / @react-three/fiber / @react-three/drei），
 * 仅允许显式白名单路径内使用。Layer 2 工作面永远禁止。
 */

export const THREE_WHITELIST_SURFACES = [
  'app/next-login',
  'components/next/3d/login',
  'app/(next)/next/create',
  'components/next/3d/theater',
  'components/next/3d/spacemap',
  'components/next/3d/shared',
  'lib/next/3d',
] as const

/**
 * 判定文件路径是否属于 3D 合法白名单路径
 * @param filepath 相对或绝对文件路径
 */
export function isThreeWhitelistedPath(filepath: string): boolean {
  if (!filepath) return false
  // 规范化路径：统一使用正斜杠，并移除开头的 ./ 或 /
  const normalized = filepath.replace(/\\/g, '/').replace(/^\.?\//, '')
  return THREE_WHITELIST_SURFACES.some((surface) => normalized.includes(surface))
}
