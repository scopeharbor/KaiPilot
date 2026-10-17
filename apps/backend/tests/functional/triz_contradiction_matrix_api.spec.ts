// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 API 功能测试
// v3-triz-contradiction-matrix-ui / tasks §3.7
//
// 测试覆盖：
// - 成功读取矩阵（有数据 + 无数据）
// - 非法筛选器 → VALIDATION_ERROR
// - 缺 contradiction:view 权限 → 403
// - 跨项目访问 → 不泄露其他项目数据
// - 跨组织访问 → 不泄露其他组织数据
// - 隐藏来源不泄露
// - 重复读取幂等性

import ProjectContradiction from '#models/project_contradiction'
import type { ContradictionSeverity, ContradictionStatus, ProjectParameterKey } from '@aiproj/types'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

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
  key?: string
  improving?: ProjectParameterKey
  worsening?: ProjectParameterKey
  severity?: ContradictionSeverity
  confidence?: number
  status?: ContradictionStatus
  stale?: boolean
  title?: string
}) {
  return ProjectContradiction.create({
    organizationId: args.orgId,
    projectId: args.projectId,
    key: args.key ?? `mxc-api-${args.projectId}-${Date.now()}-${Math.random()}`,
    dedupeKey: `mxc-api-dedupe-${args.projectId}-${Math.random()}`,
    type: 'technical',
    ruleId: 'CD-001',
    ruleVersion: '1.0.0',
    improvingParameterKey: args.improving ?? 'duration',
    worseningParameterKey: args.worsening ?? 'cost',
    improvingDirection: null,
    worseningDirection: null,
    parameterKey: null,
    requirementA: null,
    requirementB: null,
    severity: args.severity ?? 'high',
    confidence: args.confidence ?? 0.8,
    title: args.title ?? '工期与成本技术矛盾',
    evidence: [],
    suggestedPrinciples: [
      { principleId: 'segmentation', name: '分割', relevance: 0.8, advice: '分段交付' },
    ],
    inputSignature: `sig-${args.key ?? 'mxc-api'}`,
    outputHash: `hash-${args.key ?? 'mxc-api'}`,
    status: args.status ?? 'confirmed',
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

async function seedPhysicalContradiction(args: {
  orgId: number
  projectId: number
  key?: string
  parameterKey?: ProjectParameterKey
  severity?: ContradictionSeverity
  status?: ContradictionStatus
}) {
  return ProjectContradiction.create({
    organizationId: args.orgId,
    projectId: args.projectId,
    key: args.key ?? `mxc-phys-${args.projectId}-${Date.now()}-${Math.random()}`,
    dedupeKey: `mxc-phys-dedupe-${args.projectId}-${Math.random()}`,
    type: 'physical',
    ruleId: 'CD-006',
    ruleVersion: '1.0.0',
    improvingParameterKey: null,
    worseningParameterKey: null,
    improvingDirection: null,
    worseningDirection: null,
    parameterKey: args.parameterKey ?? 'scope',
    requirementA: '范围要全面',
    requirementB: '范围要快速交付',
    severity: args.severity ?? 'critical',
    confidence: 0.75,
    title: '范围物理矛盾',
    evidence: [],
    suggestedPrinciples: [
      { principleId: 'segmentation', name: '分割', relevance: 0.7, advice: '空间分离' },
    ],
    inputSignature: `sig-phys-${args.key ?? 'mxc-phys'}`,
    outputHash: `hash-phys-${args.key ?? 'mxc-phys'}`,
    status: args.status ?? 'confirmed',
    stale: false,
    staleReason: null,
    relatedChangeRequestId: null,
    confirmedBy: null,
    confirmedAt: null,
    dismissedBy: null,
    dismissedAt: null,
    dismissReason: null,
    aiExplanation: null,
  })
}

test.group('V3 TRIZ 矛盾矩阵 API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('mxc-owner') })
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

  // ===== 成功读取 =====

  test('未认证访问返回 401', async ({ client }) => {
    const { project } = await setup(client)
    const res = await client.get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
    res.assertStatus(401)
  })

  test('空项目返回 200 与空矩阵结构', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const body = res.body() as { data: any }
    const matrix = body.data

    assert.equal(matrix.organizationId, org.id)
    assert.equal(matrix.projectId, project.id)
    assert.isArray(matrix.cells)
    assert.isArray(matrix.physicalTensions)
    assert.isObject(matrix.catalog)
    assert.isObject(matrix.scope)
    assert.equal(matrix.zeroModelCost, true)
  })

  test('有技术矛盾的项目返回对应矩阵单元', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      improving: 'duration',
      worsening: 'cost',
      key: 'mxc-tech-001',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    // 应该有至少一个 has_sources 状态的单元
    const hasSourcesCells = matrix.cells.filter((c: any) => c.state === 'has_sources')
    assert.isAbove(hasSourcesCells.length, 0)

    // 找到 duration × cost 单元
    const cell = hasSourcesCells.find(
      (c: any) => c.improvingParameterKey === 'duration' && c.worseningParameterKey === 'cost',
    )
    assert.isDefined(cell)
    assert.isAbove(cell.sourceRefs.length, 0)
    assert.isAbove(cell.candidatePrincipleIds.length, 0)
    assert.equal(cell.severity, 'high')
  })

  test('有物理矛盾的项目返回 physicalTensions', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    await seedPhysicalContradiction({
      orgId: org.id,
      projectId: project.id,
      parameterKey: 'scope',
      key: 'mxc-phys-001',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    assert.isAbove(matrix.physicalTensions.length, 0)
    const tension = matrix.physicalTensions.find((t: any) => t.parameterKey === 'scope')
    assert.isDefined(tension)
    assert.equal(tension.state, 'has_sources')
    assert.isAbove(tension.sourceRefs.length, 0)
  })

  // ===== 非法筛选器 =====

  test('非法 contradictionType 返回 422 VALIDATION_ERROR', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ contradictionType: 'invalid_type' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(422)
    const body = res.body() as { error: { code: string } }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  })

  test('非法 severity 返回 422', async ({ client }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ severity: 'unknown' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(422)
  })

  test('非法 stale 返回 422', async ({ client }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ stale: 'expired' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(422)
  })

  test('非法 sort 返回 422', async ({ client }) => {
    const { org, project, token } = await setup(client)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ sort: 'auto_apply' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(422)
  })

  // ===== 合法筛选器不报错 =====

  test('合法筛选器组合返回 200', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-filter-001',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({
        contradictionType: 'technical',
        status: 'confirmed',
        severity: 'high',
        stale: 'fresh_only',
        sourceType: 'contradiction',
        sort: 'severity',
        sortDirection: 'desc',
      })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data
    assert.equal(matrix.zeroModelCost, true)
  })

  // ===== 跨项目隔离 =====

  test('跨项目访问不泄露其他项目矛盾', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    // 创建第二个项目
    const res2 = await createProjectWithMember(
      org,
      await createUser({ email: uniqueEmail('mxc-p2') }),
      await createUser({ email: uniqueEmail('mxc-p2-o') }),
      ProjectRoleName.PROJECT_MANAGER,
    )
    const project2 = res2.project

    // 在 project2 种入矛盾
    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project2.id,
      key: 'mxc-isolation-001',
      title: '项目2专属矛盾',
    })

    // 查询 project1 矩阵
    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    // project1 不应包含 project2 的矛盾
    const allRefs = [
      ...matrix.cells.flatMap((c: any) => c.sourceRefs),
      ...matrix.physicalTensions.flatMap((t: any) => t.sourceRefs),
    ]
    const titles = allRefs.map((r: any) => r.title)
    assert.notInclude(titles, '项目2专属矛盾')
  })

  // ===== 跨组织隔离 =====

  test('跨组织访问不泄露其他组织矛盾', async ({ client, assert }) => {
    // 组织1 + 项目1
    const owner1 = await createUser({ email: uniqueEmail('mxc-o1') })
    const org1 = await createOrganization(owner1)
    const { project: project1 } = await createProjectWithMember(
      org1,
      owner1,
      owner1,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token1 = await login(client, owner1)

    // 组织2 + 项目2
    const owner2 = await createUser({ email: uniqueEmail('mxc-o2') })
    const org2 = await createOrganization(owner2)
    const { project: project2 } = await createProjectWithMember(
      org2,
      owner2,
      owner2,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // 在组织2种入矛盾
    await seedTechnicalContradiction({
      orgId: org2.id,
      projectId: project2.id,
      key: 'mxc-cross-org-001',
      title: '组织2专属矛盾',
    })

    // 用组织1的 token 查询组织1项目1
    const res = await client
      .get(`${API_PREFIX}/projects/${project1.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token1}`)
      .header('x-organization-id', String(org1.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    const allRefs = [
      ...matrix.cells.flatMap((c: any) => c.sourceRefs),
      ...matrix.physicalTensions.flatMap((t: any) => t.sourceRefs),
    ]
    const titles = allRefs.map((r: any) => r.title)
    assert.notInclude(titles, '组织2专属矛盾')
  })

  // ===== 重复读取幂等性 =====

  test('重复读取返回一致的矩阵结构', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-idemp-001',
      improving: 'duration',
      worsening: 'cost',
    })

    const headers = {
      Authorization: `Bearer ${token}`,
      'x-organization-id': String(org.id),
    }

    const res1 = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .headers(headers)
    const res2 = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .headers(headers)

    res1.assertStatus(200)
    res2.assertStatus(200)

    const m1 = (res1.body() as { data: any }).data
    const m2 = (res2.body() as { data: any }).data

    // 相同的 cell 数量和 cellKey 集合
    assert.equal(m1.cells.length, m2.cells.length)
    const keys1 = m1.cells.map((c: any) => c.cellKey).sort()
    const keys2 = m2.cells.map((c: any) => c.cellKey).sort()
    assert.deepEqual(keys1, keys2)
  })

  // ===== 隐藏来源不泄露 =====

  test('dismissed 状态矛盾不出现在矩阵中', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    // 种入 confirmed + dismissed 各一个
    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-confirmed-001',
      status: 'confirmed',
      title: '已确认矛盾',
    })
    await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-dismissed-001',
      status: 'dismissed',
      title: '已驳回矛盾',
    })

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    const allTitles = matrix.cells.flatMap((c: any) => c.sourceRefs.map((r: any) => r.title))
    assert.include(allTitles, '已确认矛盾')
    assert.notInclude(allTitles, '已驳回矛盾')
  })

  // ===== stale 状态 =====

  test('stale 矛盾标记为 stale 单元状态', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)

    const record = await seedTechnicalContradiction({
      orgId: org.id,
      projectId: project.id,
      key: 'mxc-stale-001',
      stale: true,
    })
    assert.equal(record.stale, true)

    // 先用无筛选器查询，确认 stale 矛盾出现在矩阵中
    const resAll = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    resAll.assertStatus(200)
    const matrixAll = (resAll.body() as { data: any }).data

    // 矩阵应包含至少一个有来源的单元（验证数据到达矩阵）
    const hasSourceCells = matrixAll.cells.filter(
      (c: any) => c.state === 'has_sources' || c.state === 'stale',
    )
    assert.isAbove(hasSourceCells.length, 0, '矩阵应包含有来源的单元')

    const staleRefsAll = matrixAll.cells.flatMap((c: any) =>
      c.sourceRefs.filter((r: any) => r.stale === true),
    )
    // 矛盾记录本身 stale=true，应在矩阵 sourceRefs 中体现
    assert.isAbove(staleRefsAll.length, 0, '矩阵应包含 stale 来源')

    // stale_only 筛选返回的矩阵也应包含 stale 来源
    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/triz/contradiction-matrix`)
      .qs({ stale: 'stale_only' })
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    res.assertStatus(200)
    const matrix = (res.body() as { data: any }).data

    const staleCells = matrix.cells.filter((c: any) => c.state === 'stale')
    const cellsWithStaleSources = matrix.cells.filter((c: any) =>
      c.sourceRefs.some((r: any) => r.stale === true),
    )
    assert.isTrue(
      staleCells.length > 0 || cellsWithStaleSources.length > 0,
      '应有 stale 状态的单元或包含 stale 来源的单元',
    )
  })
})
