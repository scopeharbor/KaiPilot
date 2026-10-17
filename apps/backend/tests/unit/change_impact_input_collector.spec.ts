import ChangeRequest from '#models/change_request'
import Task from '#models/task'
import ChangeImpactInputCollector from '#services/change_impact/input_collector'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { ProjectRoleName } from '#rbac'
import type Organization from '#models/organization'
import type Project from '#models/project'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * 影响分析输入收集测试（v2-change-management-impact-analysis §3.6）。
 * 覆盖关联对象缺失、跨组织隔离与只读输入构建。
 */

let crSeq = 0
async function makeCr(
  org: Organization,
  project: Project,
  userId: number,
  relatedTaskIds: number[] | null = null,
): Promise<ChangeRequest> {
  crSeq += 1
  return ChangeRequest.create({
    crCode: `CR-COL-${process.pid}-${crSeq}`,
    organizationId: org.id,
    projectId: project.id,
    requesterId: userId,
    requestedBy: userId,
    title: '收集器测试变更',
    description: '描述',
    changeType: 'schedule',
    status: 'draft',
    priority: 'high',
    relatedTaskIds,
  })
}

async function setup() {
  const owner = await createUser({ email: uniqueEmail('ci-collect') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project, collector: new ChangeImpactInputCollector() }
}

test.group('ChangeImpactInputCollector', (group) => {
  useAuthDatabase(group)

  test('构建结构化只读输入，携带变更请求字段与默认规则版本', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const cr = await makeCr(org, project, owner.id)

    const input = await collector.collect(org.id, project.id, cr.id)

    assert.equal(input.changeRequest.title, '收集器测试变更')
    assert.equal(input.changeRequest.changeType, 'schedule')
    assert.equal(input.ruleVersion, '2.0.0')
    assert.include(input.scope.dimensions, 'schedule')
    assert.isArray(input.relatedTasks)
    assert.isArray(input.relatedDependencies)
    assert.isArray(input.warnings)
  })

  test('没有显式关联对象时不读取全项目任务，并输出 missingInputs', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    await Task.create({
      projectId: project.id,
      name: '不应被推断的项目任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const cr = await makeCr(org, project, owner.id, null)

    const input = await collector.collect(org.id, project.id, cr.id)

    assert.lengthOf(input.relatedTasks, 0, '无显式关联任务时不得把项目任务纳入输入')
    assert.isTrue(
      input.missingInputs.some((m) => m.dimension === 'related_object'),
      '无关联对象应输出 missingInputs',
    )
  })

  test('关联任务缺失时输出 RELATED_TASKS_NOT_FOUND warning', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    // 指向不存在的任务 id
    const cr = await makeCr(org, project, owner.id, [999_999])

    const input = await collector.collect(org.id, project.id, cr.id)

    assert.lengthOf(input.relatedTasks, 0)
    assert.isTrue(
      input.warnings.some((w) => w.code === 'RELATED_TASKS_NOT_FOUND'),
      '关联任务缺失应产出 warning',
    )
  })

  test('关联任务必须属于同一项目，跨项目任务不进入输入', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const { project: otherProject } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const otherTask = await Task.create({
      projectId: otherProject.id,
      name: '其它项目任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const cr = await makeCr(org, project, owner.id, [otherTask.id])

    const input = await collector.collect(org.id, project.id, cr.id)

    assert.lengthOf(input.relatedTasks, 0)
    assert.isTrue(
      input.warnings.some((w) => w.code === 'RELATED_TASKS_NOT_FOUND'),
      '跨项目关联任务应视为不可见/不存在',
    )
  })

  test('跨组织收集抛出 ResourceNotFoundException（组织隔离）', async ({ assert }) => {
    const { owner, org, project, collector } = await setup()
    const cr = await makeCr(org, project, owner.id)

    const otherOwner = await createUser({ email: uniqueEmail('ci-collect-other') })
    const otherOrg = await createOrganization(otherOwner)

    try {
      await collector.collect(otherOrg.id, project.id, cr.id)
      assert.fail('跨组织收集应抛出 ResourceNotFoundException')
    } catch (error) {
      assert.instanceOf(error, ResourceNotFoundException)
    }
  })
})
