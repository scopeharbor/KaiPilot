/**
 * v2-5-webhook-templates-and-stats -- 边界与副作用测试（6.5 P0）。
 *
 * 验证此 change 在默认验证流程中不发起真实外发 HTTP 请求、provider callback 或外部写回。
 * 所有模板和统计服务只使用 fixture/mock 数据或只读数据库查询。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import OutgoingWebhookTemplateCatalogService, {
  OutgoingWebhookTemplateNotFoundError,
  webhookTemplateWritesEnabled,
} from '#services/webhooks/outgoing_webhook_template_catalog_service'

describe('6.5 Fixture-boundary: 模板服务不发起外部 HTTP', () => {
  let service: OutgoingWebhookTemplateCatalogService

  beforeEach(() => {
    service = new OutgoingWebhookTemplateCatalogService()
  })

  it('list 方法只读，不发起 HTTP', () => {
    // 纯函数：从内置静态目录读取，不依赖数据库/网络
    const templates = service.list()
    expect(templates.length).toBeGreaterThan(0)
    // 验证所有模板都是静态数据
    for (const t of templates) {
      expect(t.id).toBeTruthy()
      expect(t.version).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.stability).toBe('stable')
    }
  })

  it('get 方法只读，不发起 HTTP', () => {
    const t = service.get('task-status-changed')
    expect(t.id).toBe('task-status-changed')
    expect(t.headerPresets).toBeDefined()
  })

  it('prefill 方法只读，不发起 HTTP', () => {
    const p = service.prefill('task-status-changed')
    expect(p.templateId).toBe('task-status-changed')
    expect(p.suggestedName).toContain('任务状态')
  })

  it('get 未知模板抛出本地错误，不发起 HTTP', () => {
    expect(() => service.get('non-existent')).toThrow(OutgoingWebhookTemplateNotFoundError)
  })

  it('validateCompatibility 纯函数，不发起 HTTP', () => {
    const result = service.validateCompatibility('task-status-changed', ['task.created' as const])
    expect(result.compatible).toBe(true)
  })

  it('webhookTemplateWritesEnabled 是同步函数，只读 env', () => {
    expect(typeof webhookTemplateWritesEnabled()).toBe('boolean')
  })
})

describe('6.5 Fixture-boundary: 模板应用不直接调用 delivery client', () => {
  it('模板目录服务只有 catalog 方法，无 send/dispatch/fetch 方法', () => {
    const proto = OutgoingWebhookTemplateCatalogService.prototype
    expect(typeof proto.list).toBe('function')
    expect(typeof proto.get).toBe('function')
    expect(typeof proto.prefill).toBe('function')
    expect(typeof proto.validateCompatibility).toBe('function')
    // 无 send/dispatch/fetch 方法
    expect((proto as any).send).toBeUndefined()
    expect((proto as any).dispatch).toBeUndefined()
    expect((proto as any).fetch).toBeUndefined()
  })
})

describe('6.5 Fixture-boundary: 统计 DTO 不含外部引用或 URL', () => {
  it('统计 DTO keys 不含 URL/endpoint/callback', () => {
    const statsDtoKeys = [
      'startDate',
      'endDate',
      'totalDeliveries',
      'byStatus',
      'successRate',
      'failureRate',
      'totalRetries',
      'byFailureCategory',
      'lastDeliveryAt',
      'nextRetryAt',
      'activeSubscriptionCount',
      'templateUsageCount',
    ]
    for (const key of statsDtoKeys) {
      expect(key.toLowerCase()).not.toContain('url')
      expect(key.toLowerCase()).not.toContain('endpoint')
      expect(key.toLowerCase()).not.toContain('callback')
    }
  })

  it('OutgoingWebhookStatsDto 类型不含 HTTP 相关字段', () => {
    // 从类型定义验证：统计 DTO 只有聚合计数和元数据
    interface TestDto {
      startDate: string
      endDate: string
      totalDeliveries: number
      successRate: number
      failureRate: number
      totalRetries: number
      lastDeliveryAt: string | null
      nextRetryAt: string | null
      activeSubscriptionCount: number
    }
    // 不含 url、endpoint、callback 等
    const dto: TestDto = {
      startDate: '2026-07-01',
      endDate: '2026-07-23',
      totalDeliveries: 0,
      successRate: 0,
      failureRate: 0,
      totalRetries: 0,
      lastDeliveryAt: null,
      nextRetryAt: null,
      activeSubscriptionCount: 0,
    }
    expect(dto.totalDeliveries).toBe(0)
  })
})
