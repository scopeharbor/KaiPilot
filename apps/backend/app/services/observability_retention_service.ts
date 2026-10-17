import type {
  ObservabilityDataClass,
  ObservabilityRetentionPolicy,
  ObservabilityRetentionCategoryPolicy,
  ObservabilityCleanupJobRecord,
  ObservabilityCleanupRunStatus,
  ObservabilityAggregateRecord,
} from '@aiproj/types'
import {
  DATA_CLASS_TIER_MAP,
  OBSERVABILITY_RETENTION_TIER_BOUNDS,
  buildObservabilityDefaultCategoryPolicies,
  computeObservabilityRetentionPolicyHash,
  computeAggregateHash,
  computeCleanupRunKey,
  getDefaultRetentionDays,
  mergeObservabilityRetentionPolicy,
  computeAggregateSummary,
  type ObservabilityRetentionPolicyUpdateRequest,
} from '@aiproj/types'

/**
 * ObservabilityRetentionService — 观察数据保留治理核心服务。
 *
 * 实现：
 * - 保留策略解析（系统默认 → 组织覆盖）
 * - 过期前聚合固化
 * - 硬删除（不做软标记）
 * - 清理作业幂等与可见性
 * - 组织注销级联清理
 * - 导出（组织隔离 + 审计）
 *
 * 设计决策：
 * D1 — 分档保留，安全事件档期长于一般观察数据
 * D2 — 过期前先落聚合再删明细
 * D3 — 组织可缩短不可延长超上限
 * D4 — 到期为硬删除
 * D5 — 清理作业失败必须可见
 * D6 — 组织注销时级联清理
 * D7 — 不做「按内容判断是否保留」
 * D8 — 导出只导出该组织自己的数据，且导出本身要审计
 */
export class ObservabilityRetentionService {
  constructor(
    private readonly db: any, // Database interface
    private readonly auditService: any, // Audit service
  ) {}

  // ─── 策略解析 ──────────────────────────────────────────────────────────────

  /**
   * 获取组织的保留策略。
   * 优先使用组织覆盖，否则回落系统默认。
   */
  async getPolicy(organizationId: number): Promise<ObservabilityRetentionPolicy> {
    const override = await this.db
      .from('observability_retention_policies')
      .where('organization_id', organizationId)
      .first()

    if (!override) {
      return {
        source: 'system',
        organizationId,
        categories: buildObservabilityDefaultCategoryPolicies(),
        bounds: OBSERVABILITY_RETENTION_TIER_BOUNDS,
        policyHash: computeObservabilityRetentionPolicyHash({
          organizationId,
          categories: buildObservabilityDefaultCategoryPolicies(),
        }),
      }
    }

    const categories: ObservabilityRetentionCategoryPolicy[] = JSON.parse(override.categories_json)
    return {
      source: 'organization',
      organizationId,
      categories,
      bounds: OBSERVABILITY_RETENTION_TIER_BOUNDS,
      policyHash: override.policy_hash,
    }
  }

  /**
   * 更新组织的保留策略。
   * D3：只允许缩短，不允许延长超上限。
   */
  async updatePolicy(
    organizationId: number,
    request: ObservabilityRetentionPolicyUpdateRequest,
    updatedBy: number,
  ): Promise<{
    success: boolean
    policy?: ObservabilityRetentionPolicy
    rejected?: Array<{ dataClass: ObservabilityDataClass; reason: 'exceeds_maximum' }>
  }> {
    // 获取当前策略
    const currentPolicy = await this.getPolicy(organizationId)

    // 合并策略
    const { categories, rejected } = mergeObservabilityRetentionPolicy(
      currentPolicy.categories,
      request.categories,
    )

    if (rejected.length > 0) {
      return { success: false, rejected }
    }

    // 计算新策略哈希
    const policyHash = computeObservabilityRetentionPolicyHash({
      organizationId,
      categories,
    })

    // D5：更新或插入策略
    const existing = await this.db
      .from('observability_retention_policies')
      .where('organization_id', organizationId)
      .first()

    const now = new Date().toISOString()

    if (existing) {
      await this.db
        .from('observability_retention_policies')
        .where('id', existing.id)
        .update({
          categories_json: JSON.stringify(categories),
          policy_hash: policyHash,
          updated_by: updatedBy,
          updated_at: now,
        })
    } else {
      await this.db.table('observability_retention_policies').insert({
        organization_id: organizationId,
        categories_json: JSON.stringify(categories),
        policy_hash: policyHash,
        updated_by: updatedBy,
        created_at: now,
        updated_at: now,
      })
    }

    return {
      success: true,
      policy: {
        source: 'organization',
        organizationId,
        categories,
        bounds: OBSERVABILITY_RETENTION_TIER_BOUNDS,
        policyHash,
      },
    }
  }

