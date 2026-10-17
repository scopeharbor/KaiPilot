// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 集成测试
// v3-triz-contradiction-matrix-ui / tasks §7.4
//
// 测试覆盖：
// - 深链：直接访问矩阵页面路由
// - 预选 cell 状态：通过筛选器预选参数对
// - 未授权导航掩蔽：无权限用户看不到矩阵数据
// - stale 来源警告显示

import ProjectContradiction from '#models/project_contradiction'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const API_PREFIX = '/api/v1'

async function login(client: any, user: any) {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

async function seedTechnicalContradiction(args: {
  orgId: number
  projectId: number
  key: string
  improving?: string
  worsening?: string
  stale?: boolean
}) {
  return ProjectContradiction.create({
    organizationId: args.orgId,
    projectId: args.projectId,
    key: args.key,
    dedupeKey: `mxc-integ-dedupe-${args.key}`,
    type: 'technical',
    ruleId: 'CD-001',
    ruleVersion: '1.0.0',
    improvingParameterKey: (args.improving ?? 'duration') as any,
    worseningParameterKey: (args.worsening ?? 'cost') as any,
    improvingDirection: null,
    worseningDirection: null,
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    severity: 'high',
    confidence: 0.8,
    title: '集成测试技术矛盾',
    evidence: [],
    suggestedPrinciples: [
      { principleId: 'segmentation', name: '分割', relevance: 0.8, advice: '分段交付' },
    ],
    inputSignature: `sig-${args.key}`,
    outputHash: `hash-${args.key}`,
    status: 'confirmed',
    stale: args.stale ?? false,
    staleReason: args.stale ? '来源数据已变化' : null,
    relatedChangeRequestId: null,
    confirmedBy: null,
    confirmedAt: null,
    dismissedBy: null,
    dismissedAt: null,
    dismissReason: null,
    aiExplanation: null,
  })
}

test.group('V3 TRIZ 矛盾矩阵 集成测试 — 导航与预选', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('mxc-integ-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('深链：直接访问矩阵路由返回 200', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data
    assert.equal(matrix.projectId, project.id)
  })

  test('预选参数对：通过 parameterKey 筛选器聚焦特定参数', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-integ-preset-001',
      improving: 'duration',
      worsening: 'cost',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ parameterKey: 'duration' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    // 矩阵仍然返回完整结构（筛选器只影响后端查询，不影响矩阵完整性）
    assert.isArray(matrix.cells)
    assert.isObject(matrix.filters)
  })

  test('预选原理：通过 principleId 筛选器聚焦特定原理', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-integ-principle-001',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ principleId: 'segmentation' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data
    assert.isArray(matrix.cells)
  })

  test('未授权导航掩蔽：非项目成员访问不泄露矩阵数据', async ({ client, assert }) => {
    const owner1 = await createUser({ email: uniqueEmail('mxc-integ-owner-2') })
    const org = await createOrganization(owner1)
    const { project } = await createProjectWithMember(
      org,
      owner1,
      owner1,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // 创建另一个组织的用户（非项目成员）
    const otherUser = await createUser({ email: uniqueEmail('mxc-other-org') })
    const otherOrg = await createOrganization(otherUser)
    const otherToken = await login(client, otherUser)

    // 用 otherOrg 的组织上下文访问 org 的项目矩阵
    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${otherToken}`)
      .header('x-organization-id', String(otherOrg.id))

    // 非项目成员/跨组织访问 → 403 或空矩阵（不泄露数据）
    assert.isTrue(res.status() === 200 || res.status() === 403)

    if (res.status() === 200) {
      const matrix = (res.body() as { data: any }).data
      // 即使返回 200，scope.hasViewPermission 应为 false（不泄露矛盾数据）
      assert.equal(matrix.scope.hasViewPermission, false)
      assert.lengthOf(matrix.cells, 0)
    }
  })

  test('stale 来源警告显示：stale 矛盾在矩阵中标记 stale 状态', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-integ-stale-001',
      stale: true,
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ stale: 'stale_only' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    // 应有 stale 状态的 cell
    const staleCells = matrix.cells.filter((c: any) => c.state === 'stale')
    assert.isAbove(staleCells.length, 0)

    // stale cell 的 availableActions 不应包含 open_draft_review
    for (const cell of staleCells) {
      assert.notInclude(cell.availableActions, 'open_draft_review')
    }
  })

  test('矩阵包含 warningSummary 聚合', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-integ-warning-001',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    assert.isObject(matrix.warningSummary)
    assert.isNumber(matrix.warningSummary.total)
    assert.isNumber(matrix.warningSummary.blocking)
    assert.isNumber(matrix.warningSummary.warning)
    assert.isNumber(matrix.warningSummary.info)
    assert.isArray(matrix.warningSummary.codes)
  })

  test('矩阵包含 catalog 元数据用于前端渲染', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    assert.isObject(matrix.catalog)
    assert.isString(matrix.catalog.version)
    assert.isArray(matrix.catalog.parameters)
    assert.isArray(matrix.catalog.principleIds)
    assert.isString(matrix.catalog.rulesetVersion)
  })
})
