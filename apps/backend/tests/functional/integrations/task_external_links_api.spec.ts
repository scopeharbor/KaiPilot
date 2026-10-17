import { ProjectRoleName } from '#rbac'
import Task from '#models/task'
import TaskExternalLink from '#models/task_external_link'
import IntegrationConnection from '#models/integration_connection'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { test } from '@japa/runner'
import {
  addOrgMember,
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'
import { CanonicalRole, ROLE_PERMISSIONS } from '#rbac'
import { DateTime } from 'luxon'

test.group('Task External Links API', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const email = uniqueEmail('ext-link-api')
    const owner = await createUser({ email, isSuperAdmin: true })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await Task.create({
      projectId: project.id,
      name: '外部链接测试任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    })
    return { owner, org, project, task, email }
  }

  async function login(client: any, email: string) {
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
    return loginRes.body().data.accessToken as string
  }

  async function createGitHubLink(
    orgId: number,
    projectId: number,
    taskId: number,
    userId: number,
  ) {
    return TaskExternalLink.create({
      organizationId: orgId,
      projectId,
      taskId,
      provider: 'github',
      linkType: 'issue',
      repositoryOwner: 'test-owner',
      repositoryName: 'test-repo',
      externalNumber: 42,
      externalId: null,
      externalTitle: 'Original Issue',
      externalStatus: 'open',
      statusSource: 'manual',
      externalUrl: 'https://github.com/test-owner/test-repo/issues/42',
      note: null,
      metadata: null,
      lastObservedAt: DateTime.utc().minus({ days: 1 }),
      createdBy: userId,
      updatedBy: userId,
    })
  }

  async function createGitHubPrLink(
    orgId: number,
    projectId: number,
    taskId: number,
    userId: number,
    externalNumber = 77,
  ) {
    return TaskExternalLink.create({
      organizationId: orgId,
      projectId,
      taskId,
      provider: 'github',
      linkType: 'pull_request',
      repositoryOwner: 'test-owner',
      repositoryName: 'test-repo',
      externalNumber,
      externalId: null,
      externalTitle: 'Original PR',
      externalStatus: 'open',
      statusSource: 'manual',
      externalUrl: `https://github.com/test-owner/test-repo/pull/${externalNumber}`,
      note: null,
      metadata: null,
      lastObservedAt: DateTime.utc().minus({ days: 1 }),
      createdBy: userId,
      updatedBy: userId,
    })
  }

  async function createGitHubConnection(
    orgId: number,
    userId: number,
    accessToken: string = 'gho_valid_token',
  ) {
    const cipher = new IntegrationTokenCipher()
    return IntegrationConnection.create({
      organizationId: orgId,
      userId,
      provider: 'github',
      status: 'connected',
      accessTokenEncrypted: cipher.encrypt(accessToken),
      refreshTokenEncrypted: null,
      tokenType: 'Bearer',
      expiresAt: DateTime.now().plus({ days: 1 }),
      connectedAt: DateTime.now(),
      externalAccountId: `gh-${userId}`,
      externalAccountEmail: `user-${userId}@example.com`,
      scopesJson: ['read:user', 'user:email'],
    })
  }

  async function addProjectRoleMember(
    projectId: number,
    userId: number,
    roleName: ProjectRoleName,
  ) {
    const rolePermissionsByName: Record<ProjectRoleName, string[]> = {
      [ProjectRoleName.OWNER]: [...ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]],
      [ProjectRoleName.PROJECT_MANAGER]: [...ROLE_PERMISSIONS[CanonicalRole.PROJECT_MANAGER]],
      [ProjectRoleName.MEMBER]: [...ROLE_PERMISSIONS[CanonicalRole.MEMBER]],
      [ProjectRoleName.EXTERNAL_COLLABORATOR]: [
        ...ROLE_PERMISSIONS[CanonicalRole.EXTERNAL_COLLABORATOR],
      ],
      [ProjectRoleName.READONLY_OBSERVER]: [...ROLE_PERMISSIONS[CanonicalRole.READONLY_OBSERVER]],
    }
    const role = await ProjectRole.query()
      .where('project_id', projectId)
      .where('name', roleName)
      .first()

    if (role) {
      role.permissions = rolePermissionsByName[roleName]
      role.description = roleName
      role.isSystem = true
      await role.save()
    }

    const projectRole =
      role ??
      (await ProjectRole.create({
        projectId,
        name: roleName,
        description: roleName,
        permissions: rolePermissionsByName[roleName],
        isSystem: true,
      }))
    return ProjectMember.create({
      projectId,
      userId,
      projectRoleId: projectRole.id,
      isActive: true,
    })
  }

  test('GET external-links returns empty list', async ({ client }) => {
    const { project, task, email } = await setup()
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
    const token = loginRes.body().data.accessToken

    const res = await client
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .bearerToken(token)
    res.assertStatus(200)
  })

  test('POST external-links creates a GitHub issue link', async ({ client, assert }) => {
    const { project, task, email } = await setup()
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
    const token = loginRes.body().data.accessToken

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .json({
        provider: 'github',
        linkType: 'issue',
        repositoryOwner: 'facebook',
        repositoryName: 'react',
        externalNumber: 42,
        externalStatus: 'open',
        externalUrl: 'https://github.com/facebook/react/issues/42',
      })
      .bearerToken(token)
    assert.equal(res.status(), 201)
    assert.equal(res.body().data.provider, 'github')
    assert.equal(res.body().data.externalNumber, 42)
  })

  test('POST rejects invalid URL scheme', async ({ client, assert }) => {
    const { project, task, email } = await setup()
    const loginRes = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    loginRes.assertStatus(200)
    const token = loginRes.body().data.accessToken

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .json({
        provider: 'github',
        linkType: 'issue',
        repositoryOwner: 'hacker',
        repositoryName: 'bad',
        externalNumber: 1,
        externalStatus: 'open',
        externalUrl: 'javascript:alert(1)',
      })
      .bearerToken(token)
    assert.equal(res.status(), 422)
  })

  test('POST refresh requires task:update across the six role matrix', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('matrix-owner'), isSuperAdmin: true })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await Task.create({
      projectId: project.id,
      name: '权限矩阵刷新任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    })
    const link = await createGitHubLink(
      Number(org.id),
      Number(project.id),
      Number(task.id),
      Number(owner.id),
    )

    const orgAdmin = await createUser({ email: uniqueEmail('matrix-org-admin') })
    const manager = await createUser({ email: uniqueEmail('matrix-manager') })
    const member = await createUser({ email: uniqueEmail('matrix-member') })
    const collaborator = await createUser({ email: uniqueEmail('matrix-collab') })
    const readonly = await createUser({ email: uniqueEmail('matrix-readonly') })

    await addOrgMember(org, orgAdmin, 'admin')
    const managerOrgMember = await addOrgMember(org, manager, 'member')
    managerOrgMember.permissions = ['task:update']
    await managerOrgMember.save()
    await addOrgMember(org, member, 'member')
    await addOrgMember(org, collaborator, 'member')
    await addOrgMember(org, readonly, 'viewer')

    await addProjectRoleMember(
      Number(project.id),
      Number(manager.id),
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addProjectRoleMember(Number(project.id), Number(member.id), ProjectRoleName.MEMBER)
    await addProjectRoleMember(
      Number(project.id),
      Number(collaborator.id),
      ProjectRoleName.EXTERNAL_COLLABORATOR,
    )
    await addProjectRoleMember(
      Number(project.id),
      Number(readonly.id),
      ProjectRoleName.READONLY_OBSERVER,
    )

    for (const user of [owner, orgAdmin, manager]) {
      await createGitHubConnection(Number(org.id), Number(user.id))
      const token = await login(client, user.email)
      const res = await client
        .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${link.id}/refresh`)
        .bearerToken(token)
      assert.equal(res.status(), 200, `${user.email} should refresh`)
    }

    for (const user of [member, collaborator, readonly]) {
      await createGitHubConnection(Number(org.id), Number(user.id))
      const token = await login(client, user.email)
      const res = await client
        .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${link.id}/refresh`)
        .bearerToken(token)
      assert.equal(res.status(), 403, `${user.email} should not refresh`)
    }
  })

  test('POST refresh does not expose cross organization, project, task, or link targets', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, task, email } = await setup()
    const link = await createGitHubLink(
      Number(org.id),
      Number(project.id),
      Number(task.id),
      Number(owner.id),
    )
    await createGitHubConnection(Number(org.id), Number(owner.id))
    const token = await login(client, email)

    const otherTask = await Task.create({
      projectId: project.id,
      name: '同项目另一个任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    })

    const wrongTask = await client
      .post(
        `/api/v1/projects/${project.id}/tasks/${otherTask.id}/external-links/${link.id}/refresh`,
      )
      .bearerToken(token)
    wrongTask.assertStatus(404)

    const wrongProject = await client
      .post(
        `/api/v1/projects/${Number(project.id) + 999}/tasks/${task.id}/external-links/${link.id}/refresh`,
      )
      .bearerToken(token)
    assert.notEqual(wrongProject.status(), 200)

    const missingLink = await client
      .post(
        `/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${Number(link.id) + 999}/refresh`,
      )
      .bearerToken(token)
    missingLink.assertStatus(404)

    const otherOwner = await createUser({ email: uniqueEmail('matrix-other-owner') })
    const otherOrg = await createOrganization(otherOwner)
    const crossOrgLogin = await client
      .post('/api/v1/auth/login')
      .json({ email, password: STRONG_PASSWORD })
    const switched = await client.post('/api/v1/auth/refresh').json({
      refreshToken: crossOrgLogin.body().data.refreshToken,
      organizationId: Number(otherOrg.id),
    })
    switched.assertStatus(200)

    const crossOrg = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${link.id}/refresh`)
      .bearerToken(switched.body().data.accessToken)
    crossOrg.assertStatus(404)
  })

  // -------------------------------------------------------------------------
  // v2-5-code-repository-ci-status-display —— CI summary API 行为（任务 5.2/5.3/5.4）
  // -------------------------------------------------------------------------

  test('GET external-links 返回 ciSummary 字段；旧链接无摘要为 null', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, task, email } = await setup()
    await createGitHubLink(Number(org.id), Number(project.id), Number(task.id), Number(owner.id))
    const token = await login(client, email)

    const res = await client
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .bearerToken(token)
    res.assertStatus(200)
    const rows = res.body().data as Array<Record<string, unknown>>
    assert.lengthOf(rows, 1)
    assert.property(rows[0], 'ciSummary')
    assert.isNull(rows[0].ciSummary ?? null)
  })

  test('POST refresh 成功返回 ciSummary=passed 且列表可见（PR + CI）', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, task, email } = await setup()
    const link = await createGitHubPrLink(
      Number(org.id),
      Number(project.id),
      Number(task.id),
      Number(owner.id),
    )
    // 默认 token 'gho_valid_token' → fixture PR CI 成功
    await createGitHubConnection(Number(org.id), Number(owner.id))
    const token = await login(client, email)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${link.id}/refresh`)
      .bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().data.result, 'success')
    assert.equal(res.body().data.ciSummary.state, 'passed')
    assert.equal(res.body().data.ciSummary.source, 'github_checks')

    // 列表 include 摘要
    const list = await client
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .bearerToken(token)
    const row = (list.body().data as Array<Record<string, any>>).find((r) => r.id === link.id)
    assert.equal(row?.ciSummary?.state, 'passed')

    // 响应体不得泄露 token/payload/log
    const raw = JSON.stringify(res.body())
    for (const leak of ['gho_valid_token', 'Bearer', 'check_runs', 'artifacts', 'output']) {
      assert.notInclude(raw, leak)
    }
  })

  test('POST refresh 失败返回稳定 reason code 且保留既有快照', async ({ client, assert }) => {
    const { owner, org, project, task, email } = await setup()
    const link = await createGitHubPrLink(
      Number(org.id),
      Number(project.id),
      Number(task.id),
      Number(owner.id),
      88,
    )
    // forbidden token → 降级
    await createGitHubConnection(Number(org.id), Number(owner.id), 'gho_forbidden_x')
    const token = await login(client, email)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${link.id}/refresh`)
      .bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().data.result, 'forbidden') // 稳定可解释 reason code
    assert.isNotNull(res.body().data.message)

    // 外部快照保留（externalStatus 仍是创建时的 open）
    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.equal(reloaded.externalStatus, 'open')
  })

  test('READONLY_OBSERVER 可查看链接摘要但不可刷新', async ({ client, assert }) => {
    const { owner, org, project, task } = await setup()
    const link = await createGitHubLink(
      Number(org.id),
      Number(project.id),
      Number(task.id),
      Number(owner.id),
    )
    const observer = await createUser({ email: uniqueEmail('ci-observer') })
    await addOrgMember(org, observer, 'viewer')
    await addProjectRoleMember(
      Number(project.id),
      Number(observer.id),
      ProjectRoleName.READONLY_OBSERVER,
    )
    const token = await login(client, observer.email)

    // 可查看（task:view）
    const view = await client
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .bearerToken(token)
    view.assertStatus(200)
    assert.property((view.body().data as Array<Record<string, unknown>>)[0], 'ciSummary')

    // 不可刷新（task:update）
    const refresh = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links/${link.id}/refresh`)
      .bearerToken(token)
    refresh.assertStatus(403)
  })

  test('重复创建同 provider/repo/number 链接返回 409（抑制重复）', async ({ client, assert }) => {
    const { project, task, email } = await setup()
    const token = await login(client, email)
    const payload = {
      provider: 'github',
      linkType: 'issue',
      repositoryOwner: 'dup',
      repositoryName: 'repo',
      externalNumber: 5,
      externalStatus: 'open',
      externalUrl: 'https://github.com/dup/repo/issues/5',
    }
    const first = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .json(payload)
      .bearerToken(token)
    assert.equal(first.status(), 201)

    const second = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/external-links`)
      .json(payload)
      .bearerToken(token)
    assert.equal(second.status(), 409)
  })
})
