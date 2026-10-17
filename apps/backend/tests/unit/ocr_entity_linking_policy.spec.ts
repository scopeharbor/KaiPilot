/**
 * OCR Entity Linking Policy — 权限测试
 *
 * 验证 OcrEntityLinkingPolicy 的断言、降级和越权拒绝逻辑。
 */
import { describe, it, expect } from 'vitest'
import OcrEntityLinkingPolicy from '../../app/policies/ocr_entity_linking_policy.js'

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

describe('OcrEntityLinkingPolicy', () => {
  describe('view()', () => {
    it('returns true for member with ocr_entity_link:view', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_entity_link:view' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.view()).toBe(true)
    })

    it('returns true for member with ocr:review fallback', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr:review' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.view()).toBe(true)
    })

    it('returns false for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.view()).toBe(false)
    })

    it('returns false for member without permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.view()).toBe(false)
    })
  })

  describe('manage()', () => {
    it('returns true for member with ocr_entity_link:manage', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_entity_link:manage' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.manage()).toBe(true)
    })

    it('returns true for member with file:manage fallback', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'file:manage' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.manage()).toBe(true)
    })

    it('returns false for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.manage()).toBe(false)
    })
  })

  describe('confirm()', () => {
    it('returns true for member with ocr_entity_link:confirm', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_entity_link:confirm' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.confirm()).toBe(true)
    })

    it('returns true for member with ocr:confirm fallback', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr:confirm' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.confirm()).toBe(true)
    })
  })

  describe('explain()', () => {
    it('returns true for member with ocr_entity_link:explain', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_entity_link:explain' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.explain()).toBe(true)
    })

    it('returns true for member with ai:trigger fallback', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ai:trigger' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.explain()).toBe(true)
    })

    it('returns false without permission', () => {
      const ctx = makeMockCtx()
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.explain()).toBe(false)
    })
  })

  describe('assert methods', () => {
    it('assertView throws for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      // 错误码在异常的 code 属性上（统一 envelope 的 error.code），不在 message 里
      expect(() => policy.assertView()).toThrow()
      try {
        policy.assertView()
      } catch (error) {
        expect((error as { code?: string }).code).toBe('OCR_ENTITY_LINK_PERMISSION_DENIED')
      }
    })

    it('assertManage throws for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      // 错误码在异常的 code 属性上（统一 envelope 的 error.code），不在 message 里
      expect(() => policy.assertManage()).toThrow()
      try {
        policy.assertManage()
      } catch (error) {
        expect((error as { code?: string }).code).toBe('OCR_ENTITY_LINK_PERMISSION_DENIED')
      }
    })

    it('assertConfirm throws for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      // 错误码在异常的 code 属性上（统一 envelope 的 error.code），不在 message 里
      expect(() => policy.assertConfirm()).toThrow()
      try {
        policy.assertConfirm()
      } catch (error) {
        expect((error as { code?: string }).code).toBe('OCR_ENTITY_LINK_PERMISSION_DENIED')
      }
    })
  })

  describe('resolveScope()', () => {
    it('returns null for non-member', () => {
      const ctx = makeMockCtx({ member: null })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.resolveScope()).toBeNull()
    })

    it('returns full for member with manage permission', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_entity_link:manage' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.resolveScope()).toBe('full')
    })

    it('returns readonly for member with view only', () => {
      const ctx = makeMockCtx({
        rbac: { hasPermission: (p: string) => p === 'ocr_entity_link:view' },
      })
      const policy = new OcrEntityLinkingPolicy(ctx as any)
      expect(policy.resolveScope()).toBe('readonly')
    })
  })
})
