import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import { formatSignalCode } from '@aiproj/types'

/**
 * 被动雷达信号前端数据层（v3-triz-contradiction-copilot W6 · tasks 6.1/6.2）。
 *
 * 契约来源 = 后端 `app/services/project_signal/signal_contracts.ts` +
 * `ProjectSignalService.toDTO`（W3 已入库，HEAD 1f8cd73e）。**两处承载**
 * （角色首页建议队列 / 项目空间信号卡）消费本文件这一份契约与同一套裁剪字段，
 * 不各写一套读接口（design D10）。
 *
 * 硬边界（design D9 ③，落在类型层）：证据只到团队 / 项目聚合粒度——字段形状里
 * 没有任何个人维度度量、个人排名或个人告警键；本模块也不得引入打卡 / 考勤 /
 * 独立工时日志类数据源。
 *
 * 只读约定：`list` 零写入；`dismiss` / `adopt` 写的是雷达自有信号表（业务表零写入），
 * 且必须由用户显式点击触发（RL-01：本模块不提供任何自动流转入口）。
 */

/** 四类硬信号闭集（与后端 `PROJECT_SIGNAL_TYPES` 同源；不含 S 曲线 / 进化法则类）。 */
export const PROJECT_SIGNAL_TYPES = [
  'progress_deviation',
  'risk_surge',
  'resource_overload',
  'milestone_slip',
] as const

export type ProjectSignalType = (typeof PROJECT_SIGNAL_TYPES)[number]

/** 中文标签（后端 `PROJECT_SIGNAL_TYPE_LABELS` 的镜像，服务端亦返回 `signalTypeLabel`）。 */
export const PROJECT_SIGNAL_TYPE_LABELS: Record<ProjectSignalType, string> = {
  progress_deviation: '进度偏差',
  risk_surge: '风险/缺陷突变',
  resource_overload: '资源负载过载',
  milestone_slip: '里程碑滑移',
}

export type ProjectSignalTier = 'low' | 'high'
export type ProjectSignalStatus = 'open' | 'dismissed' | 'adopted' | 'expired'
export type ProjectSignalSeverity = 'info' | 'warning' | 'critical'

export type SignalHitCondition =
  | 'spi_delayed'
  | 'active_risk_surge'
  | 'high_risk_surge'
  | 'severe_defect_surge'
  | 'resource_overload'
  | 'milestone_slip'

export const SIGNAL_HIT_CONDITION_LABELS: Record<SignalHitCondition, string> = {
  spi_delayed: '排程绩效低于既有阈值',
  active_risk_surge: '活跃登记项环比上升',
  high_risk_surge: '高危登记项环比上升',
  severe_defect_surge: '严重缺陷新增环比上升',
  resource_overload: '团队分配比例超出参考线',
  milestone_slip: '相对基线累计滑移',
}

/** 证据观测窗（闭区间；`previous*` 为可比基期）。 */
export interface ProjectSignalEvidenceWindow {
  from: string
  to: string
  previousFrom: string
  previousTo: string
  days: number
}

/** 低敏证据载荷（数值 / 阈值 / 基期 / 覆盖周期数 / 实体 ID，无长文本、无个人维度）。 */
export interface ProjectSignalEvidence {
  metric: string
  window: ProjectSignalEvidenceWindow
  readings: Record<string, unknown>
  thresholds: Record<string, number>
  coveredCycles: number
  hitConditions: SignalHitCondition[]
  compositeTypes: ProjectSignalType[]
  entityRefs: {
    risks?: number[]
    issues?: number[]
    milestones?: number[]
  }
  truncated: boolean
  dataInsufficient?: boolean
  insufficientReason?: string | null
}

/** 高置信四条件中单条的命中情况。 */
export interface ProjectSignalTierCondition {
  hit: boolean
  detail: string
}

/** 分层理由（四项命中情况 + 观测窗与评估时刻）。 */
export interface ProjectSignalTierReasons {
  amplitude?: ProjectSignalTierCondition
  consecutive?: ProjectSignalTierCondition
  completeness?: ProjectSignalTierCondition
  composite?: ProjectSignalTierCondition
  window?: string
  evaluatedAt?: string
  compositeTypes?: ProjectSignalType[]
  previousTier?: ProjectSignalTier | null
}

