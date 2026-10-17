/**
 * 问题/风险/产品故障 taxonomy（design F，task 3.1）。
 *
 * 防止「问题页面」语义混淆：项目问题 Issue、项目风险 Risk、产品故障 Incident 与
 * AI 建议 Recommendation 是四个不同概念，落点不同。帮助中心与「问题与风险」
 * 入口共用本定义，保持术语一致。
 */
export type TaxonomyKind = 'issue' | 'risk' | 'incident' | 'recommendation'

export interface TaxonomyDefinition {
  kind: TaxonomyKind
  label: string
  definition: string
  example: string
  /** 应在哪里记录/处置。 */
  where: string
  /** 是否已实现（false → 页面标 planned，不伪造 CRUD）。 */
  implemented: boolean
}

export const ISSUE_RISK_TAXONOMY: readonly TaxonomyDefinition[] = [
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
  {
    kind: 'recommendation',
    label: 'AI 建议',
    definition: '基于事实证据的建议，不是事实本身。',
    example: '建议为室外演出增加备用电源。',
    where: '建议 inbox；接受后 preview/confirm 才转任务/风险。',
    implemented: true,
  },
]

export function taxonomyLabel(kind: TaxonomyKind): string {
  return ISSUE_RISK_TAXONOMY.find((t) => t.kind === kind)?.label ?? kind
}

/** 产品故障/系统异常 → 故障排查帮助文章映射。 */
export const INCIDENT_TO_HELP: Record<string, string> = {
  copilot_unavailable: 'troubleshooting.copilot-unavailable',
  login_failed: 'troubleshooting.login',
  project_loading_failed: 'troubleshooting.project-loading',
  ai_generation_failed: 'troubleshooting.ai-generation',
  ocr_failed: 'troubleshooting.ocr',
  sse_streaming_broken: 'troubleshooting.sse-streaming',
}