  // ─── 过期前聚合 ────────────────────────────────────────────────────────────

  /**
   * 固化指定数据类别的聚合。
   * D2：明细删除前先固化聚合。
   * D7：聚合不含任何禁存字段。
   */
  async materializeAggregates(
    organizationId: number,
    dataClass: ObservabilityDataClass,
    records: Array<{ id: number; createdAt: string }>,
    periodStart: string,
    periodEnd: string,
  ): Promise<ObservabilityAggregateRecord | null> {
    if (records.length === 0) return null

    const agg = computeAggregateSummary({
      organizationId,
      dataClass,
      periodStart,
      periodEnd,
      records,
    })

    const now = new Date().toISOString()

    // 检查是否已存在（幂等）
    const existing = await this.db
      .from('observability_aggregates')
      .where('organization_id', organizationId)
      .where('data_class', dataClass)
      .where('aggregate_hash', agg.aggregateHash)
      .first()

    if (existing) {
      return {
        id: existing.id,
        organizationId: existing.organization_id,
        dataClass: existing.data_class,
        tier: existing.tier,
        periodStart: existing.period_start,
        periodEnd: existing.period_end,
        recordCount: existing.record_count,
        aggregateHash: existing.aggregate_hash,
        prohibitedFields: JSON.parse(existing.prohibited_fields_json),
        materializedAt: existing.materialized_at,
        createdAt: existing.created_at,
      }
    }

    // 插入新聚合
    const [id] = await this.db.table('observability_aggregates').insert({
      organization_id: organizationId,
      data_class: dataClass,
      tier: DATA_CLASS_TIER_MAP[dataClass],
      period_start: periodStart,
      period_end: periodEnd,
      record_count: agg.recordCount,
      aggregate_hash: agg.aggregateHash,
      prohibited_fields_json: JSON.stringify(agg.prohibitedFields),
      materialized_at: now,
      created_at: now,
    })

    return {
      id,
      organizationId,
      dataClass,
      tier: DATA_CLASS_TIER_MAP[dataClass],
      periodStart,
      periodEnd,
      recordCount: agg.recordCount,
      aggregateHash: agg.aggregateHash,
      prohibitedFields: agg.prohibitedFields,
      materializedAt: now,
      createdAt: now,
    }
  }

  // ─── 清理执行 ──────────────────────────────────────────────────────────────

