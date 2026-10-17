/**
 * streaming-observability —— 流式传输运行可观测性类型（V2.5 W7）。
 *
 * 定义 transport-health metrics、低敏诊断事件、健康摘要、阈值和 reasonCode。
 * 零运行时依赖，纯 TypeScript 类型。
 *
 * 本模块不替代 Compiler 业务 observability/cost ledger。
 * 只管理 transport 运行健康，不复制 Stage/Artifact/成本或预算字段。
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs / compiler-spec。
 */

// ── 基础枚举 ───────────────────────────────────────────────────

/** 流式传输领域。 */
export type StreamKind = 'ai-draft' | 'compiler'

/** 传输协议类型。 */
export type Transport = 'sse' | 'realtime' | 'rest'

/** 流式生命周期操作。 */
export type Operation =
  | 'session_open'
  | 'session_close'
  | 'first_event'
  | 'semantic_progress'
  | 'heartbeat'
  | 'disconnect'
  | 'resume'
  | 'replay_request'
  | 'replay_success'
  | 'replay_failure'
  | 'replay_reset'
  | 'subscribe'
  | 'unsubscribe'
  | 'publish'
  | 'publish_success'
  | 'publish_failure'
  | 'snapshot'
  | 'rest_fallback'
  | 'rest_replay'
  | 'terminal_delivery'
  | 'cleanup'
  | 'cleanup_timeout'
  | 'reset'
  | 'cursor_expired'

/** 操作结果。 */
export type Outcome =
  'success' | 'failure' | 'timeout' | 'stale' | 'rejected' | 'expired' | 'cancelled' | 'skipped'

/** 生命周期阶段分类（用于低基数聚合）。 */
export type PhaseClass = 'connection' | 'progress' | 'recovery' | 'terminal' | 'cleanup'

/** 健康状态评级。 */
export type StreamingHealthState = 'healthy' | 'warning' | 'critical' | 'unknown'

// ── 稳定 Reason Code ───────────────────────────────────────────

/**
 * 稳定的 reason code 枚举。
 * 每个 code 都有对应的 runbook 条目。
 * 禁止添加临时或 debug 用途的 code。
 */
export const REASON_CODES = [
  // ── 连接与首事件 ──
  'CONNECT_SUCCESS',
  'CONNECT_FAILURE',
  'FIRST_EVENT_OK',
  'FIRST_EVENT_SLOW',
  'FIRST_EVENT_TIMEOUT',
  // ── Heartbeat ──
  'HEARTBEAT_OK',
  'HEARTBEAT_MISSED',
  'HEARTBEAT_STALE',
  // ── 断开与恢复 ──
  'DISCONNECT_CLEAN',
  'DISCONNECT_ABNORMAL',
  'RESUME_OK',
  'RESUME_CURSOR_EXPIRED',
  'RESUME_FAILED',
  'REPLAY_OK',
  'REPLAY_FAILED',
  'REPLAY_GAP_RECOVERED',
  'REPLAY_RESET_REQUIRED',
  // ── 发布 ──
  'PUBLISH_OK',
  'PUBLISH_FAILED',
  'REST_REPLAY_OK',
  'REST_REPLAY_FAILED',
  // ── 订阅 ──
  'SUBSCRIBE_OK',
  'SUBSCRIBE_REJECTED',
  'SUBSCRIBE_AUTH_FAILED',
  // ── 终态 ──
  'TERMINAL_DELIVERED',
  'TERMINAL_MISSING',
  // ── 清理 ──
  'CLEANUP_OK',
  'CLEANUP_TIMEOUT',
  'ORPHAN_SESSION',
  // ── 限流 ──
  'RATE_LIMITED',
  'BACKPRESSURE',
  // ── 内部 ──
  'INTERNAL_ERROR',
  'INSTRUMENTATION_ERROR',
  'RESET_REASON_PROCESS_RESTART',
  'RESET_REASON_RETENTION_EXPIRED',
  'RESET_REASON_UNSUPPORTED_VERSION',
] as const

export type ReasonCode = (typeof REASON_CODES)[number]

// ── 指标 Label Allowlist ───────────────────────────────────────

