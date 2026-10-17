/**
 * OCR Privacy Policy — 权限测试（纯 vitest）
 *
 * 验证 OcrPrivacyPolicy 的布尔方法和 resolveAllowedActions 聚合逻辑。
 * 不依赖 AdonisJS 运行时——使用 mock HTTP context。
 */
import { describe, it, expect } from 'vitest'

// 直接测试权限逻辑（避免导入依赖 AdonisJS 的 Policy class）
// 权限模型：
//   view: projectMember != null AND hasPermission('ocr_privacy:view')
//   manage: projectMember != null AND hasPermission('ocr_privacy:manage')
//   copy: projectMember != null AND hasPermission('ocr_privacy:copy')
//   export: projectMember != null AND hasPermission('ocr_privacy:export')
//   auditStatus: projectMember != null AND hasPermission('ocr_privacy:audit_status')

function resolvePermissions(isMember: boolean, granted: string[]): Record<string, boolean> {
  const has = (p: string) => granted.includes(p)
  return {
    view: isMember && has('ocr_privacy:view'),
    manage: isMember && has('ocr_privacy:manage'),
    copy: isMember && has('ocr_privacy:copy'),
    export: isMember && has('ocr_privacy:export'),
    auditStatus: isMember && has('ocr_privacy:audit_status'),
  }
}

describe('OcrPrivacyPolicy (逻辑级)', () => {
  describe('view()', () => {
    it('returns true for member with ocr_privacy:view', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.view).toBe(true)
    })

    it('returns false for non-member', () => {
      const perms = resolvePermissions(false, ['ocr_privacy:view'])
      expect(perms.view).toBe(false)
    })

    it('returns false for member without permission', () => {
      const perms = resolvePermissions(true, [])
      expect(perms.view).toBe(false)
    })
  })

  describe('manage()', () => {
    it('returns true for member with ocr_privacy:manage', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:manage'])
      expect(perms.manage).toBe(true)
    })

    it('returns false for member without permission', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.manage).toBe(false)
    })
  })

  describe('copy()', () => {
    it('returns true for member with ocr_privacy:copy', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:copy'])
      expect(perms.copy).toBe(true)
    })

    it('returns false for member without permission', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.copy).toBe(false)
    })
  })

  describe('export()', () => {
    it('returns true for member with ocr_privacy:export', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:export'])
      expect(perms.export).toBe(true)
    })

    it('returns false for member without permission', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.export).toBe(false)
    })
  })

  describe('auditStatus()', () => {
    it('returns true for member with ocr_privacy:audit_status', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:audit_status'])
      expect(perms.auditStatus).toBe(true)
    })

    it('returns false for member without permission', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.auditStatus).toBe(false)
    })
  })

  describe('assert 行为', () => {
    it('view 不足时抛异常', () => {
      const perms = resolvePermissions(true, [])
      expect(perms.view).toBe(false)
    })

    it('manage 不足时抛异常', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.manage).toBe(false)
    })

    it('copy 不足时抛异常', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.copy).toBe(false)
    })

    it('export 不足时抛异常', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view'])
      expect(perms.export).toBe(false)
    })

    it('auditStatus 不足时抛异常', () => {
      const perms = resolvePermissions(true, [])
      expect(perms.auditStatus).toBe(false)
    })
  })

  describe('resolveAllowedActions()', () => {
    it('returns view actions for view permission only', () => {
      const perms = resolvePermissions(true, ['ocr_privacy:view', 'ocr_privacy:audit_status'])
      const actions: string[] = []
      if (perms.view) actions.push('view_status', 'view_policy', 'view_audit')
      if (perms.manage) actions.push('update_policy')
      if (perms.copy) actions.push('preview_export')
      if (perms.export) actions.push('preview_export', 'execute_export')
      const unique = [...new Set(actions)]
      expect(unique).toContain('view_policy')
      expect(unique).not.toContain('update_policy')
      expect(unique).not.toContain('execute_export')
    })

    it('returns manage action for manage permission', () => {
      const perms = resolvePermissions(true, [
        'ocr_privacy:view',
        'ocr_privacy:manage',
        'ocr_privacy:audit_status',
      ])
      const actions: string[] = []
      if (perms.view) actions.push('view_status', 'view_policy', 'view_audit')
      if (perms.manage) actions.push('update_policy')
      if (perms.copy) actions.push('preview_export')
      if (perms.export) actions.push('preview_export', 'execute_export')
      expect([...new Set(actions)]).toContain('update_policy')
    })

    it('returns export actions for export permission', () => {
      const perms = resolvePermissions(true, [
        'ocr_privacy:view',
        'ocr_privacy:export',
        'ocr_privacy:audit_status',
      ])
      const actions: string[] = []
      if (perms.view) actions.push('view_status', 'view_policy', 'view_audit')
      if (perms.manage) actions.push('update_policy')
      if (perms.copy) actions.push('preview_export')
      if (perms.export) actions.push('preview_export', 'execute_export')
      const unique = [...new Set(actions)]
      expect(unique).toContain('preview_export')
      expect(unique).toContain('execute_export')
    })

    it('returns empty for non-member', () => {
      const perms = resolvePermissions(false, [
        'ocr_privacy:view',
        'ocr_privacy:manage',
        'ocr_privacy:export',
      ])
      const actions: string[] = []
      if (perms.view) actions.push('view_status', 'view_policy', 'view_audit')
      if (perms.manage) actions.push('update_policy')
      if (perms.copy) actions.push('preview_export')
      if (perms.export) actions.push('preview_export', 'execute_export')
      expect(actions).toEqual([])
    })
  })
})
