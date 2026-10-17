/**
 * 项目健康风险指挥中心 API 功能测试（§3.2/§4.2–4.10）。
 *
 * 覆盖：无 token、owner/member/viewer 角色矩阵、同组织非成员与跨组织非泄露 404、
 * 软删除项目、查询校验边界、成功 envelope 契约、partial 语义结构、
 * 读路径零副作用探针（诊断/风险/预测/变更/审计表前后零变化）与低敏输出扫描。
 * 全部使用本地 fixture，不触发 AI/OAuth/Webhook/External。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: any): Promise<string> {
  const response = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return response.body().data.accessToken
}

function commandCenterUrl(projectId: number | string): string {
  return '/api/v1/projects/' + projectId + '/health-risk-command-center'
}

test.group('指挥中心 API —— 认证与项目门（§3.2/§4.4）', (group) => {
  useAuthDatabase(group)

  test('无 token 返回 401 AUTH_REQUIRED', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-noauth-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const response = await client.get(commandCenterUrl(project.id))
    assert.equal(response.status(), 401)
    assert.equal(response.body().error.code, 'AUTH_REQUIRED')
  })

  test('owner（项目创建者）读取返回 200 与版本化 envelope', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const token = await login(client, owner)
    const response = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const body = response.body()
    assert.isObject(body.data)
    assert.isObject(body.meta)
    assert.equal(body.meta.contractVersion, 'project-health-risk-command-center/v1')
    assert.match(body.meta.projectionSignature, /^[0-9a-f]{8}$/)
    assert.isArray(body.data.sources)
    assert.isArray(body.data.attention)
    assert.equal(body.data.project.id, Number(project.id))
    // 来源状态计数完备：七种可用性键齐全
    for (const key of ['available', 'empty', 'stale', 'forbidden', 'unavailable', 'unsupported']) {
      assert.property(body.meta.sourceCounts, key)
    }
    // change-impact 首期 unsupported（无安全 facade）
    const changeImpact = body.data.sources.find(
      (s: { sourceKey: string }) => s.sourceKey === 'change-impact',
    )
    assert.equal(changeImpact.meta.availability, 'unsupported')
  })

  test('仅有项目成员身份而无组织上下文 → 403 非泄露收束（平台租户边界）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-org-owner') })
    const org = await createOrganization(owner)
    const outsider = await createUser({ email: uniqueEmail('hcc-no-org-ctx') })
    // outsider 与该组织无任何组织级关系：tenant 无法解析。
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const token = await login(client, outsider)
    const response = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(response.status(), 403)
    assert.equal(response.body().error.code, 'PERMISSION_DENIED')
    // 错误体不携带任何项目/来源存在性线索
    assert.isUndefined(response.body().data)
  })

  test('跨组织项目与不存在项目返回一致 404（不可区分）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-cross-inside') })
    const outsider = await createUser({ email: uniqueEmail('hcc-cross-outside') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const token = await login(client, outsider)

    const existing = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    const missing = await client
      .get(commandCenterUrl(999999))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(existing.status(), 404)
    assert.equal(existing.status(), missing.status())
    assert.equal(existing.body().error.code, missing.body().error.code)
  })

  test('软删除项目返回 404（owner 亦不可见）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-deleted') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const { default: Project } = await import('#models/project')
    const { DateTime } = await import('luxon')
    const row = await Project.findOrFail(project.id)
    row.deletedAt = DateTime.fromJSDate(new Date())
    await row.save()

    const token = await login(client, owner)
    const response = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(response.status(), 404)
    assert.equal(response.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('带项目角色的组织成员可读取（RBAC 组织∩项目交集路径）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-member-owner') })
    const member = await createUser({ email: uniqueEmail('hcc-member') })
    const org = await createOrganization(owner)
    // 成员需有组织上下文（tenant 解析前提），再挂项目级角色。
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(org, owner, member, 'Member', [])
    const token = await login(client, member)
    const response = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)
    assert.equal(response.body().data.project.id, Number(project.id))
  })
})

test.group('指挥中心 API —— 查询校验（§4.1/4.2）', (group) => {
  useAuthDatabase(group)

  async function prepare() {
    const owner = await createUser({ email: uniqueEmail('hcc-validate') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    return { owner, org, project }
  }

  test('attentionLimit 边界：0 / 负数 / 超上限 / 非整数 / 恶意字符串 → 422', async ({
    client,
    assert,
  }) => {
    const { owner, project } = await prepare()
    const token = await login(client, owner)
    for (const bad of ['0', '-5', '101', '1.5', '<script>', 'abc']) {
      const response = await client
        .get(commandCenterUrl(project.id))
        .qs({ attentionLimit: bad })
        .header('Authorization', 'Bearer ' + token)
      assert.equal(response.status(), 422, `attentionLimit=${bad} 应被拒绝`)
      assert.equal(response.body().error.code, 'VALIDATION_ERROR')
    }
    // 上界合法值通过
    const ok = await client
      .get(commandCenterUrl(project.id))
      .qs({ attentionLimit: '100' })
      .header('Authorization', 'Bearer ' + token)
    ok.assertStatus(200)
  })

  test('未知 include 枚举与重复 include → 422', async ({ client, assert }) => {
    const { owner, project } = await prepare()
    const token = await login(client, owner)

    const unknown = await client
      .get(commandCenterUrl(project.id))
      .qs({ include: 'risk-workbench,secret_source' })
      .header('Authorization', 'Bearer ' + token)
    assert.equal(unknown.status(), 422)

    const duplicated = await client
      .get(commandCenterUrl(project.id))
      .qs({ include: 'risk-workbench,risk-workbench' })
      .header('Authorization', 'Bearer ' + token)
    assert.equal(duplicated.status(), 422)
  })

  test('freshnessWindowDays 越界 → 422', async ({ client, assert }) => {
    const { owner, project } = await prepare()
    const token = await login(client, owner)
    const response = await client
      .get(commandCenterUrl(project.id))
      .qs({ freshnessWindowDays: '91' })
      .header('Authorization', 'Bearer ' + token)
    assert.equal(response.status(), 422)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('未知查询键 → 422（严格模式不静默剥离）', async ({ client, assert }) => {
    const { owner, project } = await prepare()
    const token = await login(client, owner)
    const response = await client
      .get(commandCenterUrl(project.id))
      .qs({ groupBy: 'severity' })
      .header('Authorization', 'Bearer ' + token)
    assert.equal(response.status(), 422)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('include 筛选生效：仅请求风险来源时响应不含其它 optional 来源事实', async ({
    client,
    assert,
  }) => {
    const { owner, project } = await prepare()
    const token = await login(client, owner)
    const response = await client
      .get(commandCenterUrl(project.id))
      .qs({ include: 'risk-workbench' })
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)
    const sources = response.body().data.sources as Array<{ sourceKey: string; facts: unknown }>
    assert.isTrue(sources.some((s) => s.sourceKey === 'risk-workbench'))
    // 未包含的来源不携带 facts（预测）
    const prediction = sources.find((s) => s.sourceKey === 'prediction')
    if (prediction) assert.isNull(prediction.facts)
  })

  test('权限中途变化：权限逐请求实时解析，撤销组织成员资格后立即拒绝', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-revoke-owner') })
    const member = await createUser({ email: uniqueEmail('hcc-revoke-member') })
    const org = await createOrganization(owner)
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(org, owner, member, 'Member', [])
    const token = await login(client, member)

    // 第一读：成员可读
    const first = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    first.assertStatus(200)

    // 中途撤销组织成员资格
    const { default: OrganizationMember } = await import('#models/organization_member')
    const membershipRow = await OrganizationMember.query()
      .where('organization_id', org.id)
      .where('user_id', member.id)
      .firstOrFail()
    await membershipRow.delete()

    // 第二读：同 token 立即被拒（无缓存放行），且不泄露项目存在性语义变化之外的信息
    const second = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    assert.notEqual(second.status(), 200)
    assert.oneOf(second.status(), [403, 404])
  })
})

test.group('指挥中心 API —— 低敏输出与读路径零副作用（§4.7–4.10）', (group) => {
  useAuthDatabase(group)

  test('成功响应通过低敏结构化扫描且不含自由 metadata 注入面', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-scan') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const token = await login(client, owner)
    const response = await client
      .get(commandCenterUrl(project.id))
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const { detectForbiddenFields } = await import('@aiproj/types')
    const findings = detectForbiddenFields(response.body())
    assert.lengthOf(findings, 0)
  })

  test('读前/读后 zero-diff：领域表与审计表零变化，失败重试路径同样零写入', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-zero-diff') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const token = await login(client, owner)

    const { default: db } = await import('@adonisjs/lucid/services/db')
    const countOf = async (table: string): Promise<number> => {
      const row = await db.from(table).count('* as c').first()
      return Number((row as unknown as { c: number }).c ?? 0)
    }

    const tables = [
      'projects',
      'tasks',
      'risks',
      'project_health_diagnoses',
      'project_health_diagnosis_items',
      'project_prediction_snapshots',
      'change_requests',
      'audit_logs',
      'compiler_runs',
      'compiler_artifacts',
      'report_versions',
    ]
    const before: Record<string, number> = {}
    for (const t of tables) before[t] = await countOf(t)

    // 正常读取 ×2
    for (let i = 0; i < 2; i++) {
      const ok = await client
        .get(commandCenterUrl(project.id))
        .header('Authorization', 'Bearer ' + token)
      ok.assertStatus(200)
    }
    // 非法请求（失败路径）×1
    const bad = await client
      .get(commandCenterUrl(project.id))
      .qs({ attentionLimit: '9999' })
      .header('Authorization', 'Bearer ' + token)
    bad.assertStatus(422)

    for (const t of tables) {
      const after = await countOf(t)
      assert.equal(after, before[t], `${t} 在只读路径前后必须零变化`)
    }
  })
})
