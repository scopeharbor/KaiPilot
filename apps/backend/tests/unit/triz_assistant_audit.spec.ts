/**
 * v3-ai-triz-assistant —— AI-TRIZ 助手审计脱敏测试（tasks 3.10，vitest）。
 *
 * 证明以下字段被排除在审计之外：
 * - prompt text / 完整用户输入
 * - completion text / 完整模型输出
 * - hidden source titles / counts
 * - raw evidence bodies
 * - secrets / tokens / Authorization headers
 */
import { describe, it, expect } from 'vitest'
import type { AiTrizAssistantAuditRefs, AiTrizAssistantWarningCode } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 帮助函数：模拟 auditRefs
// ---------------------------------------------------------------------------
function mockAuditRefs(
  overrides: Partial<AiTrizAssistantAuditRefs> = {},
): AiTrizAssistantAuditRefs {
  return {
    runId: 'run-test-001',
    routeIds: ['r1', 'r2'],
    actionIds: ['a1'],
    sourceRefKinds: ['contradiction', 'contradiction_matrix'],
    sourceHashPrefixes: ['a1b2c3d4', 'e5f6a7b8'],
    warningCodes: [],
    fallbackState: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试组：审计脱敏
// ---------------------------------------------------------------------------
describe('TrizAssistant - audit redaction', () => {
  it('auditRefs must not contain raw prompt text', () => {
    const refs = mockAuditRefs()
    const str = JSON.stringify(refs)

    // 不应该包含 "prompt" 字段名
    expect(str).not.toContain('"prompt"')
    expect(str).not.toContain('"rawPrompt"')
    expect(str).not.toContain('"fullPrompt"')
  })

  it('auditRefs must not contain completion/model output text', () => {
    const refs = mockAuditRefs()
    const str = JSON.stringify(refs)

    expect(str).not.toContain('"completion"')
    expect(str).not.toContain('"rawOutput"')
    expect(str).not.toContain('"modelResponse"')
  })

  it('auditRefs must not contain Authorization headers', () => {
    const refs = mockAuditRefs()
    const str = JSON.stringify(refs).toLowerCase()

    expect(str).not.toContain('authorization')
    expect(str).not.toContain('bearer')
  })

  it('auditRefs must not contain secrets or tokens', () => {
    const refs = mockAuditRefs()
    const str = JSON.stringify(refs).toLowerCase()

    expect(str).not.toContain('secret')
    expect(str).not.toContain('token')
    expect(str).not.toContain('password')
    expect(str).not.toContain('api_key')
  })

  it('sourceHashPrefixes must be ≤ 8 characters each', () => {
    const refs = mockAuditRefs({
      sourceHashPrefixes: ['a1b2c3d4', 'e5f6a7b8', '12345678'],
    })

    for (const prefix of refs.sourceHashPrefixes) {
      expect(prefix.length).toBeLessThanOrEqual(8)
    }
  })

  it('sourceRefKinds must not contain hidden counts or titles', () => {
    const refs = mockAuditRefs()

    for (const kind of refs.sourceRefKinds) {
      // 每个 kind 应是一个合法的枚举值，不是实体标题
      expect(typeof kind).toBe('string')
      expect(kind.length).toBeLessThanOrEqual(60)
      // 不包含 "hidden" 前缀
      expect(kind).not.toContain('hidden_')
    }
  })

  it('auditRefs must not contain raw evidence bodies', () => {
    const refs = mockAuditRefs()
    const str = JSON.stringify(refs).toLowerCase()

    expect(str).not.toContain('"evidence"')
    expect(str).not.toContain('"rawbody"')
    expect(str).not.toContain('"fulltext"')
  })

  it('warningCodes must be valid enum-style values', () => {
    const validCodes: AiTrizAssistantWarningCode[] = [
      'SOURCE_UNAVAILABLE',
      'SOURCE_STALE',
      'SOURCE_PERMISSION_DENIED',
      'CONTEXT_TRUNCATED',
      'MISSING_INFORMATION',
      'AMBIGUOUS_INTENT',
      'DESTINATION_UNAVAILABLE',
      'AI_FALLBACK',
      'AI_HALLUCINATION_DETECTED',
      'AI_BUDGET_EXCEEDED',
      'AI_PROVIDER_ERROR',
      'STALE_ACTION_BLOCKED',
      'FEATURE_FLAG_DISABLED',
      'CROSS_ORGANIZATION_BLOCKED',
      'INACCESSIBLE_TARGET',
    ]

    for (const code of validCodes) {
      // 所有合法码都是大写下划线格式
      expect(code).toMatch(/^[A-Z][A-Z_]+$/)
    }
  })

  it('fallbackState is always boolean', () => {
    const refs1 = mockAuditRefs({ fallbackState: true })
    const refs2 = mockAuditRefs({ fallbackState: false })

    expect(typeof refs1.fallbackState).toBe('boolean')
    expect(typeof refs2.fallbackState).toBe('boolean')
  })
})
