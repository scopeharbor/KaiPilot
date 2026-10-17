/**
 * ObservabilityRetentionPolicy — 权限测试（纯 vitest）。
 *
 * 验证四个方法改走后 RBAC 权限求值路径：
 * - view → OCR_RETENTION_VIEW
 * - manage → OCR_RETENTION_MANAGE
 * - export → AI_QUALITY_COST_CONSOLE_EXPORT
 * - cleanup → OCR_RETENTION_CLEANUP
 *
 * 用 vi.mock 桩掉 RbacService，避免单元测试拉起 AdonisJS 运行时。
 */
import { describe, it, expect, vi } from 'vitest'
import type { HttpContext } from '@adonisjs/core/http'

const RbacServiceMock = class {}
vi.mock('../../app/services/rbac_service.js', () => ({
  default: RbacServiceMock,
}))

const PermissionDeniedException = class extends Error {
  constructor(public message: string) {
    super(message)
  }
}
vi.mock('../../app/exceptions/api_exception.js', () => ({
  PermissionDeniedException,
}))

const { default: ObservabilityRetentionPolicy } =
  await import('../../app/policies/observability_retention_policy.js')

function createCtx(): HttpContext {
  return {
    auth: { user: { id: 1 } },
    tenant: { organizationId: 1 },
  } as unknown as HttpContext
}

function createRbacStub(permissions: string[]) {
  return {
    check: vi.fn().mockImplementation((_user, permission) => ({
      allowed: permissions.includes(permission),
      reason: permissions.includes(permission) ? 'organization' : 'permission_not_granted',
    })),
  }
}

describe('ObservabilityRetentionPolicy', () => {
  const matrix: { method: string; permission: string }[] = [
    { method: 'viewRetentionPolicy', permission: 'ocr_retention:view' },
    { method: 'manageRetentionPolicy', permission: 'ocr_retention:manage' },
    { method: 'exportRetentionPolicy', permission: 'ai_quality_cost_console:export' },
    { method: 'manageCleanup', permission: 'ocr_retention:cleanup' },
  ]

  it.each(matrix)('$method 在拥有 $permission 时返回 true', async ({ method, permission }) => {
    const policy = new ObservabilityRetentionPolicy(createRbacStub([permission]) as never)
    const result = await (policy as any)[method](createCtx())
    expect(result).toBe(true)
  })

  it.each(matrix)('$method 在无权限时返回 false', async ({ method }) => {
    const policy = new ObservabilityRetentionPolicy(
      createRbacStub(['some:other:permission']) as never,
    )
    const result = await (policy as any)[method](createCtx())
    expect(result).toBe(false)
  })

  it('assertView 在无权时抛出 PermissionDeniedException', async () => {
    const policy = new ObservabilityRetentionPolicy(createRbacStub([]) as never)
    await expect(policy.assertView(createCtx())).rejects.toThrow('无权查看保留策略')
  })

  it('assertManage 在有权时通过', async () => {
    const policy = new ObservabilityRetentionPolicy(
      createRbacStub(['ocr_retention:manage']) as never,
    )
    await expect(policy.assertManage(createCtx())).resolves.toBeUndefined()
  })

  it('未登录时所有方法返回 false', async () => {
    const policy = new ObservabilityRetentionPolicy(
      createRbacStub([
        'ocr_retention:view',
        'ocr_retention:manage',
        'ocr_retention:cleanup',
      ]) as never,
    )
    const ctx = { auth: { user: null }, tenant: { organizationId: 1 } } as unknown as HttpContext
    expect(await policy.viewRetentionPolicy(ctx)).toBe(false)
    expect(await policy.manageRetentionPolicy(ctx)).toBe(false)
    expect(await policy.exportRetentionPolicy(ctx)).toBe(false)
    expect(await policy.manageCleanup(ctx)).toBe(false)
  })

  it('缺少租户上下文时所有方法返回 false', async () => {
    const policy = new ObservabilityRetentionPolicy(
      createRbacStub([
        'ocr_retention:view',
        'ocr_retention:manage',
        'ocr_retention:cleanup',
      ]) as never,
    )
    const ctx = { auth: { user: { id: 1 } }, tenant: null } as unknown as HttpContext
    expect(await policy.viewRetentionPolicy(ctx)).toBe(false)
    expect(await policy.manageRetentionPolicy(ctx)).toBe(false)
    expect(await policy.exportRetentionPolicy(ctx)).toBe(false)
    expect(await policy.manageCleanup(ctx)).toBe(false)
  })
})
