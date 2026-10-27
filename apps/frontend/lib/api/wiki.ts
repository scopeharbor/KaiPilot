/**
 * v3-llm-wiki-memory-foundation —— 记忆维基 API 客户端（/api/v1/wiki/*）。
 */
import { apiFetch, apiFetchEnvelope, apiRawFetch } from '@/lib/api-client'
import type {
  WikiIngestRunDto,
  WikiLintFindingDto,
  WikiLogEntryDto,
  WikiPageSummaryDto,
  WikiPageViewDto,
  WikiRetractionDto,
  WikiReviewQueueItemDto,
  WikiRevisionDetailDto,
  WikiRevisionDto,
  WikiScopeKind,
  WikiSettingsDto,
  WikiShadowSummaryDto,
  WikiDossierRefreshSummary,
  WikiEvalRunDto,
  WikiAnswerEvalEstimateDto,
  WikiSharedWithMeDto,
  WikiSpaceDto,
} from '@aiproj/types'

export interface WikiListEnvelope<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface WikiLintSummary {
  fixedBrokenLinks: number
  closedClaims: number
  indexRefreshed: boolean
  orphanPages: number
  stalePages: number
  /** 仍有效但命中撤回墓碑、本轮置为撤回的主张数。 */
  retractedClaims: number
  /** 因主张失效而解决的矛盾发现数。 */
  resolvedContradictions: number
}

const BASE = '/wiki'
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
})

