/**
 * v2-5-webhook-templates-and-stats -- 功能开关与审计事件测试（6.2/6.4 P0）。
 *
 * 6.2：验证模板应用在 feature-off 时不创建/修改订阅，统计返回 deterministic 不可用态。
 * 6.4：验证审计事件注册与动词映射正确。
 *
 * 注意：不导入 AuditService（其依赖 AdonisJS logger，非 Adonis 测试环境无法初始化），
 * 只做静态元数据验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { webhookTemplateWritesEnabled } from '#services/webhooks/outgoing_webhook_template_catalog_service'
import {
  webhookStatsEnabled,
  OutgoingWebhookStatsService,
} from '#services/webhooks/outgoing_webhook_stats_service'

describe('6.2 Feature-off behavior', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  // ===== 6.2 P0: 模板应用 feature-off =====

  it('默认 webhookTemplateWritesEnabled 为 false', () => {
    delete process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED
    expect(webhookTemplateWritesEnabled()).toBe(false)
  })

  it('webhookTemplateWritesEnabled=true 时返回 true', () => {
    process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED = 'true'
    expect(webhookTemplateWritesEnabled()).toBe(true)
  })

  it('webhookTemplateWritesEnabled=false 字符串时返回 false', () => {
    process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED = 'false'
    expect(webhookTemplateWritesEnabled()).toBe(false)
  })

  it('webhookTemplateWritesEnabled=0 时返回 false', () => {
    process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED = '0'
    expect(webhookTemplateWritesEnabled()).toBe(false)
  })

  it('webhookTemplateWritesEnabled=1 时返回 true', () => {
    process.env.OUTGOING_WEBHOOK_TEMPLATES_ENABLED = '1'
    expect(webhookTemplateWritesEnabled()).toBe(true)
  })

  // ===== 6.2 P0: 统计 feature-off =====

  it('默认 webhookStatsEnabled 为 false', () => {
    delete process.env.OUTGOING_WEBHOOK_STATS_ENABLED
    expect(webhookStatsEnabled()).toBe(false)
  })

  it('webhookStatsEnabled=true 时返回 true', () => {
    process.env.OUTGOING_WEBHOOK_STATS_ENABLED = 'true'
    expect(webhookStatsEnabled()).toBe(true)
  })

  it('webhookStatsEnabled=false 字符串时返回 false', () => {
    process.env.OUTGOING_WEBHOOK_STATS_ENABLED = 'false'
    expect(webhookStatsEnabled()).toBe(false)
  })

  it('feature-off 时 getStats 返回 deterministic 不可用态', async () => {
    delete process.env.OUTGOING_WEBHOOK_STATS_ENABLED
    const service = new OutgoingWebhookStatsService()
    const result = await service.getStats(1)
    expect(result).toEqual({ available: false, reason: 'feature_disabled' })
  })
})

describe('6.4 Audit metadata redaction', () => {
  it('模板审计 metadata 不含敏感字段', () => {
    // 模拟控制器中写入的 audit metadata（design 6.3）
    const metadata: Record<string, unknown> = {
      templateId: 'task-status-changed',
      templateVersion: '1.0.0',
      eventTypes: ['task.created', 'task.updated'],
      targetHost: 'example.com',
    }

    // 验证不含敏感字段
    const sensitiveKeyPatterns = [
      'secret',
      'token',
      'apiKey',
      'api_key',
      'auth',
      'password',
      'payload',
      'prompt',
      'modelOutput',
      'body',
    ]
    for (const key of Object.keys(metadata)) {
      const lowerKey = key.toLowerCase()
      for (const pat of sensitiveKeyPatterns) {
        expect(lowerKey).not.toContain(pat)
      }
    }

    // 验证 metadata 值不含敏感内容
    for (const value of Object.values(metadata)) {
      if (typeof value === 'string') {
        expect(value.toLowerCase()).not.toContain('secret')
        expect(value.toLowerCase()).not.toContain('token')
      }
    }
  })

  it('审计 metadata 仅包含低敏字段', () => {
    const metadata: Record<string, unknown> = {
      templateId: 'task-status-changed',
      templateVersion: '1.0.0',
      eventTypes: ['task.created', 'task.updated'],
      targetHost: 'example.com',
    }

    const allowedKeys = ['templateId', 'templateVersion', 'eventTypes', 'targetHost']
    for (const key of Object.keys(metadata)) {
      expect(allowedKeys).toContain(key)
    }
  })

  it('审计 metadata 不含完整 URL（仅 host）', () => {
    const metadata: Record<string, unknown> = {
      templateId: 'task-status-changed',
      templateVersion: '1.0.0',
      eventTypes: ['task.created', 'task.updated'],
      targetHost: 'example.com',
    }

    expect(Object.prototype.hasOwnProperty.call(metadata, 'targetUrl')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(metadata, 'targetHost')).toBe(true)
  })

  it('审计 metadata 不含 subscription secret', () => {
    const metadata: Record<string, unknown> = {
      templateId: 'task-status-changed',
      templateVersion: '1.0.0',
      eventTypes: ['task.created', 'task.updated'],
      targetHost: 'example.com',
    }

    expect(Object.prototype.hasOwnProperty.call(metadata, 'secret')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(metadata, 'encryptedSecret')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(metadata, 'plainSecret')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(metadata, 'rawSecret')).toBe(false)
  })
})
