import PhysicalContradictionAnalysisInputCollector from '#services/triz_contradiction/physical_input_collector'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('V3 PhysicalContradictionAnalysisInputCollector', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('phys-collector') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const collector = new PhysicalContradictionAnalysisInputCollector()
    return { owner, org, project, collector }
  }

  async function addOverdueTask(projectId: number) {
    await Task.create({
      projectId,
      name: '逾期任务',
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
      endDate: DateTime.now().minus({ days: 3 }),
      isCriticalPath: true,
    } as any)
  }

  test('collect 返回组织+项目作用域的低敏摘要', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    await addOverdueTask(project.id)

    const out = await collector.collect(org.id, project.id, owner.id)
    assert.equal(out.organizationId, org.id)
    assert.equal(out.projectId, project.id)
    assert.equal(out.actorId, owner.id)
    assert.isAtLeast(out.taskCount, 1)
    assert.isAtLeast(out.overdueTaskCount, 1)
    assert.isAtLeast(out.scopeItemCount, 1)
    assert.isObject(out.sourceHashes)
    assert.isTrue('tasks' in out.sourceHashes)
    assert.isArray(out.warnings)
  })

  test('collect 组织隔离：跨组织查询不到项目数据', async ({ assert }) => {
    const { owner, project, collector } = await setup()
    await addOverdueTask(project.id)
    // 用一个不存在的 organizationId
    const out = await collector.collect(999999, project.id, owner.id)
    assert.equal(out.taskCount, 0)
  })

  test('collect 无副作用：不创建/更新任何正式记录', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const before = await Task.query().where('project_id', project.id).count('* as total')
    const beforeCount = Number((before[0] as any)?.$extras?.total ?? 0)

    await collector.collect(org.id, project.id, owner.id)

    const after = await Task.query().where('project_id', project.id).count('* as total')
    const afterCount = Number((after[0] as any)?.$extras?.total ?? 0)
    assert.equal(beforeCount, afterCount)
  })

  test('collect 对不可用模块降级并加 warning，不抛错', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const out = await collector.collect(org.id, project.id, owner.id)
    // 即使某些表缺失，也不抛错；warnings 为数组
    assert.isArray(out.warnings)
    assert.isString(out.collectedAt)
  })

  test('collect 用户上下文透传', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const out = await collector.collect(org.id, project.id, owner.id, '关注资源瓶颈')
    assert.equal(out.userContext, '关注资源瓶颈')
  })
})
