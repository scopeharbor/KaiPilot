/**
 * 被动雷达信号测试夹具（v3-triz-contradiction-copilot W6 · tasks 6.1/6.2）。
 *
 * 形状逐字对齐后端 `ProjectSignalDTO`（`apps/backend/app/services/project_signal/
 * project_signal_service.ts` 的 `toDTO`）与 `signal_contracts.ts` 的证据契约：
 * 读数只到团队 / 项目聚合口径，实体引用只含风险 / 缺陷 / 里程碑 ID，
 * **不含**任何个人维度度量、个人排名或打卡 / 考勤 / 工时日志类字段（design D9）。
 */
import type {
  ProjectSignal,
  ProjectSignalEvidence,
  ProjectSignalListMeta,
} from '@/lib/api/project-signals'
import { jsonResponse, makeProject } from './chart-gallery-network'

export function makeSignalEvidence(
  overrides: Partial<ProjectSignalEvidence> = {},
): ProjectSignalEvidence {
  return {
    metric: 'schedule_performance_index',
    window: {
      from: '2026-08-25',
      to: '2026-08-31',
      previousFrom: '2026-08-18',
      previousTo: '2026-08-24',
      days: 7,
    },
    readings: {
      metric: 'schedule_performance_index',
      spi: 0.91,
      spiPrevious: 0.93,
      sv: -3.5,
      svPrevious: -2.1,
      scheduleStatus: 'delayed',
      hasBaseline: true,
    },
    thresholds: { spiDelayed: 0.95, spiSignificant: 0.85, svNegative: 0 },
    coveredCycles: 2,
    hitConditions: ['spi_delayed'],
    compositeTypes: ['progress_deviation'],
    entityRefs: { risks: [7, 8], issues: [21], milestones: [] },
    truncated: false,
    dataInsufficient: false,
    insufficientReason: null,
    ...overrides,
  }
}

