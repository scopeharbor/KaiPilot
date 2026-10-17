/**
 * v3-copilot-authoritative-page-context —— 回合端点页面语境 functional 测试（任务 1.3）。
 *
 * 覆盖（API 级负向/正向矩阵）：
 * - 已授权项目 + 筛选 → 披露 ready（项目/筛选/时间），turn 仍正常完成（零域写）
 * - 跨组织伪造 projectId → disclosure context_unavailable 且响应不含 foreign id
 * - 过期项目（软删除）→ context_unavailable，不生成伪项目事实
 * - 非法 entity ref / 非法 descriptor → 无披露、turn 不受影响（fail-closed 不炸）
 * - 全局模式 → disclosure ready 且无项目事实
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Project from '#models/project'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/copilot/turns'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function setupActor(prefix: string) {
  const owner = await createUser({ email: uniqueEmail(prefix) })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

function kanbanDescriptor(projectId: number, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    routeId: 'project-kanban',
    pathname: `/projects/${projectId}/(views)/kanban`,
    projectId,
    viewId: 'kanban',
    filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
    routeRevision: `rev-${projectId}`,
    ...overrides,
  }
}

test.group('Copilot 回合端点 —— 页面语境（v3-copilot-authoritative-page-context）', (group) => {
  useAuthDatabase(group)

  const baseJson = {
    sessionId: null,
    mentions: [],
    scope: 'project',
    attribution: {} as Record<string, unknown>,
  }

  test('已授权项目 + 页面筛选 → 披露 ready（项目/筛选/隐私说明）且零域写', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupActor('pc-ready')
    const token = await login(client, owner.email)
    const before = (await Task.query()
      .where('project_id', project.id)
      .count('* as total')) as unknown as Array<{ total: number }>

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        ...baseJson,
        attribution: { organizationId: org.id, projectId: project.id },
        text: '这个项目有哪些阻塞？',
        pageContext: kanbanDescriptor(project.id),
      })

    res.assertStatus(200)
    const disclosure = (res.body().data as Record<string, any>).pageContextDisclosure
    assert.isObject(disclosure)
    assert.equal(disclosure?.status, 'ready')
    assert.equal(disclosure?.projectId, project.id)
    assert.equal(disclosure?.routeId, 'project-kanban')
    assert.deepEqual(disclosure?.filters, [{ key: 'status', op: 'eq', value: 'blocked' }])
    assert.isString(disclosure?.observedAt)
    assert.include(disclosure?.privacyNote ?? '', '不读取屏幕像素')

    const after = (await Task.query()
      .where('project_id', project.id)
      .count('* as total')) as unknown as Array<{ total: number }>
    assert.equal(after[0].total, before[0].total, '页面语境回合不得产生任何正式写')
  })

  test('跨组织伪造 projectId → context_unavailable 且响应不含 foreign id', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupActor('pc-cross')
    const otherOwner = await createUser({ email: uniqueEmail('pc-other-owner') })
    const other = await createOrganization(otherOwner)
    const { project: foreignProject } = await createProjectWithMember(
      other,
      otherOwner,
      otherOwner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        ...baseJson,
        attribution: { organizationId: org.id, projectId: project.id },
        text: '这个项目有多少任务？',
        pageContext: kanbanDescriptor(foreignProject.id), // 伪造另一组织的项目
      })

    res.assertStatus(200)
    const data = res.body().data as Record<string, any>
    const disclosure = data.pageContextDisclosure
    assert.equal(disclosure?.status, 'context_unavailable')
    assert.isUndefined(disclosure?.projectId)
    // 未授权项目的 ID 不得作为授权 projectId 出现在披露（精确匹配，避免数字串误报）
    assert.notMatch(
      res.text(),
      new RegExp(`"projectId"\\s*:\\s*${String(foreignProject.id)}(?:[,}])`),
    )
    // 未授权项目的名称不得出现在响应
    assert.notInclude(res.text(), foreignProject.name ?? '')
  })

  test('过期项目（软删除）→ attribution 层 fail-closed（不泄露），resolver 层另有单元矩阵', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupActor('pc-expired')
    // 软删除项目
    const row = await Project.query().where('id', project.id).first()
    if (row) {
      row.deletedAt = DateTime.now()
      await row.save()
    }
    const token = await login(client, owner.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        ...baseJson,
        attribution: { organizationId: org.id, projectId: project.id },
        text: '进度如何？',
        pageContext: kanbanDescriptor(project.id),
      })

    // 软删除项目已不在可访问项目集合 → attribution 授权在 controller 层即拒绝
    // （fail-closed 分层：resolver 的 project-not-found 路径由单元测试覆盖）。
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    assert.notInclude(res.text(), '进度')
    assert.notInclude(res.text(), `"projectId":${project.id}`)
  })

  test('非法 entity ref（id=0）→ descriptor 拒绝，turn 仍正常完成且无披露', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupActor('pc-illegal')
    const token = await login(client, owner.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        ...baseJson,
        attribution: { organizationId: org.id, projectId: project.id },
        text: '有哪些风险？',
        pageContext: kanbanDescriptor(project.id, {
          selectedEntityRefs: [{ kind: 'task', id: 0 }], // 非法 ID
        }),
      })

    res.assertStatus(200)
    const data = res.body().data as Record<string, any>
    assert.isUndefined(data.pageContextDisclosure, '非法 descriptor 不产生任何披露')
  })

  test('global 页面语境 → disclosure ready 且无项目事实', async ({ client, assert }) => {
    const { owner } = await setupActor('pc-global')
    const token = await login(client, owner.email)

    const res = await client
      .post(BASE)
      .bearerToken(token)
      .json({
        sessionId: null,
        mentions: [],
        scope: 'global',
        attribution: {},
        text: '什么是关键路径',
        pageContext: {
          version: 1,
          routeId: 'global',
          pathname: '/',
          routeRevision: 'rev-global',
        },
      })

    res.assertStatus(200)
    const disclosure = (res.body().data as Record<string, any>).pageContextDisclosure
    assert.equal(disclosure?.routeId, 'global')
    assert.equal(disclosure?.status, 'ready')
    assert.isUndefined(disclosure?.projectId)
  })
})