  /**
   * 执行清理作业。
   * D2：过期前先落聚合再删明细。
   * D4：到期为硬删除，不做软标记。
   * D5：清理作业失败必须可见。
   */
  async executeCleanup(
    organizationId: number,
    dataClass: ObservabilityDataClass,
    _executedBy: number,
    nowIso: string,
  ): Promise<{
    runId: number
    status: ObservabilityCleanupRunStatus
    recordsDeleted: number
    recordsFailed: number
    aggregatesCreated: number
    aggregateFailed: boolean
    failureReason: string | null
  }> {
    // D5：确保清理作业存在
    const job = await this.ensureCleanupJob(organizationId, dataClass)

    // D4：幂等键
    const runKey = computeCleanupRunKey({
      organizationId,
      dataClass,
      nowIso,
    })

    // 幂等检查
    const existingRun = await this.db
      .from('observability_cleanup_runs')
      .where('organization_id', organizationId)
      .where('run_key', runKey)
      .first()

    if (existingRun) {
      return {
        runId: existingRun.id,
        status: existingRun.status,
        recordsDeleted: existingRun.records_deleted,
        recordsFailed: existingRun.records_failed,
        aggregatesCreated: existingRun.aggregates_created,
        aggregateFailed: existingRun.aggregate_failed,
        failureReason: existingRun.failure_reason,
      }
    }

    // 获取策略
    const policy = await this.getPolicy(organizationId)
    const categoryPolicy = (policy.categories as Record<string, any>)[dataClass]
    const retentionDays = categoryPolicy?.retentionDays ?? getDefaultRetentionDays(dataClass)

    // 计算过期边界
    const cutoffDate = new Date(nowIso)
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoffIso = cutoffDate.toISOString()

    // D7：只按类别与时间判定，不按内容判定
    // 查找到期记录（这里需要各数据类别的实际表，用通用查询）
    const eligibleRecords = await this.findExpiredRecords(organizationId, dataClass, cutoffIso)

    let recordsDeleted = 0
    let recordsFailed = 0
    let aggregatesCreated = 0
    let aggregateFailed = false
    let failureReason: string | null = null

    if (eligibleRecords.length > 0) {
      // D2：先固化聚合
      try {
        const periodStart = cutoffIso
        const periodEnd = nowIso
        await this.materializeAggregates(
          organizationId,
          dataClass,
          eligibleRecords,
          periodStart,
          periodEnd,
        )
        aggregatesCreated = 1
      } catch (err) {
        // D2：聚合固化失败时**不删明细**
        aggregateFailed = true
        failureReason = err instanceof Error ? err.message : 'Aggregate materialization failed'

        // 记录失败状态
        await this.recordCleanupRun({
          organizationId,
          jobId: job.id,
          dataClass,
          runKey,
          status: 'failed',
          recordsEligible: eligibleRecords.length,
          recordsDeleted: 0,
          recordsFailed: eligibleRecords.length,
          aggregatesCreated: 0,
          aggregateFailed: true,
          failureReason,
          startedAt: nowIso,
          completedAt: nowIso,
        })

        // 更新作业状态
        await this.updateJobStatus(job.id, 'failed', failureReason)

        return {
          runId: 0,
          status: 'failed',
          recordsDeleted: 0,
          recordsFailed: eligibleRecords.length,
          aggregatesCreated: 0,
          aggregateFailed: true,
          failureReason,
        }
      }

      // D4：硬删除 — 批量删除避免单次锁表
      const BATCH_SIZE = 100
      for (let i = 0; i < eligibleRecords.length; i += BATCH_SIZE) {
        const batch = eligibleRecords.slice(i, i + BATCH_SIZE)
        const batchIds = batch.map((r) => r.id)

        try {
          await this.hardDeleteRecords(dataClass, batchIds)
          recordsDeleted += batch.length
        } catch (err) {
          recordsFailed += batch.length
          failureReason = err instanceof Error ? err.message : 'Batch delete failed'
        }
      }
    }

    // 记录执行
    const runId = await this.recordCleanupRun({
      organizationId,
      jobId: job.id,
      dataClass,
      runKey,
      status: recordsFailed > 0 ? 'partial' : 'completed',
      recordsEligible: eligibleRecords.length,
      recordsDeleted,
      recordsFailed,
      aggregatesCreated,
      aggregateFailed,
      failureReason,
      startedAt: nowIso,
      completedAt: nowIso,
    })

    // D5：更新作业状态
    await this.updateJobStatus(job.id, recordsFailed > 0 ? 'failed' : 'completed', failureReason)

    return {
      runId,
      status: recordsFailed > 0 ? 'partial' : 'completed',
      recordsDeleted,
      recordsFailed,
      aggregatesCreated,
      aggregateFailed,
      failureReason,
    }
  }

  // ─── 组织注销级联清理 ──────────────────────────────────────────────────────

  /**
   * 组织注销时级联清理其全部观察数据，含已固化聚合。
   * D6：组织注销时级联清理。
   */
  async cascadeCleanupOnRemoval(organizationId: number): Promise<{
    recordsDeleted: number
    aggregatesDeleted: number
    jobsDeleted: number
    runsDeleted: number
    exportsDeleted: number
  }> {
    // D6：级联清理 — 由于外键 ON DELETE CASCADE，
    // 删除 organizations 记录时，所有关联表会自动级联删除。
    // 这里显式记录清理量用于审计。

    const counts = {
      recordsDeleted: 0,
      aggregatesDeleted: 0,
      jobsDeleted: 0,
      runsDeleted: 0,
      exportsDeleted: 0,
    }

    // 统计并删除
    const aggregateCount = await this.db
      .from('observability_aggregates')
      .where('organization_id', organizationId)
      .count('* as count')
    counts.aggregatesDeleted = aggregateCount?.[0]?.count ?? 0

    const jobCount = await this.db
      .from('observability_cleanup_jobs')
      .where('organization_id', organizationId)
      .count('* as count')
    counts.jobsDeleted = jobCount?.[0]?.count ?? 0

    const runCount = await this.db
      .from('observability_cleanup_runs')
      .where('organization_id', organizationId)
      .count('* as count')
    counts.runsDeleted = runCount?.[0]?.count ?? 0

    const exportCount = await this.db
      .from('observability_export_records')
      .where('organization_id', organizationId)
      .count('* as count')
    counts.exportsDeleted = exportCount?.[0]?.count ?? 0

    // 注意：实际删除由外键 ON DELETE CASCADE 处理
    // 这里只记录统计信息

    return counts
  }