/** 指标 label——只允许稳定低基数维度。 */
export interface MetricLabels {
  streamKind: StreamKind
  transport: Transport
  outcome: Outcome
  reasonCode?: ReasonCode
  phaseClass?: PhaseClass
}

/** 禁止作为 metric label 的字段名集合。 */
export const FORBIDDEN_METRIC_LABELS = [
  'organizationId',
  'organization_id',
  'userId',
  'user_id',
  'projectId',
  'project_id',
  'draftId',
  'draft_id',
  'runId',
  'run_id',
  'eventId',
  'event_id',
  'stageId',
  'stage_id',
  'prompt',
  'model',
  'token',
  'secret',
  'authorization',
  'apiKey',
  'api_key',
] as const

/** 允许的 label 键名。 */
export const ALLOWED_METRIC_LABEL_KEYS = [
  'streamKind',
  'transport',
  'outcome',
  'reasonCode',
  'phaseClass',
] as const

/** 固定窗口内最大 series 数量。 */
export const MAX_SERIES_PER_WINDOW = 500

// ── Metrics Port 接口 ──────────────────────────────────────────

/**
 * Transport-health metrics port。
 * 生产路径使用默认 in-memory + logger 实现。
 * 测试使用 deterministic test sink。
 * no-op sink 用于完全关闭观测。
 */
export interface MetricsPort {
  /** 递增计数器。 */
  incrementCounter(name: string, labels: MetricLabels, value?: number): void
  /** 记录持续时间（毫秒）。 */
  recordDuration(name: string, labels: MetricLabels, durationMs: number): void
  /** 设置当前 gauge 快照值。 */
  setGauge(name: string, labels: MetricLabels, value: number): void
  /** 记录一次结构化诊断事件。 */
  recordDiagnostic(event: DiagnosticEvent): void
  /** 获取当前所有指标的快照（用于测试/摘要）。 */
  snapshot(): MetricsSnapshot
  /** 重置所有指标（用于测试/窗口滚动）。 */
  reset(): void
  /** 当前 sink 的类型标识。 */
  sinkType: 'memory' | 'noop' | 'test' | 'log'
}

/** 指标快照——用于测试和健康摘要聚合。 */
export interface MetricsSnapshot {
  counters: Record<string, number>
  durations: Record<string, number[]>
  gauges: Record<string, number>
  diagnostics: DiagnosticEvent[]
  seriesCount: number
}

// ── 诊断事件 Schema ────────────────────────────────────────────

/**
 * 低敏诊断事件。
 * 只包含 timestamp、streamKind、transport、correlationId、
 * operation、outcome、reasonCode、duration bucket 和安全计数。
 * 不包含 prompt、raw output、artifact、token、组织身份、
 * 完整 stack trace 或业务正文。
 */
export interface DiagnosticEvent {
  /** 事件发生时间。 */
  timestamp: string
  /** 流式传输领域。 */
  streamKind: StreamKind
  /** 传输协议。 */
  transport: Transport
  /** 关联 ID——用于关联同一生命周期内的事件链。 */
  correlationId: string
  /** 操作类型。 */
  operation: Operation
  /** 操作结果。 */
  outcome: Outcome
  /** 稳定 reason code。 */
  reasonCode: ReasonCode
  /** 持续时间桶（毫秒），可选。 */
  durationBucketMs?: number
  /** 安全计数（如重试次数、重连次数），可选。 */
  safeCount?: number
  /** 错误代码（稳定枚举值），可选。禁止自由文本。 */
  errorCode?: string
}

/** Diagnostic serializer allowlist——可序列化的字段路径。 */
export const DIAGNOSTIC_SERIALIZE_ALLOWLIST = [
  'timestamp',
  'streamKind',
  'transport',
  'correlationId',
  'operation',
  'outcome',
  'reasonCode',
  'durationBucketMs',
  'safeCount',
  'errorCode',
] as const

/** 禁止出现在诊断事件中的字段。 */
export const DIAGNOSTIC_FORBIDDEN_FIELDS = [
  'prompt',
  'rawOutput',
  'raw_output',
  'artifact',
  'token',
  'secret',
  'authorization',
  'apiKey',
  'api_key',
  'stackTrace',
  'stack_trace',
  'organizationId',
  'organization_id',
  'userId',
  'user_id',
  'projectId',
  'project_id',
  'draftId',
  'draft_id',
  'runId',
  'run_id',
  'eventId',
  'event_id',
  'stageId',
  'stage_id',
  'body',
  'content',
  'message',
] as const

