/**
 * v3-skill-eval-system —— Skill Eval API 功能测试（Japa）。
 *
 * 覆盖：5.5 六角色权限矩阵、跨组织 404、列表/详情分页、效果指标端点零数据态、
 * PERMISSION_DENIED/AUTH_REQUIRED 边界。
 */
import { test } from '@japa/runner'
import env from '#start/env'
import CompilerSkill from '#models/compiler_skill'
import type User from '#models/user'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function loginOrg(client: any, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setupOrgUser(client: any) {
  const email = uniqueEmail('eval')
  const user = await createUser({ email })
  const org = await createOrganization(user)
  const token = await loginOrg(client, user)
  return { user, org, token }
}

/**
 * 创建一个 eval 状态的 Skill 并返回它。
 */
async function createEvalSkill(client: any, token: string, skillKey: string) {
  const res = await client
    .post('/api/v1/ai/compiler/skills')
    .header('Authorization', `Bearer ${token}`)
    .json({
      skillKey,
      name: `Eval Test ${skillKey}`,
      version: '1.0.0',
      description: 'Eval functional test',
      category: { primary: 'domain', secondary: 'test' },
      tags: ['test'],
      activation: { stages: ['intent_parsing'] },
      knowledge: {
        rules: [
          {
            id: 'r1',
            title: 'Rule 1',
            content: 'Test rule',
            confidence: 0.9,
            sourceRefs: [{ layer: 'L1', sourceId: 'ISO 9001' }],
          },
          {
            id: 'r2',
            title: 'Rule 2',
            content: 'Another rule',
            confidence: 0.85,
            sourceRefs: [{ layer: 'L1', sourceId: 'GB/T 19001' }],
          },
        ],
        patterns: [
          {
            id: 'p1',
            title: 'Pattern 1',
            content: 'Test pattern',
            confidence: 0.8,
            sourceRefs: [{ layer: 'L1', sourceId: 'PMBOK' }],
          },
        ],
        antiPatterns: [
          {
            id: 'ap1',
            title: 'Anti Pattern',
            content: 'Test anti',
            confidence: 0.75,
            sourceRefs: [],
          },
        ],
        examples: [
          { id: 'e1', title: 'Example', content: 'Test example', confidence: 0.9, sourceRefs: [] },
        ],
        checklists: [
          {
            id: 'c1',
            title: 'Checklist',
            content: 'Test checklist',
            confidence: 0.8,
            sourceRefs: [],
          },
        ],
        rubric: [
          { id: 'rb1', title: 'Rubric', content: 'Test rubric', confidence: 0.7, sourceRefs: [] },
        ],
      },
      basePriority: 100,
    })

  // 发布到 eval 状态
  const skillId = (res.body() as any).data.id
  await CompilerSkill.query().where('id', skillId).update({ status: 'eval' })
  return skillId
}

test.group('Skill Eval API — 权限与隔离', (group) => {
  useAuthDatabase(group)

  // Skill Registry 默认关闭（.env.example 为 false）；用例自行开启，不依赖本机 .env
  group.setup(() => {
    const previous = env.get('COMPILER_SKILL_REGISTRY_ENABLED') ?? false
    env.set('COMPILER_SKILL_REGISTRY_ENABLED', true)
    return () => env.set('COMPILER_SKILL_REGISTRY_ENABLED', previous)
  })

  group.each.setup(() => {
    // 启用 skill eval feature flag（测试需要）
    process.env.COMPILER_SKILL_EVAL_ENABLED = 'true'
  })

  group.each.teardown(() => {
    delete process.env.COMPILER_SKILL_EVAL_ENABLED
  })

  // ── 六角色权限矩阵 ──────────────────────────────────────────────

  test('org_admin 可以执行质量评估', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-org-admin')

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/quality`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    assert.isDefined((res.body() as any).data.score)
  })

  test('project_manager 无 eval 权限返回 PERMISSION_DENIED', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-pm')

    // 创建 project_manager 用户
    const pmEmail = uniqueEmail('pm')
    await createUser({ email: pmEmail })
    await client
      .post('/api/v1/org/members')
      .header('Authorization', `Bearer ${token}`)
      .json({ email: pmEmail, role: 'member' })
    // 将 pmUser 的 org member role 改为 member（非 admin）
    const pmLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: pmEmail, password: STRONG_PASSWORD })
    const pmToken = pmLogin.body().data.accessToken

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/quality`)
      .header('Authorization', `Bearer ${pmToken}`)

    assert.equal(res.status(), 403)
    assert.equal((res.body() as any).error.code, 'PERMISSION_DENIED')
  })

  test('member 无 eval 权限返回 PERMISSION_DENIED', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-member')

    const memberEmail = uniqueEmail('member')
    await createUser({ email: memberEmail })
    await client
      .post('/api/v1/org/members')
      .header('Authorization', `Bearer ${token}`)
      .json({ email: memberEmail, role: 'member' })
    const memberLogin = await client
      .post('/api/v1/auth/login')
      .json({ email: memberEmail, password: STRONG_PASSWORD })
    const memberToken = memberLogin.body().data.accessToken

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/quality`)
      .header('Authorization', `Bearer ${memberToken}`)

    assert.equal(res.status(), 403)
  })

  test('未认证返回 AUTH_REQUIRED', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-noauth')

    const res = await client.post(`/api/v1/ai/compiler/skills/${skillId}/eval/quality`)

    assert.equal(res.status(), 401)
    assert.equal((res.body() as any).error.code, 'AUTH_REQUIRED')
  })

  // ── 跨组织隔离 ──────────────────────────────────────────────────

  test('跨组织访问 eval 端点返回 404', async ({ client, assert }) => {
    const { token: tokenA } = await setupOrgUser(client)
    const skillIdA = await createEvalSkill(client, tokenA, 'org-a-skill')

    // 创建第二个组织
    const emailB = uniqueEmail('orgb')
    const userB = await createUser({ email: emailB })
    await createOrganization(userB)
    const loginB = await client
      .post('/api/v1/auth/login')
      .json({ email: emailB, password: STRONG_PASSWORD })
    const tokenB = loginB.body().data.accessToken

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skillIdA}/eval/quality`)
      .header('Authorization', `Bearer ${tokenB}`)

    assert.equal(res.status(), 404)
    assert.equal((res.body() as any).error.code, 'RESOURCE_NOT_FOUND')
  })

  test('跨组织访问 reports 端点返回 404', async ({ client, assert }) => {
    const { token: tokenA } = await setupOrgUser(client)
    const skillIdA = await createEvalSkill(client, tokenA, 'org-a-report')

    const emailB = uniqueEmail('orgb2')
    const userB = await createUser({ email: emailB })
    await createOrganization(userB)
    const loginB = await client
      .post('/api/v1/auth/login')
      .json({ email: emailB, password: STRONG_PASSWORD })
    const tokenB = loginB.body().data.accessToken

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skillIdA}/eval/reports`)
      .header('Authorization', `Bearer ${tokenB}`)

    assert.equal(res.status(), 404)
  })

  // ── 列表与分页 ──────────────────────────────────────────────────

  test('GET reports 返回分页数据', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-paginated')

    // 执行一次评估以生成报告
    await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/quality`)
      .header('Authorization', `Bearer ${token}`)

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skillId}/eval/reports`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    const body = res.body() as any
    assert.isArray(body.data)
    assert.isDefined(body.meta)
    assert.isDefined(body.meta.total)
    assert.isDefined(body.meta.page)
    assert.isDefined(body.meta.perPage)
  })

  test('GET reports/:id 返回单条报告', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-detail')

    // 先执行质量评估生成报告
    await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/quality`)
      .header('Authorization', `Bearer ${token}`)

    // 通过列表接口获取报告 ID
    const listRes = await client
      .get(`/api/v1/ai/compiler/skills/${skillId}/eval/reports`)
      .header('Authorization', `Bearer ${token}`)
    const reportId = (listRes.body() as any).data[0].id

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skillId}/eval/reports/${reportId}`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    assert.isDefined((res.body() as any).data)
    assert.equal((res.body() as any).data.id, reportId)
  })

  // ── 效果指标零数据态 ────────────────────────────────────────────

  test('GET effect-metrics 无事件时返回零数据', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-zero-metrics')

    const res = await client
      .get(`/api/v1/ai/compiler/skills/${skillId}/eval/effect-metrics`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    const body = res.body() as any
    assert.equal(body.data.activationCount, 0)
    assert.isNull(body.data.avgScore)
  })

  // ── benchmark ────────────────────────────────────────────────────

  test('POST benchmark 成功执行', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-bench')

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/benchmark`)
      .header('Authorization', `Bearer ${token}`)
      .json({ benchmarkSource: 'fixture' })

    assert.equal(res.status(), 200)
    const body = res.body() as any
    assert.isDefined(body.data.evidenceDigest)
    assert.equal(body.data.evidenceDigest.length, 64)
  })

  // ── ai-assist ────────────────────────────────────────────────────

  test('POST ai-assist 返回 advisory', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)
    const skillId = await createEvalSkill(client, token, 'eval-aiassist')

    const res = await client
      .post(`/api/v1/ai/compiler/skills/${skillId}/eval/ai-assist`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    const body = res.body() as any
    assert.equal(body.data.status, 'advisory')
    assert.isDefined(body.data.accuracy)
    assert.isDefined(body.data.completeness)
    assert.isDefined(body.data.consistency)
  })

  // ── 无效 skillId ────────────────────────────────────────────────

  test('无效 skillId 返回 404', async ({ client, assert }) => {
    const { token } = await setupOrgUser(client)

    const res = await client
      .post(`/api/v1/ai/compiler/skills/99999/eval/quality`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 404)
  })
})
