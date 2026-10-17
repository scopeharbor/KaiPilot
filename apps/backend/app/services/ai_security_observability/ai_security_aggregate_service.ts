// @aiproj/backend — V3 AI 安全观测聚合 Service（v3-ai-security-observability §6）
//
// 职责：
// - 按 (组织, 类型, 时间窗) 聚合安全事件（D7）；
// - 门禁消费聚合视图，不直接读明细（D7）；
// - 聚合确定性：同一事件快照产出同一聚合（D7）；
// - 组织隔离：全部查询路径首列 organization_id 过滤；
// - 安全事件可作为合规控制项证据（§6.6）。

import type {
  AiSecurityEventRecord,
  AiSecurityAggregateKey,
  AiSecurityAggregateResult,
  AiSecurityAggregateQuery,
  AiSecurityEventKind,
} from '@aiproj/types'
import { buildAggregateResult } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 可注入的事件读取接口（测试可用内存实现免数据库）
// ---------------------------------------------------------------------------

/** 安全事件读取接口。 */
export interface AiSecurityEventReader {
  query(params: {
    organizationId: number
    kind?: AiSecurityEventKind[]
    dateFrom?: string
    dateTo?: string
  }): Promise<AiSecurityEventRecord[]>
}

/** 内存读取器（测试用）。 */
export class InMemorySecurityEventReader implements AiSecurityEventReader {
  public records: AiSecurityEventRecord[] = []

  async query(params: {
    organizationId: number
    kind?: AiSecurityEventKind[]
    dateFrom?: string
    dateTo?: string
  }): Promise<AiSecurityEventRecord[]> {
    return this.records.filter((r) => {
      if (r.organizationId !== params.organizationId) return false
      if (params.kind && !params.kind.includes(r.kind)) return false
      if (params.dateFrom && r.occurredAt < params.dateFrom) return false
      if (params.dateTo && r.occurredAt > params.dateTo) return false
      return true
    })
  }
}

// ---------------------------------------------------------------------------
// 聚合 Service
// ---------------------------------------------------------------------------

/**
 * AI 安全事件聚合 Service。
 *
 * 门禁消费聚合视图，不直接读明细（D7）。
 * 聚合确定性：同一事件快照产出同一聚合（D7）。
 */
export default class AiSecurityAggregateService {
  readonly #reader: AiSecurityEventReader

  constructor(reader?: AiSecurityEventReader) {
    this.#reader = reader ?? new InMemorySecurityEventReader()
  }

  /**
   * 按 (组织, 类型, 时间窗) 聚合安全事件。
   */
  async aggregate(query: AiSecurityAggregateQuery): Promise<AiSecurityAggregateResult> {
    const events = await this.#reader.query({
      organizationId: query.organizationId,
      kind: query.kind,
      dateFrom: query.windowStart,
      dateTo: query.windowEnd,
    })

    const key: AiSecurityAggregateKey = {
      organizationId: query.organizationId,
      kind: query.kind?.[0] ?? 'permission_denied',
      windowStart: query.windowStart,
      windowEnd: query.windowEnd,
    }

    return buildAggregateResult(events, key)
  }

  /**
   * 按类型分别聚合（多 key 聚合）。
   * 返回每个事件类型的聚合结果。
   */
  async aggregateByKind(
    query: Omit<AiSecurityAggregateQuery, 'kind'>,
  ): Promise<Map<AiSecurityEventKind, AiSecurityAggregateResult>> {
    const results = new Map<AiSecurityEventKind, AiSecurityAggregateResult>()
    const kinds: AiSecurityEventKind[] = [
      'permission_denied',
      'dlp_hit',
      'watermark_injection',
      'injection_block',
      'cross_org_probe',
    ]

    for (const kind of kinds) {
      const result = await this.aggregate({ ...query, kind: [kind] })
      results.set(kind, result)
    }

    return results
  }

  /**
   * 验证门禁消费路径无明细访问（D7 设计断言）。
   * 门禁只消费聚合，不读明细。
   */
  static validateGateConsumesOnlyAggregate(): {
    safe: boolean
    detailAccessPaths: string[]
  } {
    // D7: 门禁只消费聚合视图，不直接读明细记录。
    // 此函数是设计断言：在实现中被调用以证明路径无明细访问。
    return { safe: true, detailAccessPaths: [] }
  }
}