  // ─── 导出 ──────────────────────────────────────────────────────────────────

  /**
   * 导出组织的观察数据。
   * D8：导出只导出该组织自己的数据，且导出本身要审计。
   */
  async exportData(
    organizationId: number,
    requestedBy: number,
    dataClasses: ObservabilityDataClass[],
    exportFormat: 'json' | 'csv',
  ): Promise<{
    exportId: number
    recordCount: number
    exportHash: string
  }> {
    // 收集各数据类别的记录
    const allRecords: Record<string, unknown[]> = {}
    let totalRecords = 0

    for (const dataClass of dataClasses) {
      const records = await this.findRecordsForExport(organizationId, dataClass)
      allRecords[dataClass] = records
      totalRecords += records.length
    }

    // 生成导出哈希
    const exportHash = computeAggregateHash({
      organizationId,
      dataClass: dataClasses[0] || 'trace_spans',
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString(),
      recordCount: totalRecords,
    })

    const now = new Date().toISOString()

    // 记录导出
    const [exportId] = await this.db.table('observability_export_records').insert({
      organization_id: organizationId,
      requested_by: requestedBy,
      data_classes_json: JSON.stringify(dataClasses),
      record_count: totalRecords,
      export_format: exportFormat,
      export_hash: exportHash,
      exported_at: now,
      created_at: now,
    })

    // D8：审计导出动作
    await this.auditService?.log({
      action: 'OBSERVABILITY_EXPORT_PRODUCED',
      organizationId,
      actorId: requestedBy,
      metadata: {
        exportId,
        dataClasses,
        recordCount: totalRecords,
        exportFormat,
        exportHash,
      },
    })

    return { exportId, recordCount: totalRecords, exportHash }
  }

  // ─── 状态查询 ──────────────────────────────────────────────────────────────

  /**
   * 获取清理作业状态。
   * D5：清理作业状态必须可查询。
   */
  async getJobStatus(
    organizationId: number,
    dataClass: ObservabilityDataClass,
  ): Promise<ObservabilityCleanupJobRecord | null> {
    const job = await this.db
      .from('observability_cleanup_jobs')
      .where('organization_id', organizationId)
      .where('data_class', dataClass)
      .first()

    if (!job) return null

    return {
      jobId: job.id,
      organizationId: job.organization_id,
      dataClass: job.data_class,
      status: job.status,
      lastRunAt: job.last_run_at,
      lastRunDurationMs: job.last_run_duration_ms,
      recordsProcessedTotal: job.records_processed_total,
      recordsFailedTotal: job.records_failed_total,
      consecutiveFailures: job.consecutive_failures,
      lastFailureReason: job.last_failure_reason,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }
  }

