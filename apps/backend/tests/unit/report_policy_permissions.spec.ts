import { test } from '@japa/runner'
import { CanonicalRole, getRolePermissionSet } from '#start/rbac/roles'
import { REPORT_VIEW, REPORT_CREATE, REPORT_EXPORT, REPORT_DOWNLOAD } from '#rbac'

/**
 * ReportPolicy - RBAC 角色权限映射（tasks 2.5）。
 *
 * 直接检查 `ROLE_PERMISSIONS` 表，避免拉起 DB/HTTP 层。功能层的越权矩阵
 * 已在 `tests/functional/reports/reports.spec.ts` 覆盖端到端；此处仅锁定
 * "哪些角色具备哪些能力"的静态映射，防止后续误改 roles.ts 时静默改变边界。
 */
test.group('ReportPolicy - RBAC 角色权限矩阵', () => {
  test('org_admin：view / create / export / download 全通', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.ORG_ADMIN)
    assert.isTrue(perms.has(REPORT_VIEW))
    assert.isTrue(perms.has(REPORT_CREATE))
    assert.isTrue(perms.has(REPORT_EXPORT))
    assert.isTrue(perms.has(REPORT_DOWNLOAD))
  })

  test('project_manager：view / create / export / download 全通', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.PROJECT_MANAGER)
    assert.isTrue(perms.has(REPORT_VIEW))
    assert.isTrue(perms.has(REPORT_CREATE))
    assert.isTrue(perms.has(REPORT_EXPORT))
    assert.isTrue(perms.has(REPORT_DOWNLOAD))
  })

  test('member：仅 view，无 create/export/download', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.MEMBER)
    assert.isTrue(perms.has(REPORT_VIEW))
    assert.isFalse(perms.has(REPORT_CREATE))
    assert.isFalse(perms.has(REPORT_EXPORT))
    assert.isFalse(perms.has(REPORT_DOWNLOAD))
  })

  test('external_collaborator：无任何 report:* 权限', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.EXTERNAL_COLLABORATOR)
    assert.isFalse(perms.has(REPORT_VIEW))
    assert.isFalse(perms.has(REPORT_CREATE))
    assert.isFalse(perms.has(REPORT_EXPORT))
    assert.isFalse(perms.has(REPORT_DOWNLOAD))
  })

  test('readonly_observer：仅 view，无 create/export/download', ({ assert }) => {
    const perms = getRolePermissionSet(CanonicalRole.READONLY_OBSERVER)
    assert.isTrue(perms.has(REPORT_VIEW))
    assert.isFalse(perms.has(REPORT_CREATE))
    assert.isFalse(perms.has(REPORT_EXPORT))
    assert.isFalse(perms.has(REPORT_DOWNLOAD))
  })
})

/**
 * 直接单测 authorize* 分支：功能层已通过 controller 走过 happy path 与 403 路径，
 * 但覆盖率工具无法从 controller 反溯到 Policy 内部的 throw 行；此处用 stub 拉起
 * ReportPolicy 本体，两条分支各走一次，把 report_policy.ts 拉满。
 */
test.group('ReportPolicy - authorize* 分支覆盖', () => {
  async function makePolicy(allowed: boolean, isSuperAdmin = false) {
    const { default: ReportPolicy } = await import('#policies/report_policy')
    const stubRbac = {
      async check() {
        return { allowed }
      },
    } as any
    const policy = new ReportPolicy(stubRbac)
    const user = { isSuperAdmin } as any
    return { policy, user }
  }

  test('view / generate / export / download —— allowed 全通', async ({ assert }) => {
    const { policy, user } = await makePolicy(true)
    assert.isTrue(await policy.view(user, 1, 1))
    assert.isTrue(await policy.generate(user, 1, 1))
    assert.isTrue(await policy.export(user, 1, 1))
    assert.isTrue(await policy.download(user, 1, 1))
    // authorize* 不抛
    await policy.authorizeView(user, 1, 1)
    await policy.authorizeGenerate(user, 1, 1)
    await policy.authorizeExport(user, 1, 1)
    await policy.authorizeDownload(user, 1, 1)
  })

  test('super admin：allows 早退返回 true', async ({ assert }) => {
    const { policy, user } = await makePolicy(false, true)
    assert.isTrue(await policy.view(user, 1, 1))
    assert.isTrue(await policy.generate(user, 1, 1))
    assert.isTrue(await policy.export(user, 1, 1))
    assert.isTrue(await policy.download(user, 1, 1))
  })

  test('denied：authorize* 全部抛 PermissionDeniedException', async ({ assert }) => {
    const { policy, user } = await makePolicy(false)
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    await assert.rejects(() => policy.authorizeView(user, 1, 1), PermissionDeniedException as any)
    await assert.rejects(
      () => policy.authorizeGenerate(user, 1, 1),
      PermissionDeniedException as any,
    )
    await assert.rejects(() => policy.authorizeExport(user, 1, 1), PermissionDeniedException as any)
    await assert.rejects(
      () => policy.authorizeDownload(user, 1, 1),
      PermissionDeniedException as any,
    )
  })
})
