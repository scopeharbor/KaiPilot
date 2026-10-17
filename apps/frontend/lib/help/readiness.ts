/**
 * Page readiness registry（design G 合同 + task 3.3）。
 *
 * 覆盖 `/risks`、`/tasks`、`/calendar`、`/resources`、`/reports`、
 * `/recommendations`、`/change-requests`。占位/半完成页必须给出真实状态、
 * 替代路径与帮助文章，禁止无解释空白或永久 loading（spec scenario）。
 */
export type PageStatus = 'ready' | 'partial' | 'planned' | 'degraded'

export interface PageReadiness {
  /** 路由模式（`/` 开头；尾 `/` 可忽略）。 */
  routePattern: string
  status: PageStatus
  /** 帮助文章 id（navigation.yaml 中必须存在）。 */
  helpArticleId: string
  /** 支持的替代路径（ready 页可省略）。 */
  alternativeRoute?: string
  requiredPermission?: string
  featureFlag?: string
  /** 状态说明（页面/帮助中展示，诚实描述可用与不可用部分）。 */
  note: string
}

export const PAGE_READINESS: readonly PageReadiness[] = [
  {
    routePattern: '/risks',
    status: 'ready',
    helpArticleId: 'management.issues-and-risks',
    note: '风险登记册与项目问题清单均可用：问题可登记、筛选并按状态机流转（解决时须填写根因与措施）。',
  },
  {
    routePattern: '/tasks',
    status: 'ready',
    helpArticleId: 'projects.views-overview',
    note: '跨项目任务聚合可用：默认显示分配给我的未完成任务，可切换全部任务与状态；每个项目最多汇总 100 项。',
  },
  {
    routePattern: '/calendar',
    status: 'ready',
    helpArticleId: 'projects.views-overview',
    note: '全局日历可用：按月汇总各项目任务与里程碑的截止日，可只看我的；外部日历可在「设置 → 集成」绑定。',
  },
  {
    routePattern: '/resources',
    status: 'ready',
    helpArticleId: 'management.resources',
    note: '资源视图可用：显式选择项目查看资源清单，分配与负载请进入项目资源页。',
  },
  {
    routePattern: '/reports',
    status: 'ready',
    helpArticleId: 'management.reports',
    note: '报表中心可用：项目选择 → 预设/自定义报表 → 导出。权限受限时显示无权限提示。',
  },
  {
    routePattern: '/recommendations',
    status: 'ready',
    helpArticleId: 'management.recommendations',
    requiredPermission: 'recommendation:view',
    note: '智能推荐可用：基于事实证据的建议，接受后走 preview/confirm，不会自动落库。',
  },
  {
    routePattern: '/change-requests',
    status: 'ready',
    helpArticleId: 'management.change-requests',
    requiredPermission: 'change_request:create',
    note: '变更管理可用（项目级）：变更请求登记 → 影响分析 → 审批。',
  },
]

/** 规范化路由（去尾部斜杠与 query/hash）。 */
export function normalizeRoute(route: string): string {
  const path = route.split(/[?#]/)[0] ?? route
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
}

/** 按路由模式查找 readiness；支持前缀匹配（/projects/123 命中 /projects）。 */
export function readinessFor(route: string): PageReadiness | undefined {
  const normalized = normalizeRoute(route)
  return PAGE_READINESS.find((r) => {
    if (r.routePattern === normalized) return true
    return normalized.startsWith(`${r.routePattern}/`)
  })
}

/** 生产导航是否应展示该路由（planned 默认隐藏）。 */
export function isNavVisible(route: string): boolean {
  const r = readinessFor(route)
  return r ? r.status !== 'planned' : true
}
