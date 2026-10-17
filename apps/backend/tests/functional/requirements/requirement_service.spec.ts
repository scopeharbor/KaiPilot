// v3-chart-gallery-data-foundation W2.5 —— RequirementService 功能测试
//
// 覆盖（tasks.md 2.3/2.4/2.5）：
// - 需求 CRUD（自动/显式编号、过滤分页、软删除清理绑定）；
// - 单项验收准则状态变更（pending → passed）与整表替换；
// - 任务绑定/解绑（bindTask/unbindTask），跨组织任务绑定拦截（404）；
// - RTM 追溯矩阵聚合（行平铺结构、关联任务、准则通过率与覆盖率）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import RequirementTask from '#models/requirement_task'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import RequirementService from '#services/requirement_service'
import type { CreateRequirementInput } from '#services/requirement_service'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/** 装配组织 + 项目（owner 为项目经理）。 */
async function setup() {
  const owner = await createUser({ email: uniqueEmail('req-owner') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

/** 项目内创建任务（member 可为空）。 */
async function makeTask(projectId: number, name: string, overrides: Record<string, unknown> = {}) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    isCriticalPath: false,
    isOnLongestPath: false,
    ...overrides,
  })
}

function requirementPayload(
  overrides: Partial<CreateRequirementInput> = {},
): CreateRequirementInput {
  return {
    title: '支持多轮追问的智能问答',
    description: '用户在对话流中可连续追问业务细节',
    category: 'functional',
    priority: 'high',
    acceptanceCriteria: [
      { id: 'ac-1', statement: '追问上下文保持完整', status: 'pending' },
      { id: 'ac-2', statement: '回答引用知识库来源', status: 'pending' },
    ],
    ...overrides,
  }
}

