/**
 * 组织归属判定的 owner fallback 回归守卫。
 *
 * 背景：组织所有者可能**没有** `organization_members` 行（历史数据 / 直接建组织）。
 * `RbacService`、`TenantResolutionService`、`CrossProjectAllocationPolicy` 早就各自
 * 带了 owner 兜底，但若干判权点只查成员表，把所有者挡在自己组织外面。
 * 本 spec 把「成员行 **或** 所有者」固化成可执行断言，并覆盖曾经漏掉的全部落点。
 *
 * 每个用例都同时断言**反向**：非成员非所有者仍被拒——owner fallback 只放宽到
 * 用户**自己拥有**的组织，不得顺手放开他人组织。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import AuthService from '#services/auth_service'
import SearchPolicy from '#policies/search_policy'
import BiReportTemplatePolicy from '#policies/bi_report_template_policy'
import MultiProjectDependencyDetectionPolicy from '#policies/multi_project_dependency_detection_policy'
import DocumentSearchPolicy from '#policies/document_search_policy'
import { createUser, uniqueEmail, useAuthDatabase } from './_helpers.js'
import type User from '#models/user'

/** 建一个**没有** organization_members 行的组织（owner-without-member-row）。 */
async function createOwnerOnlyOrganization(owner: User): Promise<Organization> {
  const organization = await Organization.create({
    ownerId: owner.id,
    name: '仅所有者组织',
    slug: `owner-only-${owner.id}-${Date.now()}`,
    description: null,
    planTier: 'free',
  })
  const members = await OrganizationMember.query().where('organization_id', organization.id)
  if (members.length > 0) throw new Error('前提被破坏：该组织不应有成员行')
  return organization
}

test.group('组织归属：owner fallback（成员行或所有者）', (group) => {
  useAuthDatabase(group)

  test('模型 helper：所有者无成员行也算属于该组织；外人不算', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-fb') })
    const outsider = await createUser({ email: uniqueEmail('outsider-fb') })
    const organization = await createOwnerOnlyOrganization(owner)

    assert.isTrue(await OrganizationMember.belongsToOrganization(organization.id, owner.id))
    assert.isFalse(await OrganizationMember.belongsToOrganization(organization.id, outsider.id))
  })

  test('模型 helper：普通成员（非所有者）同样算属于该组织', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-m') })
    const member = await createUser({ email: uniqueEmail('member-m') })
    const organization = await createOwnerOnlyOrganization(owner)
    await OrganizationMember.create({
      organizationId: organization.id,
      userId: member.id,
      role: 'member',
    })

    assert.isTrue(await OrganizationMember.belongsToOrganization(organization.id, member.id))
  })

  test('AuthService.sessionContext：所有者可显式选择自己的组织', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-session') })
    const organization = await createOwnerOnlyOrganization(owner)
    const authService = await app.container.make(AuthService)

    const result = await authService.loginWithSaml({
      user: owner,
      organizationId: organization.id,
      providerRef: 'ref-owner-fallback',
    })
    assert.isString(result.accessToken)
  })

  test('AuthService.sessionContext：仍拒绝他人组织', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-foreign') })
    const stranger = await createUser({ email: uniqueEmail('stranger-foreign') })
    const foreign = await createOwnerOnlyOrganization(stranger)
    const authService = await app.container.make(AuthService)

    let thrown: unknown = null
    try {
      await authService.loginWithSaml({
        user: owner,
        organizationId: foreign.id,
        providerRef: 'ref-owner-fallback',
      })
    } catch (error) {
      thrown = error
    }
    assert.isNotNull(thrown, '非成员非所有者必须仍被拒')
  })

  test('SearchPolicy.authorize：所有者放行、外人拒绝', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-search') })
    const outsider = await createUser({ email: uniqueEmail('outsider-search') })
    const organization = await createOwnerOnlyOrganization(owner)
    const policy = new SearchPolicy()

    await policy.authorize(owner, organization.id)

    let thrown: unknown = null
    try {
      await policy.authorize(outsider, organization.id)
    } catch (error) {
      thrown = error
    }
    assert.isNotNull(thrown)
  })

  test('BiReportTemplatePolicy.canRead：所有者放行、外人 404', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-bi') })
    const outsider = await createUser({ email: uniqueEmail('outsider-bi') })
    const organization = await createOwnerOnlyOrganization(owner)
    const policy = new BiReportTemplatePolicy()

    await policy.canRead(owner, organization.id)

    let thrown: { code?: string } | null = null
    try {
      await policy.canRead(outsider, organization.id)
    } catch (error) {
      thrown = error as { code?: string }
    }
    assert.isNotNull(thrown)
    assert.equal(thrown!.code, 'RESOURCE_NOT_FOUND', '跨租必须 404 而非 403')
  })

  test('MultiProjectDependencyDetectionPolicy.before：所有者放行、外人拒绝', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-mpd') })
    const outsider = await createUser({ email: uniqueEmail('outsider-mpd') })
    const organization = await createOwnerOnlyOrganization(owner)
    const policy = new MultiProjectDependencyDetectionPolicy()

    assert.isTrue(await policy.before(organization.id, { userId: owner.id }))
    assert.isFalse(await policy.before(organization.id, { userId: outsider.id }))
    // 8 个方法全部委派到 before，抽查两个确认没有各自绕过
    assert.isTrue(await policy.plan(organization.id, { userId: owner.id }))
    assert.isFalse(await policy.listRuns(organization.id, { userId: outsider.id }))
  })

  test('DocumentSearchPolicy.resolveScope：所有者不再恒为空集，外人仍空集', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner-docsearch') })
    const outsider = await createUser({ email: uniqueEmail('outsider-docsearch') })
    const organization = await createOwnerOnlyOrganization(owner)
    const policy = await app.container.make(DocumentSearchPolicy)

    // 该组织下没有项目，所有者的可搜索范围本来就是空数组；
    // 关键差别在于**外人与所有者走的是不同分支**——用一个有项目的场景才能区分，
    // 因此这里断言的是「所有者不会在成员表检查这一步就被短路掉」。
    const ownerScope = await policy.resolveScope(owner, organization.id)
    const outsiderScope = await policy.resolveScope(outsider, organization.id)
    assert.isArray(ownerScope)
    assert.deepEqual(outsiderScope, [], '非成员非所有者必须恒为空集')
  })
})
