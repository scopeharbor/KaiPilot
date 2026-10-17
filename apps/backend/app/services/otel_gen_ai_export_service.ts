/**
 * v3-otel-genai-export-adapter —— OTel GenAI 导出适配器服务。
 *
 * 核心裁决（来自 design.md）：
 * - D1 默认关闭：未授权时零外发，dry-run 可完整验证
 * - D2 绝不导出 prompt/模型输出全文，包括 opt-in 属性
 * - D3 本地扩展一律走 aiproj.* 命名空间
 * - D4 导出是只读投影，账本仍是唯一事实来源
 * - D5 不内置默认外部端点
 * - D6 不做指标导出
 * - D7 按组织隔离，不跨组织混流
 * - D8 授权状态变更需要权限且写入审计
 */

import { inject } from '@adonisjs/core'
import type {
  OTelExportConfig,
  OTelExportAuthStatus,
  OTelExportTarget,
  OTelExportRecord,
  OTelExportBatchPayload,
  OTelExportResult,
  OTelExportAuditRecord,
  OTelExportAuditAction,
  UnifiedAiInvocationAttempt,
  AiTraceSpan,
  EvaluationScoreRecord,
} from '@aiproj/types'
import {
  mapLedgerAttemptToOtelAttributes,
  mapTraceSpanToOtelAttributes,
  mapEvaluationToOtelAttributes,
  detectNamespaceViolations,
  DEFAULT_OTEL_BATCH_WINDOW_MS,
  DEFAULT_OTEL_MAX_RETRIES,
  OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// §3.1 授权门：默认关闭，未授权时零外发
// ---------------------------------------------------------------------------

/**
 * 导出配置存储接口（可替换为 DB 实现）。
 * In-memory 实现用于测试与 dry-run。
 */
export interface OTelExportConfigStore {
  /** 获取组织的导出配置。 */
  getConfig(organizationId: number): OTelExportConfig | null
  /** 保存导出配置。 */
  saveConfig(config: OTelExportConfig): void
  /** 删除组织的导出配置。 */
  deleteConfig(organizationId: number): void
}

/**
 * In-memory 导出配置存储（测试用）。
 */
export class InMemoryExportConfigStore implements OTelExportConfigStore {
  private configs = new Map<number, OTelExportConfig>()

  getConfig(organizationId: number): OTelExportConfig | null {
    return this.configs.get(organizationId) ?? null
  }

  saveConfig(config: OTelExportConfig): void {
    this.configs.set(config.organizationId, config)
  }

  deleteConfig(organizationId: number): void {
    this.configs.delete(organizationId)
  }

  /** 测试辅助：清空所有配置。 */
  clear(): void {
    this.configs.clear()
  }
}

// ---------------------------------------------------------------------------
// §5.7 批量导出缓冲
// ---------------------------------------------------------------------------

/**
 * 批量导出缓冲区。
 * 单次 AI 调用不触发即时外发（§5.8），记录进入缓冲区等待批量窗口。
 */
export interface OTelExportBuffer {
  /** 添加记录到缓冲区。 */
  add(record: OTelExportRecord): void
  /** 获取并清空缓冲区中的记录。 */
  flush(): OTelExportRecord[]
  /** 获取缓冲区大小。 */
  size(): number
}

export class InMemoryExportBuffer implements OTelExportBuffer {
  private records: OTelExportRecord[] = []

  add(record: OTelExportRecord): void {
    this.records.push(record)
  }

  flush(): OTelExportRecord[] {
    const batch = [...this.records]
    this.records = []
    return batch
  }

  size(): number {
    return this.records.length
  }
}

// ---------------------------------------------------------------------------
// §5.5 有限次退避重试
// ---------------------------------------------------------------------------

/**
 * 重试策略：有限次退避后放弃并计数。
 */
export interface OTelExportRetryPolicy {
  /** 执行导出（含重试逻辑）。 */
  execute(fn: () => Promise<OTelExportResult>, maxRetries: number): Promise<OTelExportResult>
}

export class BoundedRetryPolicy implements OTelExportRetryPolicy {
  async execute(
    fn: () => Promise<OTelExportResult>,
    maxRetries: number,
  ): Promise<OTelExportResult> {
    let lastResult: OTelExportResult | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn()
        if (result.success) return result
        lastResult = result
      } catch (error) {
        lastResult = {
          success: false,
          recordCount: 0,
          retryCount: attempt,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      // 退避：指数退避，最后一次不等待
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 10_000)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    return (
      lastResult ?? {
        success: false,
        recordCount: 0,
        retryCount: maxRetries,
        error: 'No attempts executed',
      }
    )
  }
}

// ---------------------------------------------------------------------------
// §4.5 导出器接口（可替换为真实 OTLP 实现）
// ---------------------------------------------------------------------------

/**
 * 导出器接口：实际发送载荷的抽象。
 * 默认不内置任何外部端点（D5）。
 */
export interface OTelExporter {
  /** 发送批量载荷。 */
  send(payload: OTelExportBatchPayload): Promise<OTelExportResult>
}

/**
 * Console 导出器（dry-run / 测试用）。
 * 不发送任何网络请求。
 */
export class ConsoleExporter implements OTelExporter {
  private lastPayload: OTelExportBatchPayload | null = null

  async send(payload: OTelExportBatchPayload): Promise<OTelExportResult> {
    this.lastPayload = payload
    // console.log('[OTel DryRun]', JSON.stringify(payload, null, 2))
    return {
      success: true,
      recordCount: payload.recordCount,
      retryCount: 0,
    }
  }

  /** 测试辅助：获取最后发送的载荷。 */
  getLastPayload(): OTelExportBatchPayload | null {
    return this.lastPayload
  }
}

// ---------------------------------------------------------------------------
// §3.7 审计记录接口
// ---------------------------------------------------------------------------

/**
 * 审计记录存储接口。
 */
export interface OTelExportAuditStore {
  /** 写入审计记录。 */
  write(record: OTelExportAuditRecord): void
  /** 读取组织的审计记录。 */
  listByOrganization(organizationId: number): OTelExportAuditRecord[]
}

export class InMemoryAuditStore implements OTelExportAuditStore {
  private records: OTelExportAuditRecord[] = []

  write(record: OTelExportAuditRecord): void {
    this.records.push(record)
  }

  listByOrganization(organizationId: number): OTelExportAuditRecord[] {
    return this.records.filter((r) => r.organizationId === organizationId)
  }

  /** 测试辅助：清空所有记录。 */
  clear(): void {
    this.records = []
  }
}

// ---------------------------------------------------------------------------
// §3 主服务
// ---------------------------------------------------------------------------

/**
 * OTel GenAI 导出适配器服务。
 *
 * 职责：
 * 1. 授权门管理（默认关闭，未授权零外发）
 * 2. 导出目标配置（不内置默认端点）
 * 3. 映射账本/追踪/评测 → OTel GenAI 属性
 * 4. 禁导校验（prompt/输出全文/opt-in/secret）
 * 5. 组织隔离（不跨组织混流）
 * 6. 批量导出（不在调用路径上引入外部依赖）
 * 7. 有限次退避重试
 * 8. 只读投影（不回写/不改变记录状态）
 */
@inject()
export default class OTelGenAiExportService {
  constructor(
    private configStore: OTelExportConfigStore,
    private buffer: OTelExportBuffer,
    private exporter: OTelExporter,
    private retryPolicy: OTelExportRetryPolicy,
    private auditStore: OTelExportAuditStore,
  ) {}

  // ── §3.1 授权状态查询 ──

  /**
   * 获取组织的导出授权状态。
   * 未配置时返回 'unauthorized'。
   */
  getAuthStatus(organizationId: number): OTelExportAuthStatus {
    const config = this.configStore.getConfig(organizationId)
    return config?.authStatus ?? 'unauthorized'
  }

  // ── §3.3 dry-run 载荷 ──

  /**
   * 生成 dry-run 载荷（§3.3）。
   * 未授权时仍可构造完整载荷，只是不发出去。
   */
  generateDryRunPayload(
    organizationId: number,
    attempts: UnifiedAiInvocationAttempt[],
    spans: AiTraceSpan[],
    evaluations: EvaluationScoreRecord[],
  ): OTelExportBatchPayload {
    const records: OTelExportRecord[] = []

    // 账本 attempt → span records
    for (const attempt of attempts) {
      const attrs = mapLedgerAttemptToOtelAttributes(attempt)
      records.push({
        kind: 'span',
        attributes: attrs,
        timestamp: attempt.occurred_at,
        organizationId: attempt.aiproj_organization_id,
      })
    }

    // 追踪 span → span records
    for (const span of spans) {
      const attrs = mapTraceSpanToOtelAttributes(span)
      records.push({
        kind: 'span',
        attributes: attrs,
        timestamp: span.started_at,
        organizationId: span.organization_id,
      })
    }

    // 评测记录 → evaluation records
    for (const evalRecord of evaluations) {
      const attrs = mapEvaluationToOtelAttributes(evalRecord)
      records.push({
        kind: 'evaluation',
        attributes: attrs,
        timestamp: evalRecord.createdAt,
        organizationId: evalRecord.organizationId,
      })
    }

    return {
      organizationId,
      records,
      batchCreatedAt: new Date().toISOString(),
      recordCount: records.length,
    }
  }

  // ── §3.5 授权状态变更 ──

  /**
   * 变更授权状态（§3.5 + §3.7）。
   * 需要权限检查（由 Policy 层处理），写入审计。
   */
  async changeAuthStatus(
    organizationId: number,
    newStatus: OTelExportAuthStatus,
    actorUserId: number,
    target?: OTelExportTarget,
  ): Promise<OTelExportAuditRecord> {
    const existing = this.configStore.getConfig(organizationId)
    const previousStatus = existing?.authStatus ?? 'unauthorized'

    // 保存配置
    const now = new Date().toISOString()
    const config: OTelExportConfig = {
      organizationId,
      authStatus: newStatus,
      target: target ?? existing?.target,
      batchWindowMs: existing?.batchWindowMs ?? DEFAULT_OTEL_BATCH_WINDOW_MS,
      maxRetries: existing?.maxRetries ?? DEFAULT_OTEL_MAX_RETRIES,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.configStore.saveConfig(config)

    // 写入审计（§3.7）
    const action: OTelExportAuditAction =
      newStatus === 'authorized' ? 'export.auth.enabled' : 'export.auth.disabled'
    const auditRecord: OTelExportAuditRecord = {
      action,
      organizationId,
      actorUserId,
      previousStatus,
      newStatus,
      timestamp: now,
      target: config.target,
    }
    this.auditStore.write(auditRecord)

    return auditRecord
  }

  // ── §4.1 目标配置 ──

  /**
   * 配置导出目标（§4.1）。
   * 不内置默认外部端点——必须显式配置。
   */
  async configureTarget(
    organizationId: number,
    target: OTelExportTarget,
    actorUserId: number,
  ): Promise<void> {
    const existing = this.configStore.getConfig(organizationId)
    const now = new Date().toISOString()
    const config: OTelExportConfig = {
      organizationId,
      authStatus: existing?.authStatus ?? 'unauthorized',
      target,
      batchWindowMs: existing?.batchWindowMs ?? DEFAULT_OTEL_BATCH_WINDOW_MS,
      maxRetries: existing?.maxRetries ?? DEFAULT_OTEL_MAX_RETRIES,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.configStore.saveConfig(config)

    // 审计
    this.auditStore.write({
      action: 'export.target.updated',
      organizationId,
      actorUserId,
      previousStatus: config.authStatus,
      newStatus: config.authStatus,
      timestamp: now,
      target,
    })
  }

  // ── §5.1 只读投影 + §3.1 授权门 + §5.3 降级 ──

  /**
   * 执行批量导出。
   * - 未授权时零外发（§3.1）
   * - 无目标时不启动且给出原因（§4.3）
   * - 按组织隔离（§4.5）
   * - 导出失败不影响记录（§5.3）
   * - 有限次重试（§5.5）
   */
  async exportBatch(
    organizationId: number,
    records: OTelExportRecord[],
  ): Promise<OTelExportResult> {
    // §3.1 授权门：未授权时零外发
    const config = this.configStore.getConfig(organizationId)
    if (!config || config.authStatus !== 'authorized') {
      return {
        success: false,
        recordCount: 0,
        retryCount: 0,
        error: 'Export not authorized',
      }
    }

    // §4.3 未配置目标：不启动且给出原因
    if (!config.target) {
      return {
        success: false,
        recordCount: 0,
        retryCount: 0,
        error: 'No export target configured',
      }
    }

    // §4.5 组织隔离：过滤非本组织的记录
    const isolatedRecords = records.filter((r) => r.organizationId === organizationId)

    // §5.2 零域写校验：导出路径不写入任何域数据
    // 这里只读取配置和记录，不修改任何状态

    // §5.7 批量导出：构建载荷
    const payload: OTelExportBatchPayload = {
      organizationId,
      records: isolatedRecords,
      batchCreatedAt: new Date().toISOString(),
      recordCount: isolatedRecords.length,
    }

    // §5.5 有限次退避重试
    const maxRetries = config.maxRetries ?? DEFAULT_OTEL_MAX_RETRIES
    return this.retryPolicy.execute(() => this.exporter.send(payload), maxRetries)
  }

  // ── §5.8 缓冲 + 批量导出 ──

  /**
   * 添加记录到缓冲区（§5.8）。
   * 单次 AI 调用不触发即时外发。
   */
  bufferRecord(record: OTelExportRecord): void {
    this.buffer.add(record)
  }

  /**
   * 刷新缓冲区并导出。
   */
  async flushAndExport(organizationId: number): Promise<OTelExportResult> {
    const records = this.buffer.flush()
    if (records.length === 0) {
      return {
        success: true,
        recordCount: 0,
        retryCount: 0,
      }
    }
    return this.exportBatch(organizationId, records)
  }

  // ── §2.9 禁导校验 ──

  /**
   * 校验载荷是否包含禁导内容。
   * 返回违规列表（空 = 安全）。
   */
  validatePayload(attributes: Record<string, unknown>): string[] {
    const violations: string[] = []

    // 禁导内容属性检查
    for (const forbidden of OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES) {
      if (forbidden in attributes) {
        violations.push(`forbidden_content_attribute:${forbidden}`)
      }
    }

    // 命名空间检查
    const nsViolations = detectNamespaceViolations(attributes)
    violations.push(...nsViolations.map((v) => `namespace_violation:${v}`))

    return violations
  }

  // ── 辅助方法 ──

  /**
   * 映射账本 attempt 到 OTel 属性（委托给共享契约）。
   */
  mapLedgerAttempt(attempt: UnifiedAiInvocationAttempt): Record<string, unknown> {
    return mapLedgerAttemptToOtelAttributes(attempt)
  }

  /**
   * 映射追踪 span 到 OTel 属性（委托给共享契约）。
   */
  mapTraceSpan(span: AiTraceSpan): Record<string, unknown> {
    return mapTraceSpanToOtelAttributes(span)
  }

  /**
   * 映射评测记录到 OTel 属性（委托给共享契约）。
   */
  mapEvaluation(record: EvaluationScoreRecord): Record<string, unknown> {
    return mapEvaluationToOtelAttributes(record)
  }

  /**
   * 获取审计记录（§3.7）。
   */
  getAuditRecords(organizationId: number): OTelExportAuditRecord[] {
    return this.auditStore.listByOrganization(organizationId)
  }

  /**
   * 获取配置（§4.1）。
   */
  getConfig(organizationId: number): OTelExportConfig | null {
    return this.configStore.getConfig(organizationId)
  }
}
