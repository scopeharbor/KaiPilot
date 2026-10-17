import { RoleHomeContainer } from '@/components/next/home/RoleHomeContainer'

/**
 * 新轨角色化首页（/next，v3-ui-next-shell-space-map D4/D6/D7 / tasks 3.8）。
 *
 * 由 RoleHomeContainer 组合角色欢迎横幅、建议卡槽与 `nx-space-atmosphere`
 * 深空氛围底座；角色化判定数据源为 auth-store 的 RBAC 角色体系（RL-04），
 * 卡槽为零后端接口的视觉骨架（RL-01 / spec「建议区卡槽骨架」）。
 */
export default function NextHomePage() {
  return <RoleHomeContainer />
}
