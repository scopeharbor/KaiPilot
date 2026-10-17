/**
 * v3-four-layer-knowledge-system —— CollectL4Service（D7）。
 *
 * L4 自动采集与隐私保护——写入边界去标识化（移除/哈希项目名/公司名/人名），
 * 保留 dataId+时间戳，聚合优先返回，原始明细 90 天保留后清理。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import AuditService, { AuditEvent } from '#services/audit_service'
import KnowledgeItem from '#models/knowledge_item'
import { LAYER_METADATA } from '@aiproj/types'
import crypto from 'node:crypto'

/** L4 采集事件——原始事件在写入边界被去标识化。 */
export interface L4CollectEvent {
  /** 数据源唯一 ID。 */
  dataId: string
  /** 事件类型（如 project.created / task.status_changed）。 */
  eventType: string
  /** 原始负载（在去标识化前会被清理）。 */
  payload: Record<string, unknown>
  /** 事件发生时间（ISO 8601）。 */
  timestamp: string
  /** 关联组织 ID。 */
  organizationId: number
}

/** 去标识化配置。 */
const DEIDENTIFY_FIELDS = ['projectName', 'companyName', 'personName', 'email', 'phone'] as const

const DEIDENTIFY_NESTED_FIELDS = ['name', 'assignee', 'owner', 'creator', 'reporter'] as const

@inject()
export default class CollectL4Service {
  constructor(private readonly audit: AuditService) {}

  /**
   * 采集 L4 事件——写入边界去标识化后落库。
   *
   * 约束（D7）：
   * - 写入前移除/哈希 projectName / companyName / personName / email / phone
   * - 保留 dataId + eventType + timestamp + organizationId
   * - 默认 retentionDays = 90
   *
   * @param organizationId 调用者组织 ID
   * @param event 原始采集事件
   */
  async collect(organizationId: number, event: L4CollectEvent): Promise<KnowledgeItem> {
    const sanitizedPayload = this.deidentify(event.payload)

    const item = new KnowledgeItem()
    item.organizationId = organizationId
    item.layer = 'L4'
    item.layerMeta = LAYER_METADATA['L4']
    item.title = `L4 事件: ${event.eventType} (${event.dataId})`
    item.content = {
      dataId: event.dataId,
      eventType: event.eventType,
      payload: sanitizedPayload,
      collectedAt: event.timestamp,
    }
    item.status = 'active' // L4 自动采集直接 active
    item.domain = '产品数据'
    item.purpose = '匿名聚合'
    item.complexity = null
    item.provenance = {
      sources: [
        {
          layer: 'L4',
          sourceId: event.dataId,
          title: `L4 事件: ${event.eventType}`,
          retrievedAt: event.timestamp,
        },
      ],
      reviewHistory: [],
    }
    item.reviewHistory = []
    item.isSynthetic = false
    item.syntheticMethod = null
    item.createdBy = 0 // L4 自动采集，系统用户（ID=0）
    item.updatedBy = null
    item.lastReferencedAt = null
    item.retentionDays = 90 // D7：默认 90 天保留

    await item.save()

    await this.audit.log({
      event: AuditEvent.KNOWLEDGE_ITEM_COLLECTED,
      organizationId,
      userId: null,
      metadata: {
        description: `L4 采集事件: ${event.eventType}`,
        knowledgeItemId: item.id,
        dataId: event.dataId,
        eventType: event.eventType,
      },
    })

    return item
  }

  /**
   * 清理超期 L4 原始明细（保留聚合结果）。
   * 返回清理条数。
   */
  async cleanupExpired(organizationId: number): Promise<number> {
    const cutoff = DateTime.now().minus({ days: 90 }).toSQLDate()!
    const expired = await KnowledgeItem.forOrganization(organizationId)
      .where('layer', 'L4')
      .where('created_at', '<', cutoff)
      .delete()

    return Number(expired)
  }

  /**
   * 去标识化——递归清理 payload 中的敏感字段。
   * 顶层字段直接移除；嵌套对象递归清理；数组逐项清理。
   */
  private deidentify(payload: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(payload)) {
      // 顶层敏感字段：哈希而非移除（保留可追溯性）
      if (DEIDENTIFY_FIELDS.includes(key as (typeof DEIDENTIFY_FIELDS)[number])) {
        result[key] = `[REDACTED:${this.hash(String(value))}]`
        continue
      }

      // 嵌套敏感字段：递归清理
      if (
        DEIDENTIFY_NESTED_FIELDS.includes(key as (typeof DEIDENTIFY_NESTED_FIELDS)[number]) &&
        typeof value === 'string'
      ) {
        result[key] = `[REDACTED:${this.hash(value)}]`
        continue
      }

      // 递归清理嵌套对象
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deidentify(value as Record<string, unknown>)
        continue
      }

      // 递归清理数组
      if (Array.isArray(value)) {
        result[key] = value.map((v) => {
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            return this.deidentify(v as Record<string, unknown>)
          }
          return v
        })
        continue
      }

      // 其余字段原样保留
      result[key] = value
    }

    return result
  }

  /** 哈希敏感值——不可逆但可关联。 */
  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
  }
}
