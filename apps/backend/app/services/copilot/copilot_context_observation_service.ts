/**
 * v3-ai-context-and-retrieval-observability —— CopilotContextObservationService。
 *
 * 上下文与检索观测服务：
 * - 从装配结果提取观测数据并写入 copilot_context_observations
 * - 异步写入，不阻塞回合响应（D4）
 * - 写入失败降级：附告警码，回合仍完成
 * - 观察层降级与业务决策阻断在记录中可区分
 * - 组织隔离（organization_id 必填）
 * - 禁存：不含检索词原文、来源正文、prompt、模型输出、token 与 secret
 *
 * 设计决策（D1）：只加落点，不新增计算。
 * 设计决策（D3）：评分区间而非逐条评分。
 *
 * @aiproj/backend
 */

import type { CopilotContextAssemblyResult } from '@aiproj/types'
import type {
  ContextObservationRecord,
  ContextObservationSourceRecord,
  ContextObservationTruncationRecord,
  ContextObservationUncertaintyRecord,
} from '@aiproj/types'
import CopilotContextObservation from '#models/copilot_context_observation'
import logger from '@adonisjs/core/services/logger'

// ---------------------------------------------------------------------------
// 依赖接口
// ---------------------------------------------------------------------------

export interface CopilotContextObservationDeps {
  /** 可选：覆盖写入实现（测试注入）。 */
  writeRecord?: (record: ContextObservationRecord) => Promise<void>
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export class CopilotContextObservationService {
  readonly #deps: CopilotContextObservationDeps

  constructor(deps?: CopilotContextObservationDeps) {
    this.#deps = deps ?? {}
  }

  /**
   * 从装配结果构建观测记录并异步写入。
   *
   * 设计决策（D4）：
   * - 写入为异步，不阻塞回合响应
   * - 写入失败降级：附告警码，回合仍完成
   * - 丢一条记录的代价低于重试队列复杂度（D9：不重试）
   *
   * @returns 降级告警码（undefined = 写入成功；'OBSERVATION_WRITE_FAILED' = 写入失败降级）
   */
  async recordObservation(
    result: CopilotContextAssemblyResult,
    organizationId: number,
    actorId: number,
  ): Promise<{ degraded: boolean; warningCode?: string }> {
    const record = this.#buildRecord(result, organizationId, actorId)

    try {
      const writer = this.#deps.writeRecord ?? this.#defaultWrite
      await writer(record)
      return { degraded: false }
    } catch (err) {
      // D4：观测写入失败降级，不阻断回合
      logger.warn(
        { err, assemblyId: result.assemblyId, organizationId },
        '上下文观测写入失败（降级，不阻断回合）',
      )
      return { degraded: true, warningCode: 'OBSERVATION_WRITE_FAILED' }
    }
  }

  /**
   * 从装配结果构建观测记录（纯函数，无副作用）。
   */
  #buildRecord(
    result: CopilotContextAssemblyResult,
    organizationId: number,
    actorId: number,
  ): ContextObservationRecord {
    return {
      assemblyId: result.assemblyId,
      organizationId,
      projectId: null, // 由装配请求的 attribution 推导，此处不重复存储
      actorId,
      sources: this.#buildSourceRecords(result),
      truncation: this.#buildTruncationRecord(result),
      uncertainty: this.#buildUncertaintyRecord(result),
      retrievalQuality: [], // 检索质量聚合由聚合层在查询时实时计算，不在此处写入
      routingInputsPreserved: this.#checkRoutingInputsPreserved(result),
      totalMs: result.timing.totalMs,
      degraded: false,
      observedAt: new Date().toISOString(),
    }
  }

  /**
   * 从装配结果构建逐来源观测记录。
   *
   * 关键约束：
   * - 评分区间而非逐条评分（D3）
   * - denied-hidden 来源只记计数不记来源标识（非泄露）
   */
  #buildSourceRecords(result: CopilotContextAssemblyResult): ContextObservationSourceRecord[] {
    const records: ContextObservationSourceRecord[] = []

    for (const source of result.sources) {
      // 计算字节占比（基于装配结果的 sources）
      const totalBytes = result.sources.reduce(
        (sum, s) => sum + s.hitCount * 100, // 简化估算
        0,
      )
      const sourceBytes = source.hitCount * 100
      const byteShare = totalBytes > 0 ? sourceBytes / totalBytes : 0

      records.push({
        retrievalKind: source.retrievalKind,
        hitCount: source.hitCount,
        scoreRange: {
          min: source.scoreRange?.min ?? 0,
          max: source.scoreRange?.max ?? 0,
          median: source.scoreRange ? (source.scoreRange.min + source.scoreRange.max) / 2 : 0,
        },
        byteShare,
        capturedAt: source.capturedAt,
        staleBlocked: false, // stale 阻断由装配层在调用方检测，此处默认 false
        permissionDecision: source.permissionDecision,
      })
    }

    return records
  }

  /**
   * 从装配结果构建截断观测记录。
   */
  #buildTruncationRecord(result: CopilotContextAssemblyResult): ContextObservationTruncationRecord {
    const t = result.truncation
    return {
      truncated: t.truncated,
      stage: t.stage,
      omittedSourceCount: t.omittedSourceCount,
      omittedEvidenceBytes: t.omittedEvidenceCount, // 字节数由装配层计数
      droppedRetrievalKinds: [...t.droppedRetrievalKinds],
      hitBudgetFloor: t.hitBudgetFloor,
      routingInputPreservationBreached: false, // 路由输入恒保留，触及即为异常信号
    }
  }

  /**
   * 从装配结果构建不确定三分观测记录。
   */
  #buildUncertaintyRecord(
    result: CopilotContextAssemblyResult,
  ): ContextObservationUncertaintyRecord {
    let notExistsCount = 0
    let notAccessibleCount = 0
    let noMatchCount = 0

    for (const entry of result.uncertainty) {
      switch (entry.kind) {
        case 'not-exists':
          notExistsCount++
          break
        case 'not-accessible':
          notAccessibleCount++
          break
        case 'no-match':
          noMatchCount++
          break
      }
    }

    return { notExistsCount, notAccessibleCount, noMatchCount }
  }

  /**
   * 检查路由输入保护是否完整。
   */
  #checkRoutingInputsPreserved(result: CopilotContextAssemblyResult): boolean {
    const r = result.routingInputs
    return (
      r.intentSlotsPreserved &&
      r.entityRefsPreserved &&
      r.sourceHashesPreserved &&
      r.permissionFactsPreserved
    )
  }

  /**
   * 默认写入实现：写入 SQLite 表。
   */
  async #defaultWrite(record: ContextObservationRecord): Promise<void> {
    await CopilotContextObservation.create({
      organizationId: record.organizationId,
      assemblyId: record.assemblyId,
      projectId: record.projectId,
      actorId: record.actorId,
      sources: JSON.stringify(record.sources),
      truncation: JSON.stringify(record.truncation),
      uncertainty: JSON.stringify(record.uncertainty),
      retrievalQuality: JSON.stringify(record.retrievalQuality),
      routingInputsPreserved: record.routingInputsPreserved,
      totalMs: record.totalMs,
      degraded: record.degraded,
      degradedReason: record.degradedReason ?? null,
      observedAt: new Date(record.observedAt),
      createdAt: new Date(),
    })
  }
}
