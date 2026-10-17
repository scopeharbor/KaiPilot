import type { CockpitTarget } from '@aiproj/types'

/**
 * 安全导航 adapter（v3-strategy-execution-cockpit §5.9）。
 *
 * 只把授权 target 解析为既有工作台/详情的 href；未授权或缺失一律返回 '#'。
 * 该函数是纯字符串解析，不发起 mutation、confirm、模型请求或外部网络调用。
 * 下钻目的地端点仍会二次授权（后端强制），这里只负责“去哪个工作台”。
 */
export function resolveCockpitTargetHref(target: CockpitTarget | null): string {
  if (!target || !target.authorized) return '#'
  return target.href
}

/**
 * 低敏导航元数据：仅包含目标 kind 与授权标记，不含实体名称/证据/敏感字段。
 * 用于前端在渲染 <a> 时携带 a11y 上下文，同时不暴露任何不可授权信息。
 */
export function cockpitTargetAriaLabel(target: CockpitTarget | null): string {
  if (!target || !target.authorized) return '不可用'
  return '打开 ' + target.kind + ' 工作台'
}
