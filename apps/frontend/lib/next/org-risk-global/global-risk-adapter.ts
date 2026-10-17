/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.5 —— 全局「问题 vs 风险 vs 产品故障」
 * taxonomy 纯数据适配器。
 *
 * 新轨问题与风险入口（/next/risks，全局跨项目视角）的展示层纯数据底座：三分语义
 * （项目问题 / 项目风险 / 产品故障）与「可用 / 规划中」徽标语义对齐旧轨
 * `lib/help/taxonomy.ts` 的 ISSUE_RISK_TAXONOMY（同款 definition/example/where 语义，
 * 新轨自建、零 UI 依赖——不 import 旧轨文件也不 import 任何组件）；
 * - 「项目问题」（Issue）后端模型已投产（旧轨 /risks 5700d5f6 起真实可用）→
 *   implemented=true，新轨问题工作台（IssueWorkbench）提供登记/筛选/状态机流转；
 * - 「项目风险」登记册真实可用，入口为项目级风险工作台（B6c 已迁 /next/projects/:id/risks）；
 * - 「产品故障」属软件/API/配置异常，不进入项目风险记录，引导帮助中心故障排查；
 * - 深链/查询地址为确定性常量（/next 新轨路由），与旧轨 /help、/projects 镜像错开。
 */
export type GlobalRiskTaxonomyKind = 'issue' | 'risk' | 'incident'

export interface GlobalRiskTaxonomyEntry {
  kind: GlobalRiskTaxonomyKind
  /** 卡片标题。 */
  label: string
  /** 一句话定义（与旧 ISSUE_RISK_TAXONOMY 语义一致）。 */
  definition: string
  /** 典型示例。 */
  example: string
  /** 应在哪里记录/处置。 */
  where: string
  /** 是否已实现（false → 页面标「规划中」，不伪造 CRUD）。 */
  implemented: boolean
}

/** 三分语义 taxonomy（与旧 ISSUE_RISK_TAXONOMY 同语义、同文案口径）。 */
export const GLOBAL_RISK_TAXONOMY: readonly GlobalRiskTaxonomyEntry[] = [
  {
    kind: 'issue',
    label: '项目问题',
    definition: '已经发生、正在阻塞项目目标达成的事实。',
    example: '场地申请被退回、供应商交付延迟。',
    where: '问题清单/关联任务，owner + severity + status + due。',
    implemented: true,
  },
  {
    kind: 'risk',
    label: '项目风险',
    definition: '尚未发生、但有一定概率与影响的不确定未来事件。',
    example: '下雨可能导致室外演出取消。',
    where: '风险登记册（probability + impact + trigger + response）。',
    implemented: true,
  },
  {
    kind: 'incident',
    label: '产品故障',
    definition: '软件、API 或配置异常（不是项目内容事实）。',
    example: 'Copilot 暂不可用、项目加载失败。',
    where: '帮助中心故障排查 / 反馈（附带 request id），不进入项目风险记录。',
    implemented: true,
  },
]

export function getGlobalRiskTaxonomyByKind(
  kind: GlobalRiskTaxonomyKind,
): GlobalRiskTaxonomyEntry | undefined {
  return GLOBAL_RISK_TAXONOMY.find((entry) => entry.kind === kind)
}

/** taxonomy 中文标签（未知回落原值）。 */
export function getGlobalRiskTaxonomyLabel(kind: GlobalRiskTaxonomyKind): string {
  return getGlobalRiskTaxonomyByKind(kind)?.label ?? kind
}

/** 可用性徽标文字：implemented → 可用；false → 规划中。 */
export function getTaxonomyStatusLabel(implemented: boolean): string {
  return implemented ? '可用' : '规划中'
}

/** 可用性徽标类（双通道：颜色 + 文字；规划中 = 琥珀、可用 = 恢复绿）。 */
export function getTaxonomyStatusChipClass(implemented: boolean): string {
  if (implemented) {
    return 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[var(--nx-status-success)]'
  }
  return 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]'
}

/** 项目风险登记册深链（B6c 已迁的新轨项目风险工作台，单项目 risk:view 由目标页守卫兜底）。 */
export function buildProjectRisksDeepLink(projectId: number | string): string {
  return `/next/projects/${projectId}/risks`
}

/** 产品故障处置入口：新轨帮助中心故障排查（?q= 与 /next/help/search 契约一致）。 */
export const INCIDENT_HELP_SEARCH_HREF = '/next/help/search?q=故障'

/** 项目创建入口（新轨生成剧场，供无项目空态引导）。 */
export const NEW_PROJECT_CREATE_HREF = '/next/create'
