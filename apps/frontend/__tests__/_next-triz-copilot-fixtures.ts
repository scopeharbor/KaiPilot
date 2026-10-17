/**
 * 矛盾求解前端测试夹具与伪后端（v3-triz-contradiction-copilot W5）。
 *
 * 铁律（design D15 / tasks 5.2 验收）：`fetch` 一律用 `vi.stubGlobal` 装伪后端，
 * **禁止** `vi.mock('@/lib/api/*')` 式自证；夹具按后端真实响应形状构造
 * （`triz_copilot_analyses_controller.ts` / `ai_tools_executor_service.ts` 的信封）。
 */
import { vi } from 'vitest'
import type { ColleagueContext } from '@/lib/next/ai-colleague-intent'
import type { ColleagueTrizRun } from '@/stores/next-ai-colleague-store'
import type {
  TrizAnalysisDto,
  TrizCandidatePrincipleRef,
  TrizInterventionDiff,
  TrizInterventionTarget,
  TrizMappingPath,
  TrizMappingView,
  TrizParameterRef,
  TrizParameterItem,
  TrizSolutionDraft,
} from '@/lib/api/triz-copilot'

export const TRIZ_PROJECT_ID = 42

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------

export interface RecordedRequest {
  url: string
  method: string
  body: Record<string, unknown> | null
}

export interface TrizFakeBackend {
  calls: RecordedRequest[]
  /** 命中某路径片段的请求数（网络监控断言：零请求即 count === 0）。 */
  count: (fragment: string) => number
  /** 按序排队的受理响应（每次 POST /analyses 消费一条）。 */
  enqueueSolve: (body: unknown, status?: number) => void
  enqueueExecute: (body: unknown, status?: number) => void
  enqueueConfirm: (body: unknown, status?: number) => void
  enqueueOverride: (body: unknown, status?: number) => void
  enqueueParameters: (body: unknown, status?: number) => void
  restore: () => void
}

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function errorBody(code: string, message: string) {
  return { error: { code, message } }
}

export function apiErrorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, errorBody(code, message))
}

/**
 * 安装伪后端：按 URL 片段分发到各队列；队列空时按 500 失败（暴露测试未排队的调用）。
 * 所有请求（含方法、载荷）都记录进 `calls`，供「零请求」「单次提交」类断言使用。
 */
