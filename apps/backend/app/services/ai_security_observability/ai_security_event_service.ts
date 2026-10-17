// @aiproj/backend — V3 AI 安全观测事件记录 Service（v3-ai-security-observability §4-§5）
//
// 职责：
// - 接受安全事件并落盘（DB writer 可注入，测试免数据库）；
// - 事件写入失败时降级不阻断业务（D4）；
// - 降级本身被计数，不静默（D4）；
// - 不自动封禁账号、不自动关闭连接、不自动收紧权限（D5）；
// - 事件记录不含 prompt、模型输出、token、secret、被拒资源标识与注入原文（D1/D2）。
//
// 稳定错误码（供后续告警 change 消费）：
// - `SEC_EVT_ERR_WRITE_FAILED`：DB 写入抛错
// - `SEC_EVT_ERR_FORBIDDEN_CONTENT`：载荷命中禁止键

import type {
  AiSecurityEventRecord,
  AiSecurityEventKind,
  AiSecurityDegradationCounter,
} from '@aiproj/types'
import {
  validateEventRecordNoSensitivePayloads,
  validateEventNoResourceIdentifier,
  validateEventNoInjectionPayload,
  createEmptyDegradationCounter,
  incrementDegradationCounter,
} from '@aiproj/types'
import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// 错误码常量
// ---------------------------------------------------------------------------

export const SEC_EVT_ERR_WRITE_FAILED = 'SEC_EVT_ERR_WRITE_FAILED'
export const SEC_EVT_ERR_FORBIDDEN_CONTENT = 'SEC_EVT_ERR_FORBIDDEN_CONTENT'

// ---------------------------------------------------------------------------
// 可注入的 writer 接口（测试可用内存实现免数据库）
// ---------------------------------------------------------------------------

/** 安全事件 writer 接口。 */
export interface AiSecurityEventWriter {
  record(event: AiSecurityEventRecord): Promise<string>
}

/** 内存 writer（测试用）：收集记录，不落盘。 */
export class InMemorySecurityEventWriter implements AiSecurityEventWriter {
  public records: AiSecurityEventRecord[] = []
  async record(event: AiSecurityEventRecord): Promise<string> {
    this.records.push(event)
    return `memory:${this.records.length}`
  }
}

// ---------------------------------------------------------------------------
// 降级计数器接口
// ---------------------------------------------------------------------------

/** 降级计数器接口（进程内；供后续告警 change 消费）。 */
export interface AiSecurityDegradationCounterImpl {
  increment(kind: AiSecurityEventKind): void
  snapshot(): AiSecurityDegradationCounter
}

/** 内存降级计数器（测试用）。 */
export class InMemoryDegradationCounter implements AiSecurityDegradationCounterImpl {
  #counter = createEmptyDegradationCounter()

  increment(kind: AiSecurityEventKind): void {
    this.#counter = incrementDegradationCounter(this.#counter, kind, new Date().toISOString())
  }

  snapshot(): AiSecurityDegradationCounter {
    return { ...this.#counter, byKind: { ...this.#counter.byKind } }
  }
}

// ---------------------------------------------------------------------------
// Service 选项
// ---------------------------------------------------------------------------

export interface AiSecurityEventServiceOptions {
  writer?: AiSecurityEventWriter | null
  degradationCounter?: AiSecurityDegradationCounterImpl | null
}

// ---------------------------------------------------------------------------
// 主 Service
// ---------------------------------------------------------------------------

/**
 * AI 安全事件记录 Service。
 *
 * 失败隔离语义：`record()` 内部任何异常都不得向外抛出——
 * 写失败/校验失败均降级为 instrumentation 错误计数（D4），
 * 保证调用方（权限拒绝/DLP/水印/注入防护/跨组织拒绝）不受影响。
 *
 * D5 约束：事件路径只记录，不执行任何处置（不封禁/不关连接/不收紧权限）。
 */
export default class AiSecurityEventService {
  readonly #writer: AiSecurityEventWriter
  readonly #degradationCounter: AiSecurityDegradationCounterImpl

  constructor(options?: AiSecurityEventServiceOptions) {
    this.#writer = options?.writer ?? new InMemorySecurityEventWriter()
    this.#degradationCounter = options?.degradationCounter ?? new InMemoryDegradationCounter()
  }

  /**
   * 记录安全事件。
   *
   * 语义保证：
   * - 不改变任何防护的拦截行为（各防护自己的裁决）；
   * - 写入失败时降级不阻断业务（D4）；
   * - 降级本身被计数（D4）；
   * - 不自动处置（D5）。
   */
  async record(event: AiSecurityEventRecord): Promise<void> {
    // 禁存校验：确保事件不含敏感载荷
    const payloadCheck = validateEventRecordNoSensitivePayloads(event)
    if (!payloadCheck.safe) {
      this.#degradationCounter.increment(event.kind)
      // 拒绝写入含敏感载荷的事件
      return
    }

    // 不记资源标识校验（D1）
    const resourceCheck = validateEventNoResourceIdentifier(event)
    if (!resourceCheck.safe) {
      this.#degradationCounter.increment(event.kind)
      return
    }

    // 不记注入原文校验（D2）
    const injectionCheck = validateEventNoInjectionPayload(event)
    if (!injectionCheck.safe) {
      this.#degradationCounter.increment(event.kind)
      return
    }

    // 尝试写入（降级不阻断）
    try {
      await this.#writer.record(event)
    } catch {
      // D4：写入失败时降级，降级本身被计数
      this.#degradationCounter.increment(event.kind)
    }
  }

  /**
   * 获取降级计数器快照。
   */
  getDegradationSnapshot(): AiSecurityDegradationCounter {
    return this.#degradationCounter.snapshot()
  }

  /**
   * 创建事件记录的工厂方法。
   * 统一事件构造，确保所有必填字段都有值。
   */
  static createEvent(params: {
    kind: AiSecurityEventKind
    severity: AiSecurityEventRecord['severity']
    organizationId: number
    capabilitySurface: AiSecurityEventRecord['capabilitySurface']
    disposition: AiSecurityEventRecord['disposition']
    requestId?: string
    actorId?: number
    dlpRuleCategory?: string
    dlpSeverity?: string
    watermarkFormat?: string
    injectionCategories?: AiSecurityEventRecord['injectionCategories']
    injectionHitCount?: number
  }): AiSecurityEventRecord {
    return {
      eventId: `sec-evt-${params.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: params.kind,
      severity: params.severity,
      occurredAt: DateTime.now().toISO(),
      organizationId: params.organizationId,
      capabilitySurface: params.capabilitySurface,
      disposition: params.disposition,
      requestId: params.requestId,
      actorId: params.actorId,
      dlpRuleCategory: params.dlpRuleCategory,
      dlpSeverity: params.dlpSeverity,
      watermarkFormat: params.watermarkFormat,
      injectionCategories: params.injectionCategories,
      injectionHitCount: params.injectionHitCount,
    }
  }
}
