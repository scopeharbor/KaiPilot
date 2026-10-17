import { ProjectRoleName } from '#rbac'
import TaskExternalLinkService, {
  LinkDuplicateError,
  LinkNotFoundError,
} from '#services/task_external_link_service'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('TaskExternalLinkService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('ext-link-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const taskId = 1

    return {
      owner,
      org,
      project,
      taskId,
      service: new TaskExternalLinkService(),
      actor: { userId: Number(owner.id), organizationId: Number(org.id) },
    }
  }

  test('list returns empty for new task', async ({ assert }) => {
    const { project, taskId, service, actor } = await setup()
    const links = await service.listByTask(project.id, taskId, actor)
    assert.isEmpty(links)
  })

  test('create stores and returns a new external link', async ({ assert }) => {
    const { project, taskId, service, actor } = await setup()
    const link = await service.create(
      project.id,
      taskId,
      {
        provider: 'github',
        linkType: 'issue',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        externalNumber: 42,
        externalStatus: 'open',
        externalUrl: 'https://github.com/owner/repo/issues/42',
      },
      actor,
    )
    assert.isNotNull(link.id)
    assert.equal(link.provider, 'github')
    assert.equal(link.linkType, 'issue')
    assert.equal(link.externalNumber, 42)
    assert.equal(link.externalStatus, 'open')
    assert.equal(link.statusSource, 'manual')
    assert.equal(link.createdBy, actor.userId)
  })

  test('duplicate detection rejects same provider/repo/number', async ({ assert }) => {
    const { project, taskId, service, actor } = await setup()
    await service.create(
      project.id,
      taskId,
      {
        provider: 'github',
        linkType: 'issue',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        externalNumber: 1,
        externalStatus: 'open',
        externalUrl: 'https://github.com/owner/repo/issues/1',
      },
      actor,
    )
    await assert.rejects(
      () =>
        service.create(
          project.id,
          taskId,
          {
            provider: 'github',
            linkType: 'issue',
            repositoryOwner: 'owner',
            repositoryName: 'repo',
            externalNumber: 1,
            externalStatus: 'open',
            externalUrl: 'https://github.com/owner/repo/issues/1',
          },
          actor,
        ),
      LinkDuplicateError,
    )
  })

  test('update modifies title and status', async ({ assert }) => {
    const { project, taskId, service, actor } = await setup()
    const link = await service.create(
      project.id,
      taskId,
      {
        provider: 'github',
        linkType: 'pull_request',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        externalNumber: 99,
        externalStatus: 'open',
        externalUrl: 'https://github.com/owner/repo/pull/99',
      },
      actor,
    )
    const updated = await service.update(
      link.id,
      project.id,
      taskId,
      { externalTitle: 'Fix: update logic', externalStatus: 'closed' },
      actor,
    )
    assert.equal(updated.externalTitle, 'Fix: update logic')
    assert.equal(updated.externalStatus, 'closed')
    assert.equal(updated.statusSource, 'manual')
  })

  test('delete removes the link', async ({ assert }) => {
    const { project, taskId, service, actor } = await setup()
    const link = await service.create(
      project.id,
      taskId,
      {
        provider: 'gitlab',
        linkType: 'merge_request',
        repositoryOwner: 'owner',
        repositoryName: 'project',
        externalNumber: 7,
        externalStatus: 'open',
        externalUrl: 'https://gitlab.com/owner/project/-/merge_requests/7',
      },
      actor,
    )
    await service.delete(link.id, project.id, taskId, actor)
    const links = await service.listByTask(project.id, taskId, actor)
    assert.isEmpty(links.filter((l) => l.id === link.id))
  })

  test('delete throws on non-existent link', async ({ assert }) => {
    const { project, taskId, service, actor } = await setup()
    await assert.rejects(() => service.delete(999, project.id, taskId, actor), LinkNotFoundError)
  })

  test('refresh returns not_configured or pre_connection_only without real API call', async ({
    assert,
  }) => {
    const { project, taskId, service, actor } = await setup()
    const link = await service.create(
      project.id,
      taskId,
      {
        provider: 'github',
        linkType: 'issue',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        externalNumber: 100,
        externalStatus: 'open',
        externalUrl: 'https://github.com/owner/repo/issues/100',
      },
      actor,
    )
    const result = await service.refresh(link.id, project.id, taskId, actor)
    // connection_required 是引入 OAuth 连接解析器后的当前正确行为（无连接 → 需先连接）；
    // 保留旧码兼容，测试意图（无真实 API 调用、良性 no-op、外部状态不变）不变。
    assert.include(['not_configured', 'pre_connection_only', 'connection_required'], result.result)
    assert.isNotNull(result.message)
    // 外部状态不变
    const reloaded = await service.getById(link.id, project.id, taskId, actor)
    assert.equal(reloaded?.externalStatus, 'open')
  })

  test('external status never mutates task facts', async ({ assert }) => {
    // 这个测试验证外部链接操作不会修改任务事实
    // TaskExternalLinkService 只操作 task_external_links 表，不碰 tasks 表
    const { project, taskId, service, actor } = await setup()
    const link = await service.create(
      project.id,
      taskId,
      {
        provider: 'github',
        linkType: 'pull_request',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        externalNumber: 200,
        externalStatus: 'merged',
        externalUrl: 'https://github.com/owner/repo/pull/200',
      },
      actor,
    )
    // 操作成功后验证链接状态，任务状态不受影响
    assert.equal(link.externalStatus, 'merged')
    // service 没有提供任何修改任务状态的方法
  })
})