test.group('RequirementService', (group) => {
  useAuthDatabase(group)

  test('创建需求：显式编号、自动编号 REQ-001 与默认枚举、验收准则 JSON 往返', async ({
    assert,
  }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)

    const explicit = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-INTENT', title: '意图识别' }),
      owner.id,
    )
    assert.equal(explicit.code, 'REQ-INTENT')
    assert.equal(explicit.category, 'functional')
    assert.equal(explicit.priority, 'high')
    assert.equal(explicit.status, 'draft')
    assert.lengthOf(explicit.acceptanceCriteria, 2)
    assert.equal(explicit.acceptanceCriteria[0].id, 'ac-1')
    assert.equal(explicit.acceptanceCriteria[0].status, 'pending')
    assert.equal(explicit.createdBy, owner.id)

    const auto = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: null, title: '自动编号需求' }),
      owner.id,
    )
    assert.equal(auto.code, 'REQ-001')
  })

  test('重复编号被拒绝（422）；无效枚举被拒绝（422）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)
    await service.create(org.id, project.id, requirementPayload({ code: 'REQ-001' }), owner.id)

    await assert.rejects(
      () => service.create(org.id, project.id, requirementPayload({ code: 'REQ-001' }), owner.id),
      ValidationException,
    )

    const bad = requirementPayload({
      category: 'nonsense' as CreateRequirementInput['category'],
    })
    await assert.rejects(
      () => service.create(org.id, project.id, bad, owner.id),
      ValidationException,
    )
  })

  test('列表：category/status 过滤与分页元数据', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)

    await service.create(
      org.id,
      project.id,
      requirementPayload({ title: '需求一', category: 'functional', status: 'draft' }),
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      requirementPayload({ title: '需求二', category: 'user', status: 'approved' }),
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      requirementPayload({ title: '需求三', category: 'user', status: 'approved' }),
      owner.id,
    )

    const all = await service.list(org.id, project.id)
    assert.equal(all.meta.total, 3)
    assert.lengthOf(all.data, 3)
    // 默认按 code 升序
    assert.equal(all.data[0].code, 'REQ-001')

    const userApproved = await service.list(org.id, project.id, { category: 'user' })
    assert.equal(userApproved.meta.total, 2)

    const page2 = await service.list(org.id, project.id, { page: 2, perPage: 2 })
    assert.equal(page2.meta.total, 3)
    assert.equal(page2.meta.page, 2)
    assert.equal(page2.meta.totalPages, 2)
    assert.lengthOf(page2.data, 1)
    assert.equal(page2.data[0].code, 'REQ-003')
  })

  test('更新需求内容、验收准则整表替换与单项状态变更（pending → passed）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)

    const created = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-001' }),
      owner.id,
    )

    const updated = await service.update(
      org.id,
      project.id,
      created.id,
      { title: '更新后的标题', description: null, priority: 'highest' },
      owner.id,
    )
    assert.equal(updated.title, '更新后的标题')
    assert.isNull(updated.description)
    assert.equal(updated.priority, 'highest')
    assert.equal(updated.updatedBy, owner.id)

    // 单项验收准则状态流转
    const criterion = await service.updateCriterionStatus(
      org.id,
      project.id,
      created.id,
      'ac-1',
      'passed',
      owner.id,
    )
    assert.equal(criterion.acceptanceCriteria[0].status, 'passed')
    assert.equal(criterion.acceptanceCriteria[1].status, 'pending')

    // 无效准则 id
    await assert.rejects(
      () =>
        service.updateCriterionStatus(org.id, project.id, created.id, 'ac-999', 'passed', owner.id),
      ValidationException,
    )

    // 整表替换验收准则
    const replaced = await service.update(
      org.id,
      project.id,
      created.id,
      { acceptanceCriteria: [{ id: 'ac-x', statement: '替换后的唯一准则', status: 'failed' }] },
      owner.id,
    )
    assert.lengthOf(replaced.acceptanceCriteria, 1)
    assert.equal(replaced.acceptanceCriteria[0].status, 'failed')
  })

  test('任务绑定/解绑：绑定后 get 预载任务，解绑后关联消失', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)
    const task = await makeTask(project.id, '实现多轮问答状态机')

    const requirement = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-001' }),
      owner.id,
    )
    const link = await service.bindTask(org.id, project.id, requirement.id, task.id)
    assert.equal(link.requirementId, requirement.id)
    assert.equal(link.taskId, task.id)

    // 重复绑定幂等
    const again = await service.bindTask(org.id, project.id, requirement.id, task.id)
    assert.equal(again.id, link.id)

    const detail = await service.get(org.id, project.id, requirement.id)
    assert.lengthOf(detail.requirementTasks, 1)
    assert.equal(detail.requirementTasks[0].task.name, '实现多轮问答状态机')

    await service.unbindTask(org.id, project.id, requirement.id, task.id)
    const afterUnbind = await service.get(org.id, project.id, requirement.id)
    assert.lengthOf(afterUnbind.requirementTasks, 0)

    await assert.rejects(
      () => service.unbindTask(org.id, project.id, requirement.id, task.id),
      ResourceNotFoundException,
    )
  })

  test('跨组织任务绑定与跨组织项目访问一律 404（RL-05）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)
    const requirement = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-001' }),
      owner.id,
    )

    // 其他组织的项目与任务
    const outsider = await createUser({ email: uniqueEmail('req-outsider') })
    const otherOrg = await createOrganization(outsider)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      outsider,
      outsider,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const foreignTask = await makeTask(otherProject.id, '他人组织任务')

    // 跨组织任务绑定 → 404
    await assert.rejects(
      () => service.bindTask(org.id, project.id, requirement.id, foreignTask.id),
      ResourceNotFoundException,
    )

    // 跨组织项目（列表/创建/矩阵/删除/绑定）→ 404
    await assert.rejects(() => service.list(otherOrg.id, project.id), ResourceNotFoundException)
    await assert.rejects(
      () =>
        service.create(
          otherOrg.id,
          project.id,
          requirementPayload({ title: '跨组织创建' }),
          outsider.id,
        ),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.getRtmMatrix(otherOrg.id, project.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.delete(otherOrg.id, project.id, requirement.id, outsider.id),
      ResourceNotFoundException,
    )
  })

  test('软删除需求：get 404、列表不可见、绑定记录被物理清理', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)
    const task = await makeTask(project.id, '待清理任务')
    const requirement = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-001' }),
      owner.id,
    )
    await service.bindTask(org.id, project.id, requirement.id, task.id)

    await service.delete(org.id, project.id, requirement.id, owner.id)

    await assert.rejects(
      () => service.get(org.id, project.id, requirement.id),
      ResourceNotFoundException,
    )
    const list = await service.list(org.id, project.id)
    assert.equal(list.meta.total, 0)
    const links = await RequirementTask.query().where('requirement_id', requirement.id)
    assert.lengthOf(links, 0)
  })

  test('RTM 矩阵：平铺行结构、关联任务、准则通过率与覆盖率计算准确', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)

    // 需求 A：两条验收准则（1 通过 1 待验），绑定 2 个任务
    const reqA = await service.create(
      org.id,
      project.id,
      requirementPayload({
        code: 'REQ-001',
        acceptanceCriteria: [
          { id: 'ac-1', statement: '追问上下文保持完整', status: 'passed' },
          { id: 'ac-2', statement: '回答引用知识库来源', status: 'pending' },
        ],
      }),
      owner.id,
    )
    // 需求 B：无准则无关联任务
    const reqB = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-002', title: '未覆盖需求', acceptanceCriteria: [] }),
      owner.id,
    )
    const task1 = await makeTask(project.id, '多轮追问状态机', {
      status: 'in_progress',
      assigneeId: owner.id,
      progressPercent: 40,
    })
    const task2 = await makeTask(project.id, '知识库检索接入', {
      status: 'completed',
      progressPercent: 100,
    })
    await service.bindTask(org.id, project.id, reqA.id, task1.id)
    await service.bindTask(org.id, project.id, reqA.id, task2.id)

    const matrix = await service.getRtmMatrix(org.id, project.id)

    assert.equal(matrix.projectId, project.id)
    assert.equal(matrix.totalRequirements, 2)
    // 覆盖率：仅 REQ-001 关联了任务
    assert.equal(matrix.coveragePercent, 50)
    assert.lengthOf(matrix.matrix, 2)

    const rowA = matrix.matrix.find((row) => row.code === 'REQ-001')!
    assert.equal(rowA.requirementId, reqA.id)
    assert.equal(rowA.title, '支持多轮追问的智能问答')
    assert.equal(rowA.category, 'functional')
    assert.equal(rowA.priority, 'high')
    assert.equal(rowA.status, 'draft')
    assert.lengthOf(rowA.acceptanceCriteria, 2)
    assert.equal(rowA.criteriaPassRate, 50)
    assert.lengthOf(rowA.linkedTasks, 2)
    // 任务行按 id 升序
    assert.equal(rowA.linkedTasks[0].id, task1.id)
    assert.equal(rowA.linkedTasks[0].name, '多轮追问状态机')
    assert.equal(rowA.linkedTasks[0].status, 'in_progress')
    assert.equal(rowA.linkedTasks[0].progressPercent, 40)
    assert.equal(rowA.linkedTasks[0].assigneeName, owner.fullName)
    assert.equal(rowA.linkedTasks[1].id, task2.id)
    assert.isNull(rowA.linkedTasks[1].assigneeName)

    const rowB = matrix.matrix.find((row) => row.code === 'REQ-002')!
    assert.equal(rowB.requirementId, reqB.id)
    assert.lengthOf(rowB.acceptanceCriteria, 0)
    assert.equal(rowB.criteriaPassRate, 0)
    assert.lengthOf(rowB.linkedTasks, 0)
  })

  test('RTM 矩阵：空项目返回零值；软删除需求不计入矩阵', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(RequirementService)

    const empty = await service.getRtmMatrix(org.id, project.id)
    assert.equal(empty.totalRequirements, 0)
    assert.equal(empty.coveragePercent, 0)
    assert.lengthOf(empty.matrix, 0)

    // 软删除的需求不进入矩阵
    const requirement = await service.create(
      org.id,
      project.id,
      requirementPayload({ code: 'REQ-001' }),
      owner.id,
    )
    await service.delete(org.id, project.id, requirement.id, owner.id)
    const after = await service.getRtmMatrix(org.id, project.id)
    assert.equal(after.totalRequirements, 0)
  })
})
