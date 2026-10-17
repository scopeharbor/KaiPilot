/**
 * OCR Privacy Policy Resolver — 单元测试
 *
 * 覆盖：默认策略、项目覆盖、无效覆盖、哈希稳定性、跨组织掩蔽
 */
import { describe, it, expect } from 'vitest'
import {
  resolveSystemDefaultPrivacyPolicy,
  computePrivacyPolicyHash,
  validatePrivacyPolicyOverride,
} from '@aiproj/types'

describe('OcrPrivacyPolicyResolver', () => {
  it('resolveSystemDefault returns valid policy', () => {
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })
    expect(policy.source).toBe('system')
    expect(policy.organizationId).toBe(1)
    expect(policy.projectId).toBe(10)
    expect(policy.policyHash.length).toBe(8)
    expect(policy.categoryRules.length).toBe(13)
    expect(policy.allowedPurposes).toContain('review')
    expect(policy.allowedPurposes).not.toContain('export_full')
  })

  it('policy hash is deterministic', () => {
    const a = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: null })
    const b = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: null })
    expect(a.policyHash).toBe(b.policyHash)
  })

  it('different org produces different policy hash', () => {
    const a = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: null })
    const b = resolveSystemDefaultPrivacyPolicy({ organizationId: 2, projectId: null })
    expect(a.policyHash).not.toBe(b.policyHash)
  })

  it('policy hash 与 computePrivacyPolicyHash 同源', () => {
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 3, projectId: 7 })
    // resolver 输出的 policyHash 必须能由公开纯函数复算，否则覆盖流程校验会与解析结果脱节
    expect(policy.policyHash).toBe(
      computePrivacyPolicyHash({
        organizationId: 3,
        projectId: 7,
        categoryRules: policy.categoryRules,
      }),
    )
  })

  it('validate override rejects unsafe policies', () => {
    // 空规则集本来就没什么可拒绝的，只断言返回数组等于没测「拒绝」；
    // 这里给出真正越界的覆盖：高敏类别 full 输出 + export_full/ai_handoff 用途。
    const errors = validatePrivacyPolicyOverride({
      categoryRules: [
        {
          category: 'accepted_extraction_text',
          allowedPurposes: ['export_full', 'ai_handoff'],
          defaultOutputMode: 'full',
        },
      ],
      allowedPurposes: ['export_full', 'ai_handoff'],
      globalOutputMode: 'full',
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('export_full'))).toBe(true)
    expect(errors.some((e) => e.includes('ai_handoff'))).toBe(true)
  })

  it('validate override 接受合规覆盖', () => {
    const errors = validatePrivacyPolicyOverride({
      categoryRules: [
        {
          category: 'accepted_extraction_text',
          allowedPurposes: ['review'],
          defaultOutputMode: 'masked',
        },
      ],
      allowedPurposes: ['review'],
      globalOutputMode: 'masked',
    })
    expect(errors).toEqual([])
  })

  it('policy resolver service can be imported', async () => {
    const mod = await import('../../app/services/ai_ocr/ocr_privacy_policy_resolver.js')
    expect(mod.OcrPrivacyPolicyResolver).toBeDefined()
  })
})