// ── 健康摘要 ────────────────────────────────────────────────────

/** 领域级健康摘要。 */
export interface StreamHealthSummary {
  /** 流式传输领域。 */
  streamKind: StreamKind
  /** 聚合窗口开始时间。 */
  windowStartedAt: string
  /** 数据新鲜度（最后事件时间）。 */
  lastEventAt: string | null
  /** 进程重置原因（如为空表示正常窗口滚动）。 */
  resetReason: ReasonCode | null
  /** 当前健康状态。 */
  healthState: StreamingHealthState
  /** 首事件延迟统计（毫秒）。 */
  firstEventLatencyMs: LatencyStats | null
  /** Heartbeat gap 统计（毫秒）。 */
  heartbeatGapMs: LatencyStats | null
  /** Replay 请求数/成功数/失败数。 */
  replaySummary: ReplaySummary | null
  /** Reset 计数。 */
  resetCount: number
  /** 终态投递计数。 */
  terminalDeliveryCount: number
  /** 活跃会话数。 */
  activeSessionCount: number
  /** 清理结果计数。 */
  cleanupSummary: CleanupSummary | null
  /** 活跃的告警状态列表。 */
  alerts: AlertState[]
}

// ── 全局健康概览 ────────────────────────────────────────────────

/** 全局流式传输健康概览。 */
export interface GlobalStreamHealth {
  /** 概览生成时间。 */
  generatedAt: string
  /** 综合健康状态（最差原则）。 */
  overallState: StreamingHealthState
}

export interface LatencyStats {
  avgMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  sampleCount: number
}

export interface ReplaySummary {
  requestCount: number
  successCount: number
  failureCount: number
  resetCount: number
}

export interface CleanupSummary {
  totalCount: number
  timeoutCount: number
  orphanCount: number
}

/** 聚合健康摘要（包含两个领域）。 */
export interface HealthSummary {
  summaries: StreamHealthSummary[]
  aggregatedAt: string
}

// ── 阈值 ───────────────────────────────────────────────────────

export type ThresholdLevel = 'warning' | 'critical'

export interface ThresholdConfig {
  /** 阈值唯一标识。 */
  id: string
  /** 适用的流式传输领域。 */
  streamKind: StreamKind
  /** 阈值级别。 */
  level: ThresholdLevel
  /** 指标路径（如 firstEventLatencyMs.avgMs）。 */
  metricPath: string
  /** 比较运算符。 */
  operator: 'gt' | 'gte' | 'lt' | 'lte'
  /** 阈值数值。 */
  value: number
  /** 单位说明。 */
  unit: string
  /** 来源说明/基线引用。 */
  source: string
  /** 关联的 runbook 条目引用。 */
  runbookRef: string
}

export interface ThresholdEvaluation {
  thresholdId: string
  level: ThresholdLevel
  streamKind: StreamKind
  metricPath: string
  actualValue: number
  thresholdValue: number
  passed: boolean
  reasonCode: ReasonCode
  runbookRef: string
}

export interface ThresholdResult {
  streamKind: StreamKind
  evaluations: ThresholdEvaluation[]
  overallState: StreamingHealthState
}

// ── 告警状态 ───────────────────────────────────────────────────

export interface AlertState {
  reasonCode: ReasonCode
  level: 'warning' | 'critical'
  message: string
  firstTriggeredAt: string
  lastTriggeredAt: string
  count: number
  runbookRef: string
}

// ── PhaseClass 辅助 ────────────────────────────────────────────

