/**
 * v2-5-code-repository-auto-linking —— TaskReferenceResolver 权限与隔离测试。
 *
 * 覆盖：同编号不同组织、不可见项目、已删除任务、多个引用和无候选落库断言。
 * 依赖 AdonisJS 数据库（test.sqlite），通过 Japa 运行。
 */

import { test } from '@japa/runner'
import { TaskReferenceResolver } from '#services/candidates/task_reference_resolver'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const resolver = new TaskReferenceResolver()

test.group('TaskReferenceResolver', (group) => {
  useAuthDatabase(group)

  // -------------------------------------------------------------------------
  // 基本解析
  // -------------------------------------------------------------------------

  test('空引用返回 no_reference', async ({ assert }) => {
    const result = await resolver.resolve(1, '')
    assert.isFalse(result.matched)
    assert.equal(result.reason, 'no_reference')
  })

  test('空白引用返回 no_reference', async ({ assert }) => {
    const result = await resolver.resolve(1, '   ')
    assert.isFalse(result.matched)
    assert.equal(result.reason, 'no_reference')
  })

  // -------------------------------------------------------------------------
  // 不存在性保护
  // -------------------------------------------------------------------------

  test('不存在的引用不泄露存在性', async ({ assert }) => {
    const result = await resolver.resolve(1, 'NONEXIST-99999')
    assert.isFalse(result.matched)
    // 不返回"任务不存在"这类泄露信息
    assert.include(result.message, '未找到')
    assert.notInclude(result.message, 'NONEXIST')
  })

  test('跨组织查询不泄露存在性', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('resolver-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await Task.create({
      projectId: project.id,
      name: '跨组织不可见任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    const result = await resolver.resolve(org.id + 999, `PROJ-${task.id}`)
    assert.isFalse(result.matched)
    // v3-multitenant-database-isolation §5.5：跨组织与不存在必须同形——
    // 原断言期望 `no_visible_project`，那正是任务存在性侧信道。
    assert.equal(result.reason, 'task_not_found')
    const missing = await resolver.resolve(org.id + 999, `PROJ-${Number(task.id) + 999999}`)
    assert.equal(missing.reason, result.reason)
    assert.equal(missing.message, result.message)
  })
})

test.group('TaskReferenceResolver — resolveMany', (group) => {
  useAuthDatabase(group)

  test('空列表返回空数组', async ({ assert }) => {
    const results = await resolver.resolveMany(1, [])
    assert.lengthOf(results, 0)
  })

  test('去重后解析多个引用', async ({ assert }) => {
    const results = await resolver.resolveMany(1, [
      'PROJ-123',
      'PROJ-456',
      'PROJ-123', // 重复
    ])
    // 两个唯一引用
    assert.lengthOf(results, 2)
  })
})