/** 中性低置信信号（默认 = 进度偏差 / 项目 101）。 */
export function makeSignal(overrides: Partial<ProjectSignal> = {}): ProjectSignal {
  return {
    id: 12,
    organizationId: 1,
    projectId: 101,
    signalType: 'progress_deviation',
    signalTypeLabel: '进度偏差',
    confidenceTier: 'low',
    tierReasons: {
      amplitude: { hit: true, detail: 'spiDelta=0.04' },
      consecutive: { hit: false, detail: 'consecutiveCycles=1' },
      completeness: { hit: true, detail: 'fieldsComplete=true' },
      composite: { hit: false, detail: 'compositeTypes=1' },
      window: '2026-08-25..2026-08-31',
      evaluatedAt: '2026-09-01T00:00:00.000Z',
      compositeTypes: ['progress_deviation'],
      previousTier: null,
    },
    severity: 'warning',
    evidence: makeSignalEvidence(),
    evidenceRedacted: false,
    redactedReason: null,
    requiredPermission: 'task:view',
    idempotencyKey: '101|progress_deviation|2026-08-25..2026-08-31',
    observationWindow: '2026-08-25..2026-08-31',
    expiresAt: '2026-09-14T23:59:59.000Z',
    status: 'open',
    previousStatus: null,
    statusChangedBy: null,
    statusChangedAt: null,
    adoptedAnalysisId: null,
    createdBy: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 高置信信号（四条件全命中），默认 = 风险 / 缺陷突变 / 项目 101。 */
export function makeHighSignal(overrides: Partial<ProjectSignal> = {}): ProjectSignal {
  return makeSignal({
    id: 201,
    signalType: 'risk_surge',
    signalTypeLabel: '风险/缺陷突变',
    confidenceTier: 'high',
    severity: 'critical',
    requiredPermission: 'risk:view',
    tierReasons: {
      amplitude: { hit: true, detail: 'activeRiskGrowthRatio=0.8' },
      consecutive: { hit: true, detail: 'consecutiveCycles=2' },
      completeness: { hit: true, detail: 'fieldsComplete=true' },
      composite: { hit: true, detail: 'compositeTypes=2' },
      window: '2026-08-25..2026-08-31',
      evaluatedAt: '2026-09-01T00:00:00.000Z',
      compositeTypes: ['risk_surge', 'progress_deviation'],
      previousTier: null,
    },
    observationWindow: '2026-08-25..2026-08-31',
    idempotencyKey: '101|risk_surge|2026-08-25..2026-08-31',
    evidence: makeSignalEvidence({
      metric: 'risk_register_surge',
      readings: {
        metric: 'risk_register_surge',
        activeRisksCurrent: 14,
        activeRisksPrevious: 9,
        activeRiskGrowthRatio: 0.56,
        newHighRisksCurrent: 5,
        newSevereDefectsCurrent: 3,
        coveredCycles: 2,
      },
      thresholds: {
        riskGrowthRatio: 0.5,
        riskAbsoluteMin: 3,
        highRiskGrowthRatio: 0.5,
        highRiskAbsoluteMin: 2,
      },
      hitConditions: ['active_risk_surge', 'high_risk_surge'],
      compositeTypes: ['risk_surge', 'progress_deviation'],
      entityRefs: { risks: [7, 8, 9], issues: [21, 22], milestones: [] },
    }),
    ...overrides,
  })
}

export function makeMeta(total: number, perPage = 20): ProjectSignalListMeta {
  return { total, page: 1, perPage, totalPages: total === 0 ? 0 : Math.ceil(total / perPage) }
}

/** 统一 `{ data, meta }` 信封（与后端 `ProjectSignalsController.index` 同形）。 */
export function signalsEnvelope(signals: ProjectSignal[]) {
  return { data: signals, meta: makeMeta(signals.length) }
}

export interface SignalRouterOptions {
  /** 组织内可见项目（默认两个：101 开项核心引擎 / 102 星图迁移）。 */
  projects?: Array<Record<string, unknown>>
  /** 项目总数（用于覆盖范围披露断言；缺省 = projects.length）。 */
  projectsTotal?: number
  /** 各项目的信号读数（键 = 项目 ID）。 */
  signalsByProject?: Record<number, ProjectSignal[]>
  /** 组织级信号列表（若提供则优先，缺省汇总 signalsByProject）。 */
  organizationSignals?: ProjectSignal[]
  /** 故意忽略 `confidenceTier` 查询参数（验证前端分层守卫）。 */
  ignoreTierFilter?: boolean
  /** 项目详情 / 信号列表的非 2xx 桩。 */
  projectDetailStatus?: number
  signalsStatus?: number
  signalsError?: { code: string; message: string }
  adoptStatus?: number
  adoptError?: { code: string; message: string }
}

function filterByQuery(signals: ProjectSignal[], path: string, ignoreTier: boolean) {
  const query = new URLSearchParams(path.split('?')[1] ?? '')
  const tier = query.get('confidenceTier')
  const status = query.get('status')
  return signals.filter((signal) => {
    if (tier && !ignoreTier && signal.confidenceTier !== tier) return false
    if (status && status !== 'all' && signal.status !== status) return false
    return true
  })
}

/**
 * 被动雷达信号伪后端路由（配 `installFetchRouter` 使用）。
 *
 * 覆盖：项目列表、项目详情、`/projects/:id/signals`（按查询参数分层过滤）、
 * `/organizations/:id/signals`（组织级端点）、
 * 看板列、风险摘要与变更请求（项目空间挂载用到的旁路端点）。
 * 未匹配的请求返回 null → `installFetchRouter` 以 404 兜底，漏配会立刻暴露。
 */
export function makeSignalRouter(options: SignalRouterOptions = {}) {
  const projects = options.projects ?? [
    { id: 101, name: '开项核心引擎' },
    { id: 102, name: '星图迁移' },
  ]

  return (path: string, method: string) => {
    if (method === 'GET' && (path === '/projects' || path.startsWith('/projects?'))) {
      const total = options.projectsTotal ?? projects.length
      return jsonResponse(200, {
        data: projects,
        meta: { total, page: 1, perPage: Number(projects.length), totalPages: 1 },
      })
    }

    const detailMatch = /^\/projects\/(\d+)$/.exec(path)
    if (method === 'GET' && detailMatch) {
      if (options.projectDetailStatus) {
        return jsonResponse(options.projectDetailStatus, {
          error: {
            code: options.projectDetailStatus === 404 ? 'RESOURCE_NOT_FOUND' : 'INTERNAL_ERROR',
            message: options.projectDetailStatus === 404 ? '项目不存在' : '项目加载失败',
          },
        })
      }
      return jsonResponse(200, {
        data: makeProject({ id: Number(detailMatch[1]), name: '开项核心引擎' }),
      })
    }

    const orgSignalsMatch = /^\/organizations\/(\d+)\/signals/.exec(path)
    if (method === 'GET' && orgSignalsMatch) {
      if (options.signalsStatus) {
        return jsonResponse(options.signalsStatus, {
          error: options.signalsError ?? {
            code: 'INTERNAL_ERROR',
            message: '信号服务暂不可用',
          },
        })
      }
      const rows =
        options.organizationSignals ?? Object.values(options.signalsByProject ?? {}).flat()
      return jsonResponse(
        200,
        signalsEnvelope(filterByQuery(rows, path, options.ignoreTierFilter === true)),
      )
    }

    const adoptMatch = /^\/projects\/(\d+)\/signals\/(\d+)\/adopt$/.exec(path)
    if (method === 'POST' && adoptMatch) {
      if (options.adoptStatus) {
        return jsonResponse(options.adoptStatus, {
          error: options.adoptError ?? {
            code: options.adoptStatus === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
            message: options.adoptStatus === 409 ? '信号已被采纳' : '采纳失败',
          },
        })
      }
      return jsonResponse(200, {
        data: makeSignal({
          id: Number(adoptMatch[2]),
          projectId: Number(adoptMatch[1]),
          status: 'adopted',
        }),
      })
    }

    const signalsMatch = /^\/projects\/(\d+)\/signals/.exec(path)
    if (signalsMatch) {
      if (options.signalsStatus) {
        return jsonResponse(options.signalsStatus, {
          error: options.signalsError ?? {
            code: 'INTERNAL_ERROR',
            message: '信号服务暂不可用',
          },
        })
      }
      const rows = options.signalsByProject?.[Number(signalsMatch[1])] ?? []
      return jsonResponse(
        200,
        signalsEnvelope(filterByQuery(rows, path, options.ignoreTierFilter === true)),
      )
    }

    if (method === 'GET' && /^\/projects\/\d+\/kanban/.test(path)) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 25, totalPages: 0 },
      })
    }
    if (method === 'GET' && /^\/projects\/\d+\/risks\/workbench\/summary/.test(path)) {
      return jsonResponse(200, { data: { highRiskCount: 0, criticalRiskCount: 0, total: 0 } })
    }
    if (method === 'GET' && /^\/projects\/\d+\/change-requests/.test(path)) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      })
    }
    // AI 工具只读执行通道（「进入矛盾求解」跳转可能触发的唯一写方法请求）：
    // 返回成功信封，便于断言「跳转零落库」时把该通道与写通道区分开。
    if (path === '/ai/tools/execute') {
      return jsonResponse(200, {
        data: { ok: true },
        meta: { toolName: 'analyze_project_contradiction', status: 'SUCCESS', durationMs: 4 },
      })
    }
    return null
  }
}
