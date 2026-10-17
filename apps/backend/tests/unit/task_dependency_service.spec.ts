import AuditLog from '#models/audit_log'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import TaskDependencyPolicy from '#policies/task_dependency_policy'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import TaskDependencyService from '#services/task_dependency_service'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('TaskDependencyService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('dependency-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const tasks = await Promise.all(
      ['A', 'B', 'C'].map((name) =>
        Task.create({
          projectId: project.id,
          name,
          status: 'not_started',
          priority: 'medium',
          taskType: 'task',
        }),
      ),
    )
    return { owner, org, project, tasks, service: new TaskDependencyService(new AuditService()) }
  }

  test('四类依赖与负 lag 可创建，双向查询正确分组', async ({ assert }) => {
    const { owner, org, project, tasks, service } = await setup()
    const [a, b, c] = tasks
    const fs = await service.createDependency(
      org.id,
      project.id,
      b!.id,
      { predecessorId: a!.id, type: 'fs', lagDays: -2 },
      owner.id,
    )
    await service.createDependency(
      org.id,
      project.id,
      c!.id,
      { predecessorId: b!.id, type: 'ss' },
      owner.id,
    )
    const groups = await service.listByTask(org.id, project.id, b!.id)

    assert.equal(fs.type, 'fs')
    assert.equal(fs.lagDays, -2)
    assert.deepEqual(
      groups.predecessors.map((item) => item.predecessor.name),
      ['A'],
    )
    assert.deepEqual(
      groups.successors.map((item) => item.successor.name),
      ['C'],
    )

    for (const type of ['ff', 'sf'] as const) {
      const extra = await Task.create({
        projectId: project.id,
        name: type,
        status: 'not_started',
        priority: 'medium',
        taskType: 'task',
      })
      const dependency = await service.createDependency(
        org.id,
        project.id,
        extra.id,
        { predecessorId: a!.id, type },
        owner.id,
      )
      assert.equal(dependency.type, type)
    }
  })

  test('拒绝自依赖、非法类型、非整数 lag、重复与跨项目任务', async ({ assert }) => {
    const { owner, org, project, tasks, service } = await setup()
    const [a, b] = tasks
    await assert.rejects(
      () => service.createDependency(org.id, project.id, a!.id, { predecessorId: a!.id }, owner.id),
      '任务不能依赖自身',
    )
    await assert.rejects(
      () =>
        service.createDependency(
          org.id,
          project.id,
          b!.id,
          { predecessorId: a!.id, type: 'xx' },
          owner.id,
        ),
      '无效的依赖类型',
    )
    await assert.rejects(
      () =>
        service.createDependency(
          org.id,
          project.id,
          b!.id,
          { predecessorId: a!.id, lagDays: 1.2 },
          owner.id,
        ),
      'lag_days 必须是整数',
    )

    await service.createDependency(org.id, project.id, b!.id, { predecessorId: a!.id }, owner.id)
    await assert.rejects(
      () => service.createDependency(org.id, project.id, b!.id, { predecessorId: a!.id }, owner.id),
      '该任务依赖已存在',
    )

    const other = await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    const foreign = await Task.create({
      projectId: other.project.id,
      name: '跨项目',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    await assert.rejects(
      () =>
        service.createDependency(
          org.id,
          project.id,
          b!.id,
          { predecessorId: foreign.id },
          owner.id,
        ),
      '前置任务必须属于当前项目',
    )
  })

  test('DFS 拒绝直连环与多跳环，无环路径可继续创建', async ({ assert }) => {
    const { owner, org, project, tasks, service } = await setup()
    const [a, b, c] = tasks
    await service.createDependency(org.id, project.id, b!.id, { predecessorId: a!.id }, owner.id)
    await assert.rejects(
      () => service.createDependency(org.id, project.id, a!.id, { predecessorId: b!.id }, owner.id),
      '将形成循环依赖',
    )
    await service.createDependency(org.id, project.id, c!.id, { predecessorId: b!.id }, owner.id)
    await assert.rejects(
      () => service.createDependency(org.id, project.id, a!.id, { predecessorId: c!.id }, owner.id),
      '将形成循环依赖',
    )
  })

  test('软删任务的边不参与循环检测与查询', async ({ assert }) => {
    const { owner, org, project, tasks, service } = await setup()
    const [a, b, c] = tasks
    await service.createDependency(org.id, project.id, b!.id, { predecessorId: a!.id }, owner.id)
    await service.createDependency(org.id, project.id, c!.id, { predecessorId: b!.id }, owner.id)
    b!.deletedAt = DateTime.now()
    await b!.save()

    assert.isFalse(await service.detectCycle(project.id, c!.id, a!.id))
    const groups = await service.listByTask(org.id, project.id, a!.id)
    assert.lengthOf(groups.successors, 0)
  })

  test('百级依赖图 DFS 在一秒内完成', async ({ assert }) => {
    const { project, service } = await setup()
    const rows = Array.from({ length: 180 }, (_, index) => ({
      project_id: project.id,
      name: `T${index}`,
      status: 'not_started',
      priority: 'medium',
      task_type: 'task',
      created_at: DateTime.now().toSQL(),
      updated_at: DateTime.now().toSQL(),
    }))
    await db.table('tasks').multiInsert(rows)
    const tasks = await Task.query().where('project_id', project.id).whereLike('name', 'T%')
    await db.table('task_dependencies').multiInsert(
      tasks.slice(0, -1).map((task, index) => ({
        predecessor_id: task.id,
        successor_id: tasks[index + 1]!.id,
        type: 'fs',
        lag_days: 0,
        created_at: DateTime.now().toSQL(),
      })),
    )
    const start = performance.now()
    const cycle = await service.detectCycle(project.id, tasks[tasks.length - 1]!.id, tasks[0]!.id)
    assert.isTrue(cycle)
    assert.isBelow(performance.now() - start, 1000)
  })

  test('物理删除依赖并写删除审计', async ({ assert }) => {
    const { owner, org, project, tasks, service } = await setup()
    const dependency = await service.createDependency(
      org.id,
      project.id,
      tasks[1]!.id,
      { predecessorId: tasks[0]!.id, type: 'sf' },
      owner.id,
    )
    await service.deleteDependency(org.id, dependency.id, owner.id)
    assert.isNull(await TaskDependency.find(dependency.id))
    const audit = await AuditLog.query()
      .where('entity_type', 'task_dependency')
      .where('entity_id', dependency.id)
      .where('action', 'delete')
      .first()
    assert.equal((audit?.metadata as { event?: string })?.event, 'DEPENDENCY_DELETED')
  })
})

test.group('TaskDependencyPolicy', () => {
  test('查询默认拒绝，并把写权限委托给 successor 的 TaskPolicy', async ({ assert }) => {
    const authorizeUpdate = async () => {}
    const policy = new TaskDependencyPolicy({
      view: async () => false,
      authorizeUpdate,
    } as never)
    const user = { id: 1 } as never
    const successor = { id: 2, assigneeId: 1 } as never

    await assert.rejects(() => policy.authorizeView(user, 1, 1), '无权查看任务依赖')
    await assert.doesNotReject(() => policy.authorizeWrite(user, 1, 1, successor))
  })
})