/** 将 Operation 映射到 PhaseClass。 */
export function operationToPhaseClass(op: Operation): PhaseClass {
  switch (op) {
    case 'session_open':
    case 'disconnect':
    case 'resume':
    case 'subscribe':
    case 'unsubscribe':
      return 'connection'
    case 'first_event':
    case 'semantic_progress':
    case 'heartbeat':
    case 'publish':
    case 'publish_success':
    case 'publish_failure':
    case 'snapshot':
      return 'progress'
    case 'replay_request':
    case 'replay_success':
    case 'replay_failure':
    case 'replay_reset':
    case 'rest_fallback':
    case 'rest_replay':
    case 'reset':
    case 'cursor_expired':
      return 'recovery'
    case 'terminal_delivery':
      return 'terminal'
    case 'cleanup':
    case 'cleanup_timeout':
    case 'session_close':
      return 'cleanup'
  }
}

// ── 持续时间桶辅助 ────────────────────────────────────────────

const DURATION_BUCKETS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000]

/** 将毫秒值映射到最近的标准持续时间桶。 */
export function toDurationBucketMs(ms: number): number {
  for (const bucket of DURATION_BUCKETS) {
    if (ms <= bucket) return bucket
  }
  return 120000
}

// ── 默认阈值配置 ───────────────────────────────────────────────

/**
 * 默认阈值配置（AI Draft 与 Compiler 分开）。
 * 基于 fixture/soak 记录的本机基线。
 * 可在部署时通过配置覆盖。
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig[] = [
  // ── AI Draft ──
  {
    id: 'ai-draft-first-event-warning',
    streamKind: 'ai-draft',
    level: 'warning',
    metricPath: 'firstEventLatencyMs.p95Ms',
    operator: 'gt',
    value: 5000,
    unit: 'ms',
    source: 'baseline: ai-draft soak avg p95 < 3000ms',
    runbookRef: '#slow-first-event',
  },
  {
    id: 'ai-draft-first-event-critical',
    streamKind: 'ai-draft',
    level: 'critical',
    metricPath: 'firstEventLatencyMs.p95Ms',
    operator: 'gt',
    value: 15000,
    unit: 'ms',
    source: 'baseline: ai-draft soak avg p95 < 3000ms, critical at 5x',
    runbookRef: '#slow-first-event',
  },
  {
    id: 'ai-draft-heartbeat-gap-warning',
    streamKind: 'ai-draft',
    level: 'warning',
    metricPath: 'heartbeatGapMs.p95Ms',
    operator: 'gt',
    value: 30000,
    unit: 'ms',
    source: 'default heartbeat interval 15s, warning at 2x',
    runbookRef: '#heartbeat-loss',
  },
  {
    id: 'ai-draft-heartbeat-gap-critical',
    streamKind: 'ai-draft',
    level: 'critical',
    metricPath: 'heartbeatGapMs.maxMs',
    operator: 'gt',
    value: 60000,
    unit: 'ms',
    source: 'default heartbeat interval 15s, critical at 4x',
    runbookRef: '#heartbeat-loss',
  },
  // ── Compiler ──
  {
    id: 'compiler-first-event-warning',
    streamKind: 'compiler',
    level: 'warning',
    metricPath: 'firstEventLatencyMs.p95Ms',
    operator: 'gt',
    value: 10000,
    unit: 'ms',
    source: 'baseline: compiler soak avg p95 < 5000ms',
    runbookRef: '#slow-first-event',
  },
  {
    id: 'compiler-first-event-critical',
    streamKind: 'compiler',
    level: 'critical',
    metricPath: 'firstEventLatencyMs.p95Ms',
    operator: 'gt',
    value: 30000,
    unit: 'ms',
    source: 'baseline: compiler soak avg p95 < 5000ms, critical at 6x',
    runbookRef: '#slow-first-event',
  },
  {
    id: 'compiler-replay-failure-warning',
    streamKind: 'compiler',
    level: 'warning',
    metricPath: 'replaySummary.failureRate',
    operator: 'gte',
    value: 0.1,
    unit: 'rate (0-1)',
    source: 'baseline: compiler replay failure rate ~0% with retention',
    runbookRef: '#replay-failure',
  },
  {
    id: 'compiler-replay-failure-critical',
    streamKind: 'compiler',
    level: 'critical',
    metricPath: 'replaySummary.failureRate',
    operator: 'gte',
    value: 0.3,
    unit: 'rate (0-1)',
    source: 'baseline: compiler replay failure rate ~0% with retention',
    runbookRef: '#replay-failure',
  },
]
