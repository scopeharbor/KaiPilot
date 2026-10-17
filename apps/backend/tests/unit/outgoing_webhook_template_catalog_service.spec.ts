/**
 * v2-5-webhook-templates-and-stats -- 模板目录服务单元测试（3.2 P0）。
 *
 * 验证脱敏投影、白名单兼容校验、未知模板拒绝、feature-off 行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import OutgoingWebhookTemplateCatalogService, {
  OutgoingWebhookTemplateNotFoundError,
  webhookTemplateWritesEnabled,
} from '#services/webhooks/outgoing_webhook_template_catalog_service'

describe('OutgoingWebhookTemplateCatalogService', () => {
  let service: OutgoingWebhookTemplateCatalogService

  beforeEach(() => {
    vi.unstubAllEnvs()
    service = new OutgoingWebhookTemplateCatalogService()
  })

  // ===== 3.2 P0: 列表 =====

  it('list 返回非空模板列表', () => {
    const templates = service.list()
    expect(templates.length).toBeGreaterThan(0)
  })

  it('list 返回的模板不包含 internal/disabled', () => {
    const templates = service.list()
    for (const t of templates) {
      expect(t.stability).toBe('stable')
    }
  })

  it('list 返回的模板不含敏感字段', () => {
    const templates = service.list()
    for (const t of templates) {
      expect(Object.prototype.hasOwnProperty.call(t, 'secret')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(t, 'token')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(t, 'prompt')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(t, 'modelOutput')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(t, 'payloadTransform')).toBe(false)
    }
  })

  // ===== 3.2 P0: 获取单个模板 =====

  it('get 已知模板返回正确', () => {
    const t = service.get('task-status-changed')
    expect(t.id).toBe('task-status-changed')
    expect(t.name).toBeTruthy()
    expect(t.eventTypes.length).toBeGreaterThan(0)
  })

  it('get 未知模板抛出', () => {
    expect(() => service.get('non-existent')).toThrow(OutgoingWebhookTemplateNotFoundError)
  })

  it('get 已禁用模板抛出', () => {
    // internal 模板可通过 get() 获取（不对外展示但内部可引用）
    const t = service.get('delivery-test-fixture')
    expect(t.stability).toBe('internal')
    // disabled 模板不存在，抛出
    expect(() => service.get('nonexistent')).toThrow(OutgoingWebhookTemplateNotFoundError)
  })

  // ===== 3.2 P0: 预填 =====

  it('prefill 返回预填信息', () => {
    const p = service.prefill('task-status-changed')
    expect(p.templateId).toBe('task-status-changed')
    expect(p.suggestedName).toContain('任务状态变更通知')
    expect(p.suggestedEventTypes.length).toBeGreaterThan(0)
    expect(p.templateVersion).toBe('1.0.0')
  })

  it('prefill 未知模板抛出', () => {
    expect(() => service.prefill('non-existent')).toThrow(OutgoingWebhookTemplateNotFoundError)
  })

  // ===== 3.2 P0: 兼容性校验 =====

  it('兼容的事件类型返回 compatible=true', () => {
    const result = service.validateCompatibility('task-status-changed', [
      'task.created' as const,
      'task.updated' as const,
    ])
    expect(result.compatible).toBe(true)
    expect(result.intersection.length).toBeGreaterThan(0)
  })

  it('不兼容的事件类型返回 compatible=false', () => {
    const result = service.validateCompatibility('task-status-changed', ['risk.created' as const])
    expect(result.compatible).toBe(false)
    expect(result.intersection.length).toBe(0)
  })

  it('未知模板兼容性抛出', () => {
    expect(() => service.validateCompatibility('non-existent', ['task.created' as const])).toThrow(
      OutgoingWebhookTemplateNotFoundError,
    )
  })

  // ===== 3.2 P0: feature-off 行为 =====

  it('默认 webhookTemplateWritesEnabled 为 false', () => {
    vi.unstubAllEnvs()
    // ensure env is cleared
    delete process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED
    expect(webhookTemplateWritesEnabled()).toBe(false)
  })

  it('设置为 true 时 webhookTemplateWritesEnabled 返回 true', () => {
    process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED = 'true'
    expect(webhookTemplateWritesEnabled()).toBe(true)
  })

  it('设置为 false 时 webhookTemplateWritesEnabled 返回 false', () => {
    process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED = 'false'
    expect(webhookTemplateWritesEnabled()).toBe(false)
  })
})
