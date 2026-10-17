/**
 * OCR Structured Extraction Policy — 权限测试
 *
 * 验证 OcrStructuredExtractionPolicy 的断言、降级和越权拒绝逻辑。
 */
import { describe, it, expect } from 'vitest'
import OcrStructuredExtractionPolicy from '../../app/policies/ocr_structured_extraction_policy.js'

function makeMockCtx(overrides?: { member?: any; rbac?: any }) {
  const ctx: any = {
    projectMember: overrides?.member ?? { role: 'member' },
    rbac: {
      hasPermission: (p: string) => {
        if (overrides?.rbac?.hasPermission) return overrides.rbac.hasPermission(p)
        return false
      },
    },
  }
  return ctx
}

describe('OcrStructuredExtractionPolicy', () => {
  describe('view()', () => {
    it('returns true for member with ocr_structured_extraction:view', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_structured_extraction:view' },
      })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.view()).toBe(true)
    })

    it('returns true for member with ocr:review fallback', () => {
      const ctx = makeMockCtx({ rbac: { hasPermission: (p: string) => p === 'ocr:review' } })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.view()).toBe(true)
    })

    it('returns false for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.view()).toBe(false)
    })

    it('returns false for member without permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.view()).toBe(false)
    })
  })

  describe('manage()', () => {
    it('returns true for member with ocr_structured_extraction:manage', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_structured_extraction:manage' },
      })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.manage()).toBe(true)
    })

    it('returns true for member with file:manage fallback', () => {
      const ctx = makeMockCtx({ rbac: { hasPermission: (p: string) => p === 'file:manage' } })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.manage()).toBe(true)
    })

    it('returns false for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.manage()).toBe(false)
    })
  })

  describe('run()', () => {
    it('returns true for member with ocr_structured_extraction:run', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_structured_extraction:run' },
      })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.run()).toBe(true)
    })
  })

  describe('confirm()', () => {
    it('returns true for member with ocr_structured_extraction:confirm', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_structured_extraction:confirm' },
      })
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(policy.confirm()).toBe(true)
    })
  })

  describe('assert methods', () => {
    it('assertView throws when no permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(() => policy.assertView()).toThrow()
    })

    it('assertManage throws when no permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(() => policy.assertManage()).toThrow()
    })

    it('assertRun throws when no permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(() => policy.assertRun()).toThrow()
    })

    it('assertConfirm throws when no permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrStructuredExtractionPolicy(ctx as any)
      expect(() => policy.assertConfirm()).toThrow()
    })
  })
})
