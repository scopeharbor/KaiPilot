import { test } from '@japa/runner'
import type Organization from '#models/organization'
import type User from '#models/user'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

test.group('组织级路由 RBAC 规则覆盖（v3-tech-debt-backlog-sweep §6.3）', (group) => {
  useAuthDatabase(group)

  let org: Organization
  let owner: User
  let viewer: User

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('org-owner') })
    org = await createOrganization(owner)

    // viewer 角色：只读观察者，缺乏管理权限及受限资源查看权限
    viewer = await createUser({ email: uniqueEmail('org-viewer') })
    await addOrgMember(org, viewer, 'viewer')
  })

  test('未登录（匿名）访问组织级端点族统一返回 401', async ({ client }) => {
    const endpoints = [
      `/api/v1/organizations/${org.id}/bi/custom-reports/registry`,
      `/api/v1/organizations/${org.id}/multi-project-dependencies`,
      `/api/v1/organizations/${org.id}/pmo/decision-workbench/cases`,
      `/api/v1/organizations/${org.id}/resource-contentions/summary`,
      `/api/v1/organizations/${org.id}/multi-project-impact-analyses`,
      `/api/v1/organizations/${org.id}/okrs/cycles`,
      `/api/v1/organizations/${org.id}/resource-demand-forecasting/summary`,
      `/api/v1/organizations/${org.id}/resource-pool/summary`,
      `/api/v1/organizations/${org.id}/resource-skill-matrix/summary`,
    ]

    for (const url of endpoints) {
      const res = await client.get(url)
      res.assertStatus(401)
    }
  })

  test('已登录但缺乏对应权限的用户访问写端点返回 403', async ({ client }) => {
    const token = await login(client, viewer.email)

    // 1. BI 自定义报表写端点（需要 REPORT_MANAGE）
    const resBi = await client
      .post(`/api/v1/organizations/${org.id}/bi/custom-reports/definitions`)
      .bearerToken(token)
      .json({ title: 'Test Report', schema: {} })
    resBi.assertStatus(403)

    // 2. 跨项目依赖确认写端点（需要 ORG_MANAGE）
    const resDep = await client
      .post(`/api/v1/organizations/${org.id}/multi-project-dependencies/confirm`)
      .bearerToken(token)
      .json({ dependencyId: 1 })
    resDep.assertStatus(403)

    // 3. PMO 决策工作台写端点（需要 PMO_DECISION_MANAGE）
    const resPmo = await client
      .post(`/api/v1/organizations/${org.id}/pmo/decision-workbench/cases`)
      .bearerToken(token)
      .json({ title: 'Test Decision Case' })
    resPmo.assertStatus(403)

    // 4. OKR 周期创建写端点（需要 ORG_MANAGE）
    const resOkr = await client
      .post(`/api/v1/organizations/${org.id}/okrs/cycles`)
      .bearerToken(token)
      .json({ title: 'Q1 OKR', startDate: '2026-01-01', endDate: '2026-03-31' })
    resOkr.assertStatus(403)

    // 5. 跨项目资源调配草案写端点（需要 RESOURCE_MANAGE）
    const resAlloc = await client
      .post(`/api/v1/organizations/${org.id}/cross-project-resource-allocations/drafts`)
      .bearerToken(token)
      .json({ name: 'Test Draft' })
    resAlloc.assertStatus(403)
  })

  test('已登录但缺乏特定领域读权限的用户访问受限读端点返回 403', async ({ client }) => {
    const token = await login(client, viewer.email)

    // 1. 资源争用检测（需要 RESOURCE_VIEW，viewer 无此权限）
    const resContention = await client
      .get(`/api/v1/organizations/${org.id}/resource-contentions/summary`)
      .bearerToken(token)
    resContention.assertStatus(403)

    // 3. 多项目影响分析（需要 MULTI_PROJECT_IMPACT_VIEW，viewer 无此权限）
    const resImpact = await client
      .get(`/api/v1/organizations/${org.id}/multi-project-impact-analyses`)
      .bearerToken(token)
    resImpact.assertStatus(403)

    // 4. 资源缺口解释（需要 AI_RESOURCE_GAP_EXPLAIN，viewer 无此权限）
    const resGapExplain = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/explanation`)
      .bearerToken(token)
    resGapExplain.assertStatus(403)

    // 5. 资源池摘要（需要 RESOURCE_VIEW，viewer 无此权限）
    const resPool = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/summary`)
      .bearerToken(token)
    resPool.assertStatus(403)

    // 6. 技能矩阵摘要（需要 RESOURCE_VIEW，viewer 无此权限）
    const resSkill = await client
      .get(`/api/v1/organizations/${org.id}/resource-skill-matrix/summary`)
      .bearerToken(token)
    resSkill.assertStatus(403)
  })
})
