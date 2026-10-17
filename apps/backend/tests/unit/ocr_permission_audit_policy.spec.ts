/**
 * OCR Permission & Audit Policy — 权限测试（v3-ocr-permission-and-audit §3.5）
 *
 * 覆盖项目管理员允许、成员部分允许、只读降级、外部协作者隐藏、
 * 缺权限拒绝与跨组织掩蔽。
 */
import { test } from '@japa/runner'
import OcrPermissionAuditPolicy from '../../app/policies/ocr_permission_audit_policy.js'

function makeMockCtx(overrides?: { member?: any; rbac?: any }) {
  const ctx: any = {
    // 显式传 member: null 时需保留 null（代表跨组织非成员），不能用 ?? 兜底
    projectMember: overrides && 'member' in overrides ? overrides.member : { role: 'member' },
    rbac: {
      hasPermission: (p: string) => {
        if (overrides?.rbac?.hasPermission) return overrides.rbac.hasPermission(p)
        return false
      },
    },
  }
  return ctx
}

const PM_PERMS = (p: string) =>
  [
    'ocr_permission_audit:view_status',
    'ocr_permission_audit:audit_read',
    'ocr:review',
    'ocr:confirm',
    'ocr_privacy:export',
    'ocr_provider_observability:manage',
    'ocr_entity_link:explain',
  ].includes(p)

test.group('OcrPermissionAuditPolicy', () => {
  // ─── viewStatus ────────────────────────────────────────────────────────────
  test('viewStatus：项目管理员可查看权限状态', ({ assert }) => {
    const ctx = makeMockCtx({
      member: { role: 'project_manager' },
      rbac: { hasPermission: (p: string) => p === 'ocr_permission_audit:view_status' },
    })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isTrue(policy.viewStatus())
  })

  test('viewStatus：非成员不可查看', ({ assert }) => {
    const ctx = makeMockCtx({ member: null, rbac: { hasPermission: () => true } })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isFalse(policy.viewStatus())
  })

  test('viewStatus：成员缺权限拒绝', ({ assert }) => {
    const ctx = makeMockCtx()
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isFalse(policy.viewStatus())
  })

  // ─── 成员部分允许（3.5）───────────────────────────────────────────────────
  test('member 可 viewStatus 但不可 confirm/export/auditRead', ({ assert }) => {
    const ctx = makeMockCtx({
      member: { role: 'member' },
      rbac: { hasPermission: (p: string) => p === 'ocr_permission_audit:view_status' },
    })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isTrue(policy.viewStatus())
    assert.isFalse(policy.confirm())
    assert.isFalse(policy.export())
    assert.isFalse(policy.auditRead())
  })

  // ─── 只读降级（3.5）───────────────────────────────────────────────────────
  test('只读观察者不可 confirm/export/run/explain', ({ assert }) => {
    const ctx = makeMockCtx({
      member: { role: 'readonly_observer' },
      rbac: {
        hasPermission: (p: string) =>
          p === 'ocr_permission_audit:view_status' || p === 'ocr_permission_audit:audit_read',
      },
    })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isTrue(policy.viewStatus())
    assert.isTrue(policy.auditRead())
    assert.isFalse(policy.confirm())
    assert.isFalse(policy.export())
    assert.isFalse(policy.run())
    assert.isFalse(policy.explain())
  })

  // ─── 外部协作者隐藏（3.5）─────────────────────────────────────────────────
  test('外部协作者仅 viewStatus，敏感读被隐藏', ({ assert }) => {
    const ctx = makeMockCtx({
      member: { role: 'external_collaborator' },
      rbac: { hasPermission: (p: string) => p === 'ocr_permission_audit:view_status' },
    })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isTrue(policy.viewStatus())
    assert.isFalse(policy.sensitiveRead())
    assert.isFalse(policy.auditRead())
  })

  // ─── 跨组织掩蔽（3.5）─────────────────────────────────────────────────────
  test('跨组织（非成员）一律拒绝并断言抛 PermissionDenied', ({ assert }) => {
    const ctx = makeMockCtx({ member: null, rbac: { hasPermission: () => true } })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.throws(() => policy.assertAuditRead(), /无权/)
    assert.throws(() => policy.assertSensitiveRead(), /无权/)
  })

  // ─── 项目管理员允许（3.5）─────────────────────────────────────────────────
  test('项目管理员敏感读/确认/导出/审计读取均允许', ({ assert }) => {
    const ctx = makeMockCtx({
      member: { role: 'project_manager' },
      rbac: { hasPermission: PM_PERMS },
    })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    assert.isTrue(policy.sensitiveRead())
    assert.isTrue(policy.confirm())
    assert.isTrue(policy.export())
    assert.isTrue(policy.run())
    assert.isTrue(policy.explain())
    assert.isTrue(policy.auditRead())
  })

  // ─── resolveAllowedActions ────────────────────────────────────────────────
  test('resolveAllowedActions 反映最小权限', ({ assert }) => {
    const ctx = makeMockCtx({
      member: { role: 'project_manager' },
      rbac: { hasPermission: PM_PERMS },
    })
    const policy = new OcrPermissionAuditPolicy(ctx as any)
    const actions = policy.resolveAllowedActions()
    assert.include(actions, 'view_status')
    assert.include(actions, 'view_accepted')
    assert.include(actions, 'confirm')
    assert.include(actions, 'export_execute')
    assert.include(actions, 'view_audit')
  })
})