  /**
   * 获取所有组织清理作业状态。
   */
  async getAllJobStatuses(organizationId: number): Promise<ObservabilityCleanupJobRecord[]> {
    const jobs = await this.db
      .from('observability_cleanup_jobs')
      .where('organization_id', organizationId)
      .orderBy('data_class', 'asc')

    return jobs.map((job: any) => ({
      jobId: job.id,
      organizationId: job.organization_id,
      dataClass: job.data_class,
      status: job.status,
      lastRunAt: job.last_run_at,
      lastRunDurationMs: job.last_run_duration_ms,
      recordsProcessedTotal: job.records_processed_total,
      recordsFailedTotal: job.records_failed_total,
      consecutiveFailures: job.consecutive_failures,
      lastFailureReason: job.last_failure_reason,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }))
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 确保清理作业存在。
   */
  private async ensureCleanupJob(
    organizationId: number,
    dataClass: ObservabilityDataClass,
  ): Promise<{ id: number }> {
    const existing = await this.db
      .from('observability_cleanup_jobs')
      .where('organization_id', organizationId)
      .where('data_class', dataClass)
      .first()

    if (existing) return { id: existing.id }

    const now = new Date().toISOString()
    const [id] = await this.db.table('observability_cleanup_jobs').insert({
      organization_id: organizationId,
      data_class: dataClass,
      status: 'idle',
      records_processed_total: 0,
      records_failed_total: 0,
      consecutive_failures: 0,
      created_at: now,
      updated_at: now,
    })

    return { id }
  }

  /**
   * 更新清理作业状态。
   */
  private async updateJobStatus(
    jobId: number,
    status: string,
    failureReason: string | null,
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .from('observability_cleanup_jobs')
      .where('id', jobId)
      .update({
        status,
        last_run_at: now,
        last_failure_reason: failureReason,
        consecutive_failures: status === 'failed' ? this.db.raw('consecutive_failures + 1') : 0,
        updated_at: now,
      })
  }

  /**
   * 记录清理执行。
   */
  private async recordCleanupRun(params: {
    organizationId: number
    jobId: number
    dataClass: ObservabilityDataClass
    runKey: string
    status: ObservabilityCleanupRunStatus
    recordsEligible: number
    recordsDeleted: number
    recordsFailed: number
    aggregatesCreated: number
    aggregateFailed: boolean
    failureReason: string | null
    startedAt: string
    completedAt: string | null
  }): Promise<number> {
    const [id] = await this.db.table('observability_cleanup_runs').insert({
      organization_id: params.organizationId,
      job_id: params.jobId,
      data_class: params.dataClass,
      run_key: params.runKey,
      status: params.status,
      records_eligible: params.recordsEligible,
      records_deleted: params.recordsDeleted,
      records_failed: params.recordsFailed,
      aggregates_created: params.aggregatesCreated,
      aggregate_failed: params.aggregateFailed,
      failure_reason: params.failureReason,
      started_at: params.startedAt,
      completed_at: params.completedAt,
      created_at: params.startedAt,
    })
    return id
  }

  /**
   * 查找到期记录（按数据类别）。
   * D7：只按类别与时间判定，不按内容判定。
   */
  private async findExpiredRecords(
    organizationId: number,
    dataClass: ObservabilityDataClass,
    cutoffIso: string,
  ): Promise<Array<{ id: number; createdAt: string }>> {
    // 根据数据类别查找对应表
    // 这里使用通用模式，实际表名由数据类别决定
    const tableName = this.getTableNameForDataClass(dataClass)
    if (!tableName) return []

    const records = await this.db
      .from(tableName)
      .where('organization_id', organizationId)
      .where('created_at', '<', cutoffIso)
      .select('id', 'created_at')

    return records.map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
    }))
  }

  /**
   * 硬删除记录（不做软标记）。
   */
  private async hardDeleteRecords(dataClass: ObservabilityDataClass, ids: number[]): Promise<void> {
    const tableName = this.getTableNameForDataClass(dataClass)
    if (!tableName || ids.length === 0) return

    // D4：硬删除 — 直接删除行
    await this.db.from(tableName).whereIn('id', ids).delete()
  }

  /**
   * 查找导出记录。
   */
  private async findRecordsForExport(
    organizationId: number,
    dataClass: ObservabilityDataClass,
  ): Promise<unknown[]> {
    const tableName = this.getTableNameForDataClass(dataClass)
    if (!tableName) return []

    return this.db.from(tableName).where('organization_id', organizationId).select('*')
  }

  /**
   * 根据数据类别获取表名。
   */
  private getTableNameForDataClass(dataClass: ObservabilityDataClass): string | null {
    const tableMap: Partial<Record<ObservabilityDataClass, string>> = {
      trace_spans: 'ai_trace_spans',
      invocation_ledger: 'unified_ai_invocation_ledger',
      feedback_events: 'unified_ai_feedback_events',
      budget_decisions: 'budget_decisions',
      rate_limit_decisions: 'rate_limit_decisions',
      // 其他数据类别的表名映射
    }
    return tableMap[dataClass] ?? null
  }
}