export const wikiApi = {
  settings: () => apiFetch<WikiSettingsDto>(`${BASE}/settings`),
  setEnabled: (enabled: boolean) =>
    apiFetch<WikiSettingsDto>(`${BASE}/settings`, { ...json({ enabled }), method: 'PUT' }),

  listSpaces: () => apiFetchEnvelope<WikiListEnvelope<WikiSpaceDto>>(`${BASE}/spaces`),
  resolveSpace: (scopeKind: WikiScopeKind, scopeRefId?: number) =>
    apiFetch<WikiSpaceDto>(
      `${BASE}/spaces/resolve`,
      json(scopeRefId === undefined ? { scopeKind } : { scopeKind, scopeRefId }),
    ),
  listPages: (spaceId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiPageSummaryDto>>(
      `${BASE}/spaces/${spaceId}/pages?perPage=100`,
    ),
  createPage: (spaceId: number, slug: string, body: string, changeSummary = '') =>
    apiFetch<{ page: WikiPageSummaryDto; revision: WikiRevisionDto; published: boolean }>(
      `${BASE}/spaces/${spaceId}/pages`,
      json({ slug, body, changeSummary }),
    ),
  search: (spaceId: number, q: string) =>
    apiFetchEnvelope<WikiListEnvelope<WikiPageSummaryDto>>(
      `${BASE}/spaces/${spaceId}/search?q=${encodeURIComponent(q)}`,
    ),
  log: (spaceId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiLogEntryDto>>(`${BASE}/spaces/${spaceId}/log`),
  findings: (spaceId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiLintFindingDto>>(
      `${BASE}/spaces/${spaceId}/lint-findings`,
    ),
  runLint: (spaceId: number) =>
    apiFetch<WikiLintSummary>(`${BASE}/spaces/${spaceId}/lint`, json({})),
  /** 项目结项后生成或刷新复盘页（项目维基审阅者，确定性统计）。 */
  refreshRetrospective: (projectId: number) =>
    apiFetch<WikiDossierRefreshSummary>(
      `${BASE}/projects/${projectId}/retrospective/refresh`,
      json({}),
    ),
  /** 请 AI 从复盘页提炼教训（异步，只产出待审提议）。 */
  draftLessons: (pageId: number) =>
    apiFetch<WikiIngestRunDto>(`${BASE}/pages/${pageId}/lessons`, json({})),
  /** 把复盘页的一条教训晋升到组织教训库（组织空间待审提议）。 */
  promoteLesson: (claimId: number) =>
    apiFetch<{ pageId: number; revisionId: number }>(`${BASE}/claims/${claimId}/promote`, json({})),
  /** 按关键词与项目类型召回组织教训库里已发布、可见的教训（只读）。 */
  recallLessons: (q: string, projectId?: number) =>
    apiFetchEnvelope<
      WikiListEnvelope<{
        claimId: number
        pageId: number
        statement: string
        section: string | null
        score: number
      }>
    >(
      `${BASE}/lessons/recall?q=${encodeURIComponent(q)}${projectId ? `&projectId=${projectId}` : ''}`,
    ),
  /** 运行维基评测（问答集 + 计划回测 + 切换门禁；确定性、不调用模型）。 */
  runEval: (questions: unknown) =>
    apiFetch<WikiEvalRunDto>(`${BASE}/eval/run`, json({ questions })),
  evalRuns: () => apiFetchEnvelope<WikiListEnvelope<WikiEvalRunDto>>(`${BASE}/eval/runs`),
  /** 回答评测的调用次数与 token 估算（不调用 AI；v3-llm-wiki-rag-retirement）。 */
  estimateAnswerEval: (questions: unknown) =>
    apiFetch<WikiAnswerEvalEstimateDto>(`${BASE}/eval/answer-estimate`, json({ questions })),
  /** 确认费用后开始回答评测（异步，会调用组织的 AI 连接）。 */
  runAnswerEval: (questions: unknown) =>
    apiFetch<WikiIngestRunDto>(`${BASE}/eval/answer-run`, json({ questions, confirmCost: true })),
  /** 最近一次回答评测的运行状态。 */
  latestAnswerEval: () => apiFetch<WikiIngestRunDto | null>(`${BASE}/eval/answer-runs/latest`),
  /** 把本项目 / 组织的 AI 同事记忆迁移为本空间的待审提议（审阅者）。 */
  migrateCopilotMemory: (spaceId: number) =>
    apiFetch<{
      imported: number
      skipped: number
      pageId: number | null
      revisionId: number | null
    }>(`${BASE}/spaces/${spaceId}/import-copilot-memory`, json({})),
  /** 请 AI 检查本空间主张之间的矛盾（异步，只写体检发现、不改页面）。 */
  contradictionCheck: (spaceId: number) =>
    apiFetch<WikiIngestRunDto>(`${BASE}/spaces/${spaceId}/contradiction-check`, json({})),
  /** 忽略一条体检发现（之后不再重新打开）。 */
  dismissFinding: (findingId: number) =>
    apiFetch<WikiLintFindingDto>(`${BASE}/lint-findings/${findingId}/dismiss`, json({})),
  retractions: (spaceId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiRetractionDto>>(`${BASE}/spaces/${spaceId}/retractions`),
  liftRetraction: (retractionId: number) =>
    apiFetch<{ lifted: boolean }>(`${BASE}/retractions/${retractionId}`, { method: 'DELETE' }),
  clearPersonalSpace: (spaceId: number) =>
    apiFetch<{ pagesDeleted: number }>(`${BASE}/spaces/${spaceId}/clear`, json({})),
  exportSpace: async (spaceId: number): Promise<{ blob: Blob; filename: string }> => {
    const res = await apiRawFetch(`${BASE}/spaces/${spaceId}/export`)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      throw {
        status: res.status,
        code: 'EXPORT_FAILED',
        message: body?.error?.message ?? '导出失败',
      }
    }
    const match = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') ?? '')
    return { blob: await res.blob(), filename: match?.[1] ?? `wiki-space-${spaceId}.zip` }
  },

  /** 把 AI 同事的回答存成待审的归档回答页（v3-llm-wiki-query-navigation）。 */
  fileBack: (input: {
    projectId: number | null
    title: string
    question: string
    answer: string
  }) =>
    apiFetch<{ pageId: number; spaceId: number; revision: WikiRevisionDto }>(
      `${BASE}/file-back`,
      json(input),
    ),
  shadowSummary: () => apiFetch<WikiShadowSummaryDto>(`${BASE}/shadow-summary`),
  /** 刷新计划档案（参照类 / 打法页，确定性统计；v3-llm-wiki-planning-dossier）。 */
  refreshDossier: () => apiFetch<WikiDossierRefreshSummary>(`${BASE}/dossier/refresh`, json({})),
  /** 刷新流程实况（任务流转 / 变更审批，确定性统计；v3-llm-wiki-process-reality）。 */
  refreshProcess: () => apiFetch<WikiDossierRefreshSummary>(`${BASE}/process/refresh`, json({})),
  /** 刷新本人的估算校准页（只作用于本人；v3-llm-wiki-person-space）。 */
  refreshMyEstimate: () =>
    apiFetch<WikiDossierRefreshSummary>(`${BASE}/me/estimate-calibration/refresh`, json({})),
  /** 把本人的 AI 记忆导入为偏好页待审提议。 */
  importMyMemory: () =>
    apiFetch<{
      imported: number
      skipped: number
      pageId: number | null
      revisionId: number | null
    }>(`${BASE}/me/import-memory`, json({})),
  /** 成员授权给我（项目经理）的个人页。 */
  sharedWithMe: () =>
    apiFetchEnvelope<WikiListEnvelope<WikiSharedWithMeDto>>(`${BASE}/shared-with-me`),
  /** 请 AI 解读流程页声明与实际的差异（异步，只产出待审提议）。 */
  interpretProcess: (pageId: number) =>
    apiFetch<WikiIngestRunDto>(`${BASE}/pages/${pageId}/interpret`, json({})),

  triggerIngest: (spaceId: number) =>
    apiFetch<WikiIngestRunDto>(`${BASE}/spaces/${spaceId}/ingest`, json({})),
  ingestRuns: (spaceId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiIngestRunDto>>(`${BASE}/spaces/${spaceId}/ingest-runs`),

  page: (pageId: number, asOf?: string) =>
    apiFetch<WikiPageViewDto>(
      `${BASE}/pages/${pageId}${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`,
    ),
  revisions: (pageId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiRevisionDto>>(`${BASE}/pages/${pageId}/revisions`),
  submitRevision: (
    pageId: number,
    body: string,
    baseRevisionId: number | null,
    changeSummary = '',
  ) =>
    apiFetch<{ revision: WikiRevisionDto; published: boolean }>(
      `${BASE}/pages/${pageId}/revisions`,
      json({ body, baseRevisionId, changeSummary }),
    ),
  rollback: (pageId: number, revisionId: number) =>
    apiFetch<WikiRevisionDto>(`${BASE}/pages/${pageId}/rollback`, json({ revisionId })),
  updateSharing: (pageId: number, projectIds: number[]) =>
    apiFetch<{ projectIds: number[] }>(`${BASE}/pages/${pageId}/sharing`, {
      ...json({ projectIds }),
      method: 'PUT',
    }),

  revision: (revisionId: number) =>
    apiFetch<WikiRevisionDetailDto>(`${BASE}/revisions/${revisionId}`),
  publish: (revisionId: number) =>
    apiFetch<WikiRevisionDto>(`${BASE}/revisions/${revisionId}/publish`, json({})),
  reject: (revisionId: number, reason: string) =>
    apiFetch<WikiRevisionDto>(`${BASE}/revisions/${revisionId}/reject`, json({ reason })),
  reviewQueue: (spaceId: number) =>
    apiFetchEnvelope<WikiListEnvelope<WikiReviewQueueItemDto>>(
      `${BASE}/review-queue?spaceId=${spaceId}`,
    ),
  retract: (claimId: number, reason: string) =>
    apiFetch<{
      retractionId: number
      proposalId: number | null
      /** 一并撤回的同一说法（含本条）。 */
      cascadedClaims: number
      /** 生成了删除提议的页面数。 */
      cascadedPages: number
    }>(`${BASE}/claims/${claimId}/retract`, json({ reason })),
}

export const WIKI_QUERY_KEYS = {
  all: ['wiki'] as const,
  settings: () => ['wiki', 'settings'] as const,
  evalRuns: () => ['wiki', 'eval-runs'] as const,
  answerEvalLatest: () => ['wiki', 'answer-eval-latest'] as const,
  lessonRecall: (q: string, projectId: number | undefined) =>
    ['wiki', 'lesson-recall', q, projectId ?? null] as const,
  space: (scopeKind: WikiScopeKind, scopeRefId: number | null) =>
    ['wiki', 'space', scopeKind, scopeRefId] as const,
  pages: (spaceId: number) => ['wiki', 'pages', spaceId] as const,
  page: (pageId: number, asOf: string | null) => ['wiki', 'page', pageId, asOf] as const,
  revisions: (pageId: number) => ['wiki', 'revisions', pageId] as const,
  queue: (spaceId: number) => ['wiki', 'queue', spaceId] as const,
  findings: (spaceId: number) => ['wiki', 'findings', spaceId] as const,
  retractions: (spaceId: number) => ['wiki', 'retractions', spaceId] as const,
  log: (spaceId: number) => ['wiki', 'log', spaceId] as const,
  ingestRuns: (spaceId: number) => ['wiki', 'ingest-runs', spaceId] as const,
  shadowSummary: () => ['wiki', 'shadow-summary'] as const,
  sharedWithMe: () => ['wiki', 'shared-with-me'] as const,
  search: (spaceId: number, q: string) => ['wiki', 'search', spaceId, q] as const,
}

/** 后端错误对象转可读文案（遮蔽/越权一律中性）。 */
export function wikiErrorMessage(error: unknown, fallback = '操作未能完成，请稍后重试。'): string {
  if (error && typeof error === 'object') {
    const e = error as { status?: number; code?: string; message?: string; details?: unknown }
    if (e.code === 'WIKI_STALE_BASE') return '页面已有更新的版本，请刷新后基于最新版本重新修改。'
    if (e.code === 'WIKI_CLAIM_RETRACTED')
      return '内容包含已被撤回的主张，需先由审阅者解除撤回记录。'
    if (e.code === 'FEATURE_DISABLED') return '本组织尚未开启记忆维基。'
    if (e.code === 'WIKI_INGEST_BUSY') return '这个空间已有 AI 编入在进行中，请稍后再试。'
    if (e.code === 'WIKI_ANSWER_EXISTS') return '这条回答已经存进维基了。'
    if (e.status === 404) return '页面不存在或你没有查看权限。'
    if (e.status === 403) return e.message || '没有执行此操作的权限。'
    if (e.message) return e.message
  }
  return fallback
}
