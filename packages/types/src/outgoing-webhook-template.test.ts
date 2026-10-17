/**
 * v2-5-webhook-templates-and-stats -- 模板契约测试。
 *
 * 验证：
 * - 模板定义只引用共享白名单事件类型（2.2 P0）
 * - 模板定义不包含任意 payload transform、可执行代码、密钥、token、auth header、prompt、模型输出（2.2 P0）
 * - 模板元数据脱敏（2.2 P0）
 */
import { describe, it, expect } from 'vitest'
import {
  OUTGOING_WEBHOOK_EVENT_WHITELIST,
  isAllowedOutgoingWebhookEvent,
} from './outgoing-webhook.js'
import { BUILT_IN_WEBHOOK_TEMPLATES } from './outgoing-webhook-template-catalog.js'
import type {
  OutgoingWebhookTemplateDto,
  OutgoingWebhookTemplateHeaderPreset,
} from './outgoing-webhook-template.js'

/** 已知的敏感字段名（负向断言 helper）。 */
const SENSITIVE_FIELD_PATTERNS = [
  /secret/i,
  /token/i,
  /api.?key/i,
  /auth(orization)?/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /private.?key/i,
  /ssh.?key/i,
  /cookie/i,
  /prompt/i,
  /model.?output/i,
  /payload.?body/i,
  /transform/i,
  /script/i,
  /exec(utable)?/i,
  /code/i,
  /eval/i,
  /function/i,
  /command/i,
  /template.?engine/i,
  /liquid/i,
  /handlebars/i,
  /mustache/i,
  /jq/i,
  /jsonata/i,
]

/** 正则搜索值（递归）。仅检查 ASCII 敏感字段，避免中文误匹配。 */
function containsSensitiveField(
  value: unknown,
  path: string,
): { path: string; pattern: RegExp } | null {
  if (typeof value === 'string') {
    // 仅检查 ASCII 字符串（不含中文字符的值），避免"脚本"等中文词误匹配
    if (/^[\x00-\x7F]*$/.test(value)) {
      for (const pattern of SENSITIVE_FIELD_PATTERNS) {
        if (pattern.test(value)) {
          return { path, pattern }
        }
      }
    }
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const result = containsSensitiveField(value[i], `${path}[${i}]`)
      if (result) return result
    }
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const result = containsSensitiveField(val, `${path}.${key}`)
      if (result) return result
    }
  }
  return null
}

describe('OutgoingWebhookTemplateContract', () => {
  // ===== 2.2 P0: 模板事件类型只引用白名单 =====

  it('所有模板的 eventTypes 均在白名单内', () => {
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      for (const et of template.eventTypes) {
        expect(isAllowedOutgoingWebhookEvent(et)).toBe(true)
      }
    }
  })

  // ===== 2.2 P0: 模板不包含任意 payload transform 字段 =====

  it('模板定义不包含 payload transform 字段', () => {
    const forbiddenTransformKeys = [
      'transform',
      'payloadTransform',
      'payloadTemplate',
      'script',
      'code',
      'executable',
      'templateEngine',
      'liquidTemplate',
      'handlebarsTemplate',
      'mustacheTemplate',
      'jqExpression',
      'jsonataExpression',
    ]
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      for (const key of forbiddenTransformKeys) {
        expect(Object.prototype.hasOwnProperty.call(template, key)).toBe(false)
      }
    }
  })

  // ===== 2.2 P0: 模板不包含密钥/secret 字段 =====

  it('模板定义不包含 secret 明文或密文', () => {
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      expect(Object.prototype.hasOwnProperty.call(template, 'secret')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'secretCiphertext')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'plainSecret')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'encryptedSecret')).toBe(false)
    }
  })

  // ===== 2.2 P0: 模板不包含 token/auth header 字段 =====

  it('模板定义不包含 token 或授权 header', () => {
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      expect(Object.prototype.hasOwnProperty.call(template, 'token')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'apiKey')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'authorizationHeader')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'authHeader')).toBe(false)
    }
  })

  // ===== 2.2 P0: 模板不包含 prompt 或模型输出 =====

  it('模板定义不包含 prompt 或模型输出字段', () => {
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      expect(Object.prototype.hasOwnProperty.call(template, 'prompt')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'modelOutput')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'aiPrompt')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(template, 'completion')).toBe(false)
    }
  })

  // ===== 2.2 P0: 模板 headerPresets 不包含敏感 header =====

  it('模板 headerPresets 不包含敏感 header 名称', () => {
    const sensitiveHeaders = [
      'authorization',
      'www-authenticate',
      'proxy-authenticate',
      'proxy-authorization',
      'set-cookie',
      'cookie',
      'x-api-key',
      'api-key',
      'x-auth-token',
      'x-tenant-key',
      'x-aiproj-webhook-signature',
      'x-aiproj-webhook-timestamp',
      'x-aiproj-webhook-idempotency-key',
    ]
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      for (const hp of template.headerPresets) {
        const headerLower = hp.name.toLowerCase()
        for (const sensitive of sensitiveHeaders) {
          expect(headerLower).not.toBe(sensitive)
        }
      }
    }
  })

  // ===== 2.2 P0: 递归检查模板结构中无敏感字段值 =====

  it('模板结构中无敏感字段值（递归负向）', () => {
    for (const template of BUILT_IN_WEBHOOK_TEMPLATES) {
      const result = containsSensitiveField(template as unknown as Record<string, unknown>, 'root')
      if (result) {
        // Report first violation
        expect(result).toBeNull()
      }
    }
  })
})