/** 信号对外 DTO（字段名与后端 `ProjectSignalDTO` 逐字对齐）。 */
export interface ProjectSignal {
  id: number
  organizationId: number
  projectId: number
  projectName?: string | null
  /** 所属项目编号（列表接口附带；缺省回退 `PROJ-{projectId}`） */
  projectCode?: string
  signalType: ProjectSignalType
  signalTypeLabel: string
  confidenceTier: ProjectSignalTier
  tierReasons: ProjectSignalTierReasons
  severity: ProjectSignalSeverity
  /** 无领域权限时为 null（裁剪，不泄露受限数据内容） */
  evidence: ProjectSignalEvidence | null
  evidenceRedacted: boolean
  /** 裁剪原因（如 `missing_permission:risk:view`） */
  redactedReason: string | null
  /** 读取该类型证据所需领域权限（前端做中性说明，不做安全判定） */
  requiredPermission: string
  idempotencyKey: string
  observationWindow: string
  expiresAt: string | null
  status: ProjectSignalStatus
  previousStatus: ProjectSignalStatus | null
  statusChangedBy: number | null
  statusChangedAt: string | null
  adoptedAnalysisId: number | null
  createdBy: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ProjectSignalListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface ProjectSignalListResponse {
  data: ProjectSignal[]
  meta: ProjectSignalListMeta
}

export interface ProjectSignalListFilters {
  status?: ProjectSignalStatus | 'all'
  confidenceTier?: ProjectSignalTier
  signalType?: ProjectSignalType
  /** 按信号 ID 精确查（组织级端点；信号编号定位用） */
  signalId?: number
  page?: number
  perPage?: number
}

export interface ProjectSignalAdoptInput {
  /** 关联既有分析记录（缺省表示先标记采纳、后补关联）。 */
  analysisId?: number | null
  note?: string | null
}

function qs(filters: ProjectSignalListFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.confidenceTier) params.set('confidenceTier', filters.confidenceTier)
  if (filters.signalType) params.set('signalType', filters.signalType)
  if (filters.signalId) params.set('signalId', String(filters.signalId))
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  return params.size ? `?${params.toString()}` : ''
}

/**
 * 信号端点（前缀 `/projects/:projectId/signals`，统一 `{ data, meta }` 信封）。
 *
 * - `list`：只读列表，支持 `status` / `confidenceTier` / `signalType` / 分页；
 * - `dismiss`：忽略（`open → dismissed`，同观测窗不复发由后端保证）；
 * - `adopt`：采纳（`open → adopted`，可携带 `analysisId` 形成「信号 ↔ 分析」双向可追溯）。
 */
export const projectSignalsApi = {
  list: (projectId: number, filters: ProjectSignalListFilters = {}) =>
    apiFetchEnvelope<ProjectSignalListResponse>(`/projects/${projectId}/signals${qs(filters)}`),

  dismiss: (projectId: number, signalId: number, note?: string | null) =>
    apiFetch<ProjectSignal>(`/projects/${projectId}/signals/${signalId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
    }),

  adopt: (projectId: number, signalId: number, input: ProjectSignalAdoptInput = {}) =>
    apiFetch<ProjectSignal>(`/projects/${projectId}/signals/${signalId}/adopt`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

/**
 * 组织级信号只读端点客户端（v3-triz-copilot-followups · tasks 6.1）。
 * 调用 `GET /api/v1/organizations/:organizationId/signals`。
 */
export const organizationSignalsApi = {
  list: (organizationId: number, filters: ProjectSignalListFilters = {}) =>
    apiFetchEnvelope<ProjectSignalListResponse>(
      `/organizations/${organizationId}/signals${qs(filters)}`,
    ),
}

export const projectSignalKeys = {
  all: ['project-signals'] as const,
  lists: () => [...projectSignalKeys.all, 'list'] as const,
  list: (projectId: number, filters: ProjectSignalListFilters) =>
    [...projectSignalKeys.lists(), projectId, filters] as const,
}

export const organizationSignalKeys = {
  all: ['organization-signals'] as const,
  lists: () => [...organizationSignalKeys.all, 'list'] as const,
  list: (organizationId: number, filters: ProjectSignalListFilters) =>
    [...organizationSignalKeys.lists(), organizationId, filters] as const,
}

/** 角色首页建议队列的过滤口径：待处理（open）+ 低置信（低置信只进队列，单次组织级端点拉取全量）。 */
export const ROLE_SIGNAL_QUEUE_FILTERS: ProjectSignalListFilters = {
  status: 'open',
  confidenceTier: 'low',
  perPage: 50,
}

/** 项目空间信号卡的过滤口径：待处理（open）+ 高置信（低置信不进项目空间卡）。 */
export const PROJECT_SIGNAL_CARD_FILTERS: ProjectSignalListFilters = {
  status: 'open',
  confidenceTier: 'high',
  perPage: 5,
}

/** 信号编号 `PROJ-8#S10`（项目编号#S信号ID，可复制后在 AI 同事里直接求解）。 */
export function signalCodeOf(
  signal: Pick<ProjectSignal, 'id' | 'projectId' | 'projectCode'>,
): string {
  return formatSignalCode({ id: signal.projectId, code: signal.projectCode ?? null }, signal.id)
}

/** 识别 409 Conflict 冲突异常（用于 adopt 回写幂等容错）。 */
export function isConflictError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { status?: unknown; code?: unknown }
    return (
      candidate.status === 409 ||
      candidate.code === 'CONFLICT' ||
      candidate.code === 'ConflictException' ||
      candidate.code === 'SCHEDULE_STALE'
    )
  }
  return false
}