export function installTrizFakeBackend(): TrizFakeBackend {
  const calls: RecordedRequest[] = []
  const solveQueue: Array<{ body: unknown; status: number }> = []
  const executeQueue: Array<{ body: unknown; status: number }> = []
  const confirmQueue: Array<{ body: unknown; status: number }> = []
  const overrideQueue: Array<{ body: unknown; status: number }> = []
  const parametersQueue: Array<{ body: unknown; status: number }> = []

  function shift(queue: Array<{ body: unknown; status: number }>, label: string) {
    const next = queue.shift()
    if (!next) return apiErrorResponse(500, 'TEST_QUEUE_EMPTY', `未为该端点排队响应：${label}`)
    return jsonResponse(next.status, next.body)
  }

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    const method = init?.method ?? 'GET'
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    calls.push({ url, method, body })

    if (url.includes('/triz-copilot/parameters')) {
      if (parametersQueue.length > 0) return shift(parametersQueue, 'parameters')
      return jsonResponse(200, { data: make39Parameters() })
    }
    if (url.includes('/triz-copilot/analyses') && url.includes('/override')) {
      return shift(overrideQueue, 'override')
    }
    if (url.includes('/triz-copilot/analyses')) {
      if (method === 'GET')
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
        })
      return shift(solveQueue, 'solve')
    }
    if (url.includes('/ai/tools/execute')) return shift(executeQueue, 'execute')
    if (url.includes('/ai/tools/confirm')) return shift(confirmQueue, 'confirm')
    return apiErrorResponse(404, 'RESOURCE_NOT_FOUND', `未注册的伪后端路径：${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    count: (fragment: string) => calls.filter((call) => call.url.includes(fragment)).length,
    enqueueSolve: (body, status = 201) => solveQueue.push({ body, status }),
    enqueueExecute: (body, status = 200) => executeQueue.push({ body, status }),
    enqueueConfirm: (body, status = 200) => confirmQueue.push({ body, status }),
    enqueueOverride: (body, status = 200) => overrideQueue.push({ body, status }),
    enqueueParameters: (body, status = 200) => parametersQueue.push({ body, status }),
    restore: () => {
      vi.unstubAllGlobals()
    },
  }
}

// ---------------------------------------------------------------------------
// 契约夹具（形状对齐后端 DTO）
// ---------------------------------------------------------------------------

export function make39Parameters(): TrizParameterItem[] {
  const DISPLAY_NAMES: Record<number, string> = {
    9: '交付速度',
    13: '计划稳定性',
    22: '资源与预算浪费',
    24: '信息流失',
    25: '工期延误',
    26: '范围工作量',
    27: '交付可靠性',
    28: '度量与记录完整性',
    31: '副作用与技术债务',
    32: '可落地与可扩展性',
    33: '使用体验与流程效率',
    35: '变更响应弹性',
    36: '系统与组织复杂度',
    37: '管控可见性',
    38: '流程自动化',
    39: '团队产出效率',
  }
  return Array.from({ length: 39 }, (_, index) => {
    const number = index + 1
    return {
      number,
      nameZh: `参数${number}标准名`,
      displayName: DISPLAY_NAMES[number] ?? `参数${number}呈现名`,
      pmMeaning: `参数${number}面向 PM 的含义`,
      category: '通用维度',
    }
  })
}

export function makeParameter(number: number, displayName: string): TrizParameterRef {
  return { number, nameZh: `参数${number}`, displayName, pmMeaning: `${displayName}的项目含义` }
}

export function makeCandidate(
  number: number,
  displayName: string,
  source = 'triz-application-ai-pm.md §三 · 矛盾对 1',
): TrizCandidatePrincipleRef {
  return {
    rank: number,
    number,
    nameZh: `原则${number}`,
    displayName,
    definition: `${displayName}的定义`,
    source,
  }
}

export function makeSolution(
  index: number,
  principleNumber: number,
  title: string,
): TrizSolutionDraft {
  return {
    index,
    title,
    principle: {
      number: principleNumber,
      nameZh: `原则${principleNumber}`,
      nameEn: `Principle ${principleNumber}`,
      displayName: `原则${principleNumber}呈现名`,
      definition: `原则${principleNumber}定义`,
      softwareExamples: `原则${principleNumber}软件实例`,
      pmInterpretation: `原则${principleNumber}PM 释义`,
      source: 'triz-fundamentals.md §二 · 原则 10',
    },
    actionPoints: [{ text: `动作要点 ${index}`, entityRefs: ['task#12'] }],
    impact: { positive: `正向影响 ${index}`, negative: `负向代价 ${index}` },
    preconditions: [`前置条件 ${index}`],
    entityRefs: ['task#12'],
    entityBinding: 'bound',
    ranking: { principleStrength: 0.9, contextMatch: 0.8, executability: 0.7, score: 0.8 },
    toppedUp: false,
    requiresHumanConfirmation: true,
    persisted: false,
  }
}

export interface MakeSolveResultOverrides {
  id?: number
  parentAnalysisId?: number | null
  path?: TrizMappingPath
  clarification?: {
    needed?: boolean
    asked?: boolean
    round?: number
    maxRounds?: number
    exhausted?: boolean
    prompt?: string | null
    reason?: string | null
  }
  fallbackReasons?: string[]
  solutions?: TrizSolutionDraft[]
  improvingParameter?: TrizParameterRef | null
  worseningParameter?: TrizParameterRef | null
  candidatePrinciples?: TrizCandidatePrincipleRef[]
  excludedPrincipleNumbers?: number[]
  budgetState?: 'within_budget' | 'exhausted'
  budgetReason?: string | null
  humanOverride?: boolean
}

export function makeAnalysisDto(overrides: MakeSolveResultOverrides = {}): TrizAnalysisDto {
  const solutions = overrides.solutions ?? [
    makeSolution(1, 10, '预操作：提前建立自动化测试套件'),
    makeSolution(2, 28, '机械系统替代：用 CI/CD 自动化替代人工质检'),
    makeSolution(3, 24, '中介物：引入代码审查工具'),
  ]
  const candidatePrinciples = overrides.candidatePrinciples ?? [
    makeCandidate(10, '预操作'),
    makeCandidate(28, '机械系统替代'),
    makeCandidate(24, '中介物'),
  ]
  return {
    id: overrides.id ?? 501,
    organizationId: 1,
    projectId: TRIZ_PROJECT_ID,
    createdBy: 7,
    parentAnalysisId: overrides.parentAnalysisId ?? null,
    contradictionType: 'technical',
    contradictionTypeLabel: '技术矛盾',
    improvingParameter: overrides.improvingParameter ?? makeParameter(25, '工期延误'),
    worseningParameter: overrides.worseningParameter ?? makeParameter(27, '交付可靠性'),
    candidatePrinciples,
    path: overrides.path ?? 'rule',
    confidence: 0.8,
    entityBinding: 'bound',
    contextRefs: ['task#12'],
    qualityFlags: [],
    fallbackReasons: overrides.fallbackReasons ?? ['MODEL_DISABLED'],
    knowledgePackVersion: 'triz-kp-v1',
    statement: { digest: 'a'.repeat(32), length: 20, truncated: false },
    topSolutions: {
      path: overrides.path ?? 'rule',
      entityBinding: 'bound',
      solutions: solutions.map((solution) => ({
        index: solution.index,
        principleNumber: solution.principle.number,
        title: solution.title,
        score: solution.ranking.score,
        entityRefs: solution.entityRefs,
      })),
      excludedPrincipleNumbers: overrides.excludedPrincipleNumbers ?? [31],
      contextRefValidation: { accepted: 1, rejected: 0 },
      qualityFlags: [],
      knowledgePackVersion: 'triz-kp-v1',
    },
    humanOverride: overrides.humanOverride ?? false,
    overrideBy: null,
    overrideAt: null,
    budget: {
      clarificationRounds: overrides.clarification?.round ?? 0,
      metricReadCount: 3,
      tokenBudget: 4000,
      estimatedTokens: 0,
      actualTokens: 0,
      state: overrides.budgetState ?? 'within_budget',
      reason: overrides.budgetReason ?? null,
    },
    createdAt: '2026-09-11T10:00:00.000+08:00',
    updatedAt: '2026-09-11T10:00:00.000+08:00',
  }
}

export function makeMappingView(
  analysis: TrizAnalysisDto,
  overrides: Partial<TrizMappingView> = {},
): TrizMappingView {
  return {
    path: analysis.path,
    contradictionType: analysis.contradictionType,
    contradictionTypeLabel: analysis.contradictionTypeLabel,
    improvingParameter: analysis.improvingParameter,
    worseningParameter: analysis.worseningParameter,
    candidatePrinciples: analysis.candidatePrinciples,
    confidence: analysis.confidence,
    contextRefs: analysis.contextRefs,
    sourceMappingIds: ['PM-01'],
    sourceSections: ['triz-application-ai-pm.md §三 · 矛盾对 1'],
    qualityFlags: analysis.qualityFlags,
    fallbackReasons: analysis.fallbackReasons,
    needsClarification: analysis.candidatePrinciples.length === 0,
    ...overrides,
  }
}

/** 受理响应（POST /analyses 的 201 信封）。 */
export function makeSolveResponse(overrides: MakeSolveResultOverrides = {}) {
  const analysis = makeAnalysisDto(overrides)
  const clarification = {
    needed: overrides.clarification?.needed ?? false,
    asked: overrides.clarification?.asked ?? false,
    round: overrides.clarification?.round ?? 0,
    maxRounds: overrides.clarification?.maxRounds ?? 2,
    exhausted: overrides.clarification?.exhausted ?? false,
    prompt: overrides.clarification?.prompt ?? null,
    reason: overrides.clarification?.reason ?? null,
  }
  return {
    data: {
      ...analysis,
      mapping: makeMappingView(analysis),
      solutions: overrides.solutions ?? [
        makeSolution(1, 10, '预操作：提前建立自动化测试套件'),
        makeSolution(2, 28, '机械系统替代：用 CI/CD 自动化替代人工质检'),
        makeSolution(3, 24, '中介物：引入代码审查工具'),
      ],
      clarification,
      modelUsage: { providerCalls: 0, provider: null, totalTokens: 0 },
    },
  }
}

export function makeInterventionDiff(target: TrizInterventionTarget): TrizInterventionDiff {
  const entity =
    target === 'task'
      ? {
          name: '预操作：提前建立自动化测试套件',
          description: '来源原则 #10 · 参数 #25 → #27',
          status: 'not_started',
          priority: 'medium',
        }
      : target === 'risk'
        ? {
            title: '预操作：提前建立自动化测试套件',
            category: 'schedule',
            probability: 3,
            impact: 4,
          }
        : { crCode: 'CR-TRIZ-001', title: '预操作：提前建立自动化测试套件', changeType: 'scope' }
  return {
    target,
    operation: 'create',
    entity,
    links: [{ ref: 'task#12', kind: 'task', id: 12, label: '测试用例补充' }],
    notes: ['AI 只建议不自动执行：本预览未写入任何业务表，须显式确认后才落库（RL-01）。'],
    provenance: {
      source: 'triz_copilot_intervention',
      analysisId: 501,
      solutionIndex: 2,
      principleNumber: 28,
      knowledgePackVersion: 'triz-kp-v1',
      path: 'rule',
      confirmedByUserId: 7,
    },
  }
}

export function makePreviewEnvelope(target: TrizInterventionTarget, previewToken = 'a'.repeat(64)) {
  const diff = makeInterventionDiff(target)
  return {
    data: diff,
    meta: {
      toolName:
        target === 'task'
          ? 'create_task_from_intervention'
          : target === 'risk'
            ? 'create_risk_from_intervention'
            : 'create_change_request_from_intervention',
      status: 'PREVIEW_REQUIRED',
      durationMs: 12,
      previewToken,
      diff,
    },
  }
}

export function makeCommitEnvelope(target: TrizInterventionTarget) {
  const diff = makeInterventionDiff(target)
  return {
    data: {
      target,
      committed: true,
      entityId: 9001,
      entity: diff.entity,
      provenance: diff.provenance,
    },
    meta: {
      toolName:
        target === 'task'
          ? 'create_task_from_intervention'
          : target === 'risk'
            ? 'create_risk_from_intervention'
            : 'create_change_request_from_intervention',
      committed: true,
      durationMs: 42,
    },
  }
}

// ---------------------------------------------------------------------------
// 运行态 / 情境夹具（组件用例直接渲染卡片）
// ---------------------------------------------------------------------------

export function makeRun(overrides: Partial<ColleagueTrizRun> = {}): ColleagueTrizRun {
  const analysis = makeAnalysisDto(overrides.path ? { path: overrides.path } : {})
  return {
    phase: 'solved',
    projectId: TRIZ_PROJECT_ID,
    statement: '客户催进度，但再加人测试就跟不上了',
    analysisId: analysis.id,
    parentAnalysisId: null,
    contradictionType: analysis.contradictionType,
    contradictionTypeLabel: analysis.contradictionTypeLabel,
    mapping: makeMappingView(analysis),
    solutions: [
      makeSolution(1, 10, '预操作：提前建立自动化测试套件'),
      makeSolution(2, 28, '机械系统替代：用 CI/CD 自动化替代人工质检'),
      makeSolution(3, 24, '中介物：引入代码审查工具'),
    ],
    excludedPrincipleNumbers: [31],
    path: 'rule',
    confidence: 0.8,
    clarificationRound: 0,
    maxClarificationRounds: 2,
    clarificationPrompt: null,
    clarificationReason: null,
    budgetState: 'within_budget',
    budgetReason: null,
    humanOverride: false,
    selectedSolutionIndex: null,
    targetKind: null,
    previewToken: null,
    diff: null,
    receipt: null,
    error: null,
    ...overrides,
  }
}

export const TRIZ_FULL_PERMISSIONS: readonly string[] = [
  'ai:trigger',
  'ai:confirm',
  'task:create',
  'risk:manage',
  'change_request:create',
  'project:view',
]

export function makeContext(overrides: Partial<ColleagueContext> = {}): ColleagueContext {
  return {
    contextType: 'project_space',
    currentProjectId: TRIZ_PROJECT_ID,
    pathname: `/next/projects/${TRIZ_PROJECT_ID}`,
    permissions: TRIZ_FULL_PERMISSIONS,
    isSuperAdmin: false,
    ...overrides,
  }
}
