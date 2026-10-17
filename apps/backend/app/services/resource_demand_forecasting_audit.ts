/**
 * 资源需求预测审计帮助函数（v3-resource-demand-forecasting §4.4）。
 *
 * 低敏只读审计事件：记录 actor、organization、query shape、method、
 * metric keys、warning codes、freshness hash、source coverage 和 correlation metadata。
 *
 * 红线：
 *   - 不记录隐藏标签、隐藏计数、完整证据文本、prompts、模型输出、Authorization headers、
 *     API keys、tokens、secrets 或跨组织数据。
 *   - drill-down 审计需重新授权后记录，防止泄漏未授权 target。
 */
import type {
  ForecastWarningCode,
  ForecastMethod,
  ForecastGranularity,
  ForecastFreshness,
} from '@aiproj/types'
import type User from '#models/user'

// ─── 审计事件名字面量 ──────────────────────────────────────────────────────

export const ResourceDemandForecastingAuditEvent = {
  FORECAST_READ: 'ORG_FORECAST_READ',
  FORECAST_DRILL_DOWN: 'ORG_FORECAST_DRILL_DOWN',
  FORECAST_AI_ADVISORY: 'ORG_FORECAST_AI_ADVISORY',
} as const

// ─── 查询形状审计 ─────────────────────────────────────────────────────────

export interface ForecastAuditQueryShape {
  endpointFamily: string
  startDate: string
  endDate: string
  granularity: ForecastGranularity
  projectCount: number
  roleCount: number
  skillCount: number
  departmentCount: number
  loadStatusCount: number
  confidenceThreshold?: string
  method?: ForecastMethod
  topN?: number
  sortKey?: string
  page?: number
  perPage?: number
}

/**
 * 从原始查询参数构建低敏查询形状的审计摘要。
 * 只记录计数和元数据，不暴露具体 ID 或名称。
 */
export function buildForecastAuditQueryShape(
  endpointFamily: string,
  query: {
    startDate: string
    endDate: string
    granularity: ForecastGranularity
    projectIds?: (string | number)[]
    roles?: string[]
    skills?: string[]
    departments?: string[]
    loadStatuses?: string[]
    confidenceThreshold?: string
    method?: ForecastMethod
    topN?: number
    sort?: string
    page?: number
    perPage?: number
  },
): ForecastAuditQueryShape {
  return {
    endpointFamily,
    startDate: query.startDate,
    endDate: query.endDate,
    granularity: query.granularity,
    projectCount: query.projectIds?.length ?? 0,
    roleCount: query.roles?.length ?? 0,
    skillCount: query.skills?.length ?? 0,
    departmentCount: query.departments?.length ?? 0,
    loadStatusCount: query.loadStatuses?.length ?? 0,
    confidenceThreshold: query.confidenceThreshold,
    method: query.method as ForecastMethod | undefined,
    topN: query.topN,
    sortKey: query.sort,
    page: query.page,
    perPage: query.perPage,
  }
}

// ─── 审计负载构建器 ───────────────────────────────────────────────────────

export interface ForecastAuditPayload {
  actorId: number
  organizationId: number
  queryShape: ForecastAuditQueryShape
  method: ForecastMethod
  metricKeys: string[]
  warningCodes: ForecastWarningCode[]
  freshnessHash: string
  sourceCoverage: number
  /** 下钻目标类型（仅 drill-down 事件） */
  drillTargetType?: string
  /** 下钻目标 ID（哈希后，仅 drill-down 事件） */
  drillTargetHash?: string
  /** AI 模型/提供商标识（仅 AI advisory 事件） */
  aiModel?: string
  /** AI advisory 结果状态 */
  aiAdvisoryStatus?: string
  /** 相关性元数据（不包含隐藏标签） */
  correlation?: string
}

/**
 * 构建低敏预测读取审计负载。
 * 排除：prompts、模型输出文本、tokens、secrets、隐藏标签、完整证据文本。
 */
export function buildForecastReadAuditPayload(
  actor: User,
  organizationId: number,
  endpointFamily: string,
  query: ReturnType<typeof buildForecastAuditQueryShape> extends never
    ? never
    : Parameters<typeof buildForecastAuditQueryShape>[1],
  method: ForecastMethod,
  freshness: ForecastFreshness,
  warningCodes: ForecastWarningCode[],
): ForecastAuditPayload {
  return {
    actorId: actor.id,
    organizationId,
    queryShape: buildForecastAuditQueryShape(endpointFamily, query),
    method,
    metricKeys: [],
    warningCodes,
    freshnessHash: freshness.freshnessHash,
    sourceCoverage: freshness.sourceCoverage,
  }
}

/**
 * 构建低敏 drill-down 审计负载。
 * targetId 在落审计前需先哈希。
 */
export function buildForecastDrillDownAuditPayload(
  actor: User,
  organizationId: number,
  targetType: string,
  targetHash: string,
  freshnessHash: string,
): ForecastAuditPayload {
  return {
    actorId: actor.id,
    organizationId,
    queryShape: {} as ForecastAuditQueryShape,
    method: 'deterministic_bucket' as ForecastMethod,
    metricKeys: [],
    warningCodes: [],
    freshnessHash,
    sourceCoverage: 0,
    drillTargetType: targetType,
    drillTargetHash: targetHash,
  }
}

/**
 * 构建低敏 AI advisory 审计负载。
 * 排除 prompts、模型输出文本、tokens、secrets。
 */
export function buildForecastAiAdvisoryAuditPayload(
  actor: User,
  organizationId: number,
  aiModel: string | undefined,
  advisoryStatus: string,
  freshnessHash: string,
): ForecastAuditPayload {
  return {
    actorId: actor.id,
    organizationId,
    queryShape: {} as ForecastAuditQueryShape,
    method: 'deterministic_bucket' as ForecastMethod,
    metricKeys: [],
    warningCodes: [],
    freshnessHash,
    sourceCoverage: 0,
    aiModel: aiModel ?? 'unknown',
    aiAdvisoryStatus: advisoryStatus,
  }
}
