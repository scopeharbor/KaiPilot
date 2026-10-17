/**
 * 新 UI 轨道的组织级灰度门控（v3-ui-next-track-foundation D-c）。
 *
 * 平台目前没有通用的租户 Feature Flag 服务端端点，本模块用
 * 「前端环境变量主开关 + 组织白名单」实现按 `organization_id` 维度的可靠判定：
 *
 * - `NEXT_PUBLIC_FF_NEXT_UI`：主开关
 *   - `'true' | '1' | 'on' | '*'` → 开启；未配白名单时全开，配了白名单则按白名单放行；
 *   - `'org_allowlist'` → 仅按白名单放行（白名单为空则无人可用）；
 *   - 缺省 / 空 / `'false'` / 其它未知值 → 全局关闭（Fail-Closed）。
 * - `NEXT_PUBLIC_FF_NEXT_UI_ORGS`：逗号分隔的组织 ID 白名单，如 `'1,2,5'`。
 *
 * 判定维度**只按 organization_id**（spec「组织级灰度门控」），禁止按用户随机哈希——
 * 同项目协同成员若在不同 UI 轨会产生灾难性的协作不一致。
 *
 * 平滑升级承诺（design D-c）：该函数是统一契约接口。未来后端交付租户级动态
 * Feature Flag 端点时，只需替换本模块内部的数据源（接入 TanStack Query），
 * 所有消费方（Topbar 入口、`(next)` 路由守卫）无需任何代码修改。
 */

/** 主开关（Fail-Closed：未配置或不可识别值一律关闭）。 */
function resolveMainSwitch(): 'enabled' | 'allowlist' | 'disabled' {
  const raw = (process.env.NEXT_PUBLIC_FF_NEXT_UI ?? '').trim().toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'on' || raw === '*') return 'enabled'
  if (raw === 'org_allowlist') return 'allowlist'
  return 'disabled'
}

/** 解析组织白名单：逗号分隔，非法条目忽略，返回只读集合。 */
function readOrgAllowlist(): ReadonlySet<number> {
  const raw = process.env.NEXT_PUBLIC_FF_NEXT_UI_ORGS ?? ''
  const ids = new Set<number>()
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (/^\d+$/.test(trimmed)) ids.add(Number(trimmed))
  }
  return ids
}

/**
 * 判定指定组织是否可体验新 UI。
 *
 * - 组织 ID 为空 / 未定义：一律拦截（无组织上下文不发放新轨访问权，降级拦截）；
 * - 主开关关闭（缺省 / `false`）：全局拦截，白名单不生效；
 * - 主开关 `'true' | '1' | 'on' | '*'`：白名单未配 → 全开；已配 → 按白名单放行；
 * - 主开关 `'org_allowlist'`：仅按白名单放行。
 */
export function isNextUiEnabledForOrg(organizationId: number | null | undefined): boolean {
  if (organizationId == null) return false

  const mode = resolveMainSwitch()
  if (mode === 'disabled') return false

  const allowlist = readOrgAllowlist()
  if (allowlist.size === 0) return mode === 'enabled'
  return allowlist.has(organizationId)
}
