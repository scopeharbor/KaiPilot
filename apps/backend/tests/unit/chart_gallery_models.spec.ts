/**
 * v3-chart-gallery-data-foundation —— W1 ORM 模型单元测试（tasks 1.6）。
 *
 * 紧邻验证 7 个新模型 + 既有模型扩展：
 * - 各实体 create / query / update / 软删除
 * - JSON 列（objectives / successCriteria / acceptanceCriteria / consultedUserIds /
 *   informedUserIds / contactInfo）序列化-反序列化往返
 * - 关系 preload（parent/children/leader/charter/requirements/issues/
 *   stakeholders/communicationPlans/requirementTasks/...）无报错
 * - GanttBaselineSnapshot 新契约（baselineCostCents / totalBaselineCostCents）持久化
 */
import CommunicationPlan from '#models/communication_plan'
import Department from '#models/department'
import GanttBaseline from '#models/gantt_baseline'
import Issue from '#models/issue'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectCharter from '#models/project_charter'
import ProjectStakeholder from '#models/project_stakeholder'
import Requirement from '#models/requirement'
import RequirementTask from '#models/requirement_task'
import Task from '#models/task'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('W1 模型：departments 部门树', (group) => {
  useAuthDatabase(group)

  test('创建根/子部门、物化路径辅助与软删除', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-owner') })
    const org = await createOrganization(owner)
    const leader = await createUser({ email: uniqueEmail('dept-leader') })

    const root = await Department.create({
      organizationId: org.id,
      parentId: null,
      name: '研发中心',
      code: 'RD',
      leaderId: leader.id,
      sortOrder: 0,
      path: Department.childPathOf(null, 0), // 占位，下面用真实 id 重写
      depth: Department.childDepthOf(null),
      createdBy: owner.id,
    })
    // 物化路径以真实主键为基准
    root.path = Department.childPathOf(null, root.id)
    await root.save()
    assert.equal(root.path, `/${root.id}/`)
    assert.equal(root.depth, 0)

    const child = await Department.create({
      organizationId: org.id,
      parentId: root.id,
      name: '前端工程组',
      code: 'FE',
      sortOrder: 1,
      path: Department.childPathOf(root.path, 0),
      depth: Department.childDepthOf(root.depth),
      createdBy: owner.id,
    })
    child.path = Department.childPathOf(root.path, child.id)
    child.depth = Department.childDepthOf(root.depth)
    await child.save()
    assert.equal(child.path, `/${root.id}/${child.id}/`)
    assert.equal(child.depth, 1)

    // 存在子部门时物理删除父部门被 FK RESTRICT 拦截
    await assert.rejects(() => root.delete(), /FOREIGN KEY/i)
    const stillThere = await Department.query().where('id', root.id).first()
    assert.isNotNull(stillThere, 'RESTRICT 生效：父部门仍在')

    // 软删除根部门后普通查询不可见（子部门不受父软删除影响）
    root.deletedAt = DateTime.now()
    await root.save()
    const fetched = await Department.query().where('id', root.id).first()
    assert.isNull(fetched, '软删除后查询应不可见')
    const childStillVisible = await Department.query().where('id', child.id).first()
    assert.isNotNull(childStillVisible, '子部门不受父软删除影响')
  })

  test('parent/children/organization/leader/creator 关系 preload 无报错', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('dept-preload') })
    const org = await createOrganization(owner)
    const leader = await createUser({ email: uniqueEmail('dept-preload-leader') })

    const root = await Department.create({
      organizationId: org.id,
      name: '研发中心',
      code: `RD-${rootCodeSeq()}`,
      path: '/1/',
      createdBy: owner.id,
      leaderId: leader.id,
    })
    const child = await Department.create({
      organizationId: org.id,
      parentId: root.id,
      name: '后端工程组',
      code: `BE-${rootCodeSeq()}`,
      path: `/1/${root.id}/`,
      depth: 1,
      createdBy: owner.id,
    })

    const loadedRoot = await Department.query()
      .where('id', root.id)
      .preload('children')
      .preload('parent')
      .preload('organization')
      .preload('leader')
      .preload('creator')
      .firstOrFail()
    assert.equal(loadedRoot.children.length, 1)
    assert.equal(loadedRoot.children[0].id, child.id)
    assert.isNull(loadedRoot.parent)
    assert.equal(loadedRoot.organization.id, org.id)
    assert.equal(loadedRoot.leader!.id, leader.id)
    assert.equal(loadedRoot.creator.id, owner.id)

    const loadedChild = await Department.query()
      .where('id', child.id)
      .preload('parent')
      .preload('children')
      .firstOrFail()
    assert.equal(loadedChild.parent!.id, root.id)
    assert.equal(loadedChild.children.length, 0)
  })
})

let deptCodeSeq = 0
function rootCodeSeq(): number {
  deptCodeSeq += 1
  return (Date.now() % 100000) + deptCodeSeq
}

test.group('W1 模型：project_charters 章程', (group) => {
  useAuthDatabase(group)

  test('创建草案：JSON 往返、默认状态与版本', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('charter-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')

    const charter = await ProjectCharter.create({
      organizationId: org.id,
      projectId: project.id,
      title: 'CRM 升级项目章程',
      vision: '成为行业领先的客户平台',
      scope: '一期：客户主数据与销售管道',
      objectives: ['2026Q4 上线', 'CSAT >= 4.5'],
      successCriteria: ['验收标准 A', '验收标准 B'],
      startDate: DateTime.fromISO('2026-09-01'),
      endDate: DateTime.fromISO('2027-03-31'),
      businessCase: '存量系统维护成本高',
      createdBy: owner.id,
    })

    const fetched = await ProjectCharter.query().where('id', charter.id).firstOrFail()
    assert.deepEqual(fetched.objectives, ['2026Q4 上线', 'CSAT >= 4.5'])
    assert.deepEqual(fetched.successCriteria, ['验收标准 A', '验收标准 B'])
    assert.equal(fetched.approvalStatus, 'draft')
    assert.equal(fetched.version, 1)
    assert.isNull(fetched.approvedBy)
    assert.isNull(fetched.approvedAt)
    assert.equal(fetched.businessCase, '存量系统维护成本高')
    assert.equal(fetched.startDate.toISODate(), '2026-09-01')
    assert.equal(fetched.endDate.toISODate(), '2027-03-31')

    // 序列化输出 JSON 数组而非字符串
    const serialized = fetched.serialize()
    assert.deepEqual(serialized.objectives, ['2026Q4 上线', 'CSAT >= 4.5'])

    // 更新 + 软删除
    fetched.approvalStatus = 'pending_approval'
    fetched.updatedBy = owner.id
    await fetched.save()
    const pending = await ProjectCharter.find(fetched.id)
    assert.equal(pending!.approvalStatus, 'pending_approval')
    await pending!.delete()
    const gone = await ProjectCharter.find(fetched.id)
    assert.isNull(gone, '软删除后不可见')
  })

  test('project/approver/creator/updater 关系 preload 无报错', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('charter-preload') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const approver = await createUser({ email: uniqueEmail('charter-approver') })

    const charter = await ProjectCharter.create({
      organizationId: org.id,
      projectId: project.id,
      title: '章程 T',
      vision: 'v',
      scope: 's',
      objectives: [],
      successCriteria: [],
      startDate: DateTime.fromISO('2026-09-01'),
      endDate: DateTime.fromISO('2026-12-31'),
      approvalStatus: 'approved',
      approvedBy: approver.id,
      approvedAt: DateTime.fromISO('2026-08-20T08:00:00.000Z'),
      version: 2,
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const loaded = await ProjectCharter.query()
      .where('id', charter.id)
      .preload('project')
      .preload('approver')
      .preload('creator')
      .preload('updater')
      .firstOrFail()
    assert.equal(loaded.project.id, project.id)
    assert.equal(loaded.approver!.id, approver.id)
    assert.equal(loaded.creator.id, owner.id)
    assert.equal(loaded.updater!.id, owner.id)
    assert.isNotNull(loaded.approvedAt)
  })
})

test.group('W1 模型：requirements / requirement_tasks 需求与追溯', (group) => {
  useAuthDatabase(group)

  test('结构化验收准则 JSON 往返与状态机字段', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('req-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')

    const req = await Requirement.create({
      organizationId: org.id,
      projectId: project.id,
      code: 'REQ-001',
      title: '客户主数据去重',
      description: '按统一信用代码去重',
      category: 'functional',
      priority: 'high',
      acceptanceCriteria: [
        { id: 'c1', statement: '同代码客户只保留一条主记录', status: 'pending' },
        { id: 'c2', statement: '重复率报告可导出', status: 'failed' },
      ],
      createdBy: owner.id,
    })

    const fetched = await Requirement.query().where('id', req.id).firstOrFail()
    assert.deepEqual(fetched.acceptanceCriteria, [
      { id: 'c1', statement: '同代码客户只保留一条主记录', status: 'pending' },
      { id: 'c2', statement: '重复率报告可导出', status: 'failed' },
    ])
    assert.equal(fetched.category, 'functional')
    assert.equal(fetched.priority, 'high')
    assert.equal(fetched.status, 'draft')

    // 单独更新验收项状态 pending -> passed
    fetched.acceptanceCriteria = [
      { id: 'c1', statement: '同代码客户只保留一条主记录', status: 'passed' },
      { id: 'c2', statement: '重复率报告可导出', status: 'failed' },
    ]
    fetched.status = 'in_progress'
    fetched.updatedBy = owner.id
    await fetched.save()
    const updated = await Requirement.find(req.id)
    assert.equal(updated!.acceptanceCriteria[0].status, 'passed')
    assert.equal(updated!.status, 'in_progress')

    // 软删除
    await updated!.delete()
    assert.isNull(await Requirement.find(req.id))
  })

  test('默认 acceptanceCriteria 为空数组且唯一 (project_id, code) 生效', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('req-default') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')

    const req = await Requirement.create({
      organizationId: org.id,
      projectId: project.id,
      code: 'REQ-100',
      title: '默认验收数组',
      createdBy: owner.id,
    })
    await req.refresh()
    assert.deepEqual(req.acceptanceCriteria, [])

    await assert.rejects(
      () =>
        Requirement.create({
          organizationId: org.id,
          projectId: project.id,
          code: 'REQ-100',
          title: '重复编号',
          createdBy: owner.id,
        }),
      /UNIQUE/i,
    )
  })

  test('RequirementTask 绑定与 requirement/task/requirementTasks preload', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('req-link') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const req = await Requirement.create({
      organizationId: org.id,
      projectId: project.id,
      code: 'REQ-200',
      title: '待绑定需求',
      createdBy: owner.id,
    })
    const task = await Task.create({
      projectId: project.id,
      name: '交付任务',
    })

    await RequirementTask.create({
      organizationId: org.id,
      requirementId: req.id,
      taskId: task.id,
    })

    const loadedReq = await Requirement.query()
      .where('id', req.id)
      .preload('requirementTasks', (q) => q.preload('task'))
      .firstOrFail()
    assert.equal(loadedReq.requirementTasks.length, 1)
    assert.equal(loadedReq.requirementTasks[0].task.id, task.id)

    const loadedTask = await Task.query()
      .where('id', task.id)
      .preload('requirementTasks', (q) => q.preload('requirement'))
      .firstOrFail()
    assert.equal(loadedTask.requirementTasks.length, 1)
    assert.equal(loadedTask.requirementTasks[0].requirement.id, req.id)

    const pivot = await RequirementTask.query()
      .where('requirement_id', req.id)
      .preload('requirement')
      .preload('task')
      .firstOrFail()
    assert.equal(pivot.requirement.id, req.id)
    assert.equal(pivot.task.id, task.id)
    assert.isNotNull(pivot.createdAt)
  })
})

test.group('W1 模型：tasks 扩展列（RACI + LOB）', (group) => {
  useAuthDatabase(group)

  test('consulted/informed 用户 JSON 往返，默认空数组', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('task-raci') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const u1 = await createUser({ email: uniqueEmail('task-raci-1') })
    const u2 = await createUser({ email: uniqueEmail('task-raci-2') })

    const task = await Task.create({
      projectId: project.id,
      name: 'RACI 任务',
      consultedUserIds: [u1.id, u2.id],
      informedUserIds: [owner.id],
    })
    const fetched = await Task.query().where('id', task.id).firstOrFail()
    assert.deepEqual(fetched.consultedUserIds, [u1.id, u2.id])
    assert.deepEqual(fetched.informedUserIds, [owner.id])

    const serialized = fetched.serialize()
    assert.deepEqual(serialized.consultedUserIds, [u1.id, u2.id])

    const noRaci = await Task.create({ projectId: project.id, name: '无 RACI 任务' })
    await noRaci.refresh()
    assert.deepEqual(noRaci.consultedUserIds, [])
    assert.deepEqual(noRaci.informedUserIds, [])
  })

  test('location_unit / cycle_stage 更新往返', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('task-lob') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')

    const task = await Task.create({
      projectId: project.id,
      name: 'Floor-1 结构施工',
      locationUnit: 'Floor-1',
      cycleStage: '结构施工',
    })
    task.cycleStage = '水电预埋'
    await task.save()

    const fetched = await Task.find(task.id)
    assert.equal(fetched!.locationUnit, 'Floor-1')
    assert.equal(fetched!.cycleStage, '水电预埋')
  })
})

test.group('W1 模型：issues 议题', (group) => {
  useAuthDatabase(group)

  test('登记议题、状态机字段与软删除', async ({ assert }) => {
    const reporter = await createUser({ email: uniqueEmail('issue-reporter') })
    const org = await createOrganization(reporter)
    const { project } = await createProjectWithMember(org, reporter, reporter, 'project_manager')
    const assignee = await createUser({ email: uniqueEmail('issue-assignee') })
    const task = await Task.create({ projectId: project.id, name: '缺陷宿主任务' })

    const issue = await Issue.create({
      organizationId: org.id,
      projectId: project.id,
      relatedTaskId: task.id,
      reportedBy: reporter.id,
      assigneeId: assignee.id,
      code: 'ISS-001',
      title: '导出报表时偶发超时',
      description: '>1000 行时复现',
      type: 'bug',
      severity: 'major',
      priority: 'high',
    })
    const fetched = await Issue.query().where('id', issue.id).firstOrFail()
    assert.equal(fetched.status, 'open')
    assert.equal(fetched.type, 'bug')
    assert.equal(fetched.severity, 'major')
    assert.equal(fetched.priority, 'high')

    fetched.status = 'in_progress'
    await fetched.save()
    fetched.status = 'resolved'
    fetched.rootCause = '分页游标溢出'
    fetched.resolution = '改 keyset 分页'
    fetched.resolvedAt = DateTime.now()
    await fetched.save()

    const resolved = await Issue.find(issue.id)
    assert.equal(resolved!.status, 'resolved')
    assert.equal(resolved!.rootCause, '分页游标溢出')
    assert.isNotNull(resolved!.resolvedAt)

    resolved!.status = 'closed'
    resolved!.closedAt = DateTime.now()
    await resolved!.save()
    const closed = await Issue.find(issue.id)
    assert.equal(closed!.status, 'closed')
    assert.isNotNull(closed!.closedAt)

    await closed!.delete()
    assert.isNull(await Issue.find(issue.id))
  })

  test('project/relatedTask/reporter/assignee 关系 preload 无报错', async ({ assert }) => {
    const reporter = await createUser({ email: uniqueEmail('issue-preload') })
    const org = await createOrganization(reporter)
    const { project } = await createProjectWithMember(org, reporter, reporter, 'project_manager')
    const task = await Task.create({ projectId: project.id, name: '宿主' })

    const issue = await Issue.create({
      organizationId: org.id,
      projectId: project.id,
      relatedTaskId: task.id,
      reportedBy: reporter.id,
      code: 'ISS-010',
      title: 'preload 用例',
    })
    const loaded = await Issue.query()
      .where('id', issue.id)
      .preload('project')
      .preload('relatedTask')
      .preload('reporter')
      .preload('assignee')
      .firstOrFail()
    assert.equal(loaded.project.id, project.id)
    assert.equal(loaded.relatedTask!.id, task.id)
    assert.equal(loaded.reporter.id, reporter.id)
    assert.isNull(loaded.assignee)
  })
})

test.group('W1 模型：project_stakeholders 干系人', (group) => {
  useAuthDatabase(group)

  test('内外部干系人登记、contactInfo JSON 往返与软删除', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stake-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const internal = await createUser({ email: uniqueEmail('stake-internal') })

    // 内部干系人绑定用户
    const s1 = await ProjectStakeholder.create({
      organizationId: org.id,
      projectId: project.id,
      userId: internal.id,
      name: '张总监',
      roleTitle: '信息化负责人',
      stakeholderType: 'internal',
      powerLevel: 'high',
      interestLevel: 'high',
      attitude: 'supportive',
      managementStrategy: 'manage_closely',
      contactInfo: { email: 'zhang@example.com', phone: '13800000000' },
      createdBy: owner.id,
    })
    // 外部干系人不绑用户
    const s2 = await ProjectStakeholder.create({
      organizationId: org.id,
      projectId: project.id,
      name: '监管机构代表',
      organizationName: '某监管局',
      stakeholderType: 'external',
      powerLevel: 'high',
      interestLevel: 'low',
      attitude: 'neutral',
      managementStrategy: 'keep_satisfied',
      contactInfo: { email: 'regulator@example.gov' },
      createdBy: owner.id,
    })

    const f1 = await ProjectStakeholder.find(s1.id)
    assert.equal(f1!.userId, internal.id)
    assert.deepEqual(f1!.contactInfo, { email: 'zhang@example.com', phone: '13800000000' })
    assert.equal(f1!.managementStrategy, 'manage_closely')
    const f2 = await ProjectStakeholder.find(s2.id)
    assert.isNull(f2!.userId)
    assert.equal(f2!.stakeholderType, 'external')
    assert.equal(f2!.powerLevel, 'high')
    assert.equal(f2!.interestLevel, 'low')
    assert.deepEqual(f2!.contactInfo, { email: 'regulator@example.gov' })

    f1!.powerLevel = 'medium'
    f1!.updatedBy = owner.id
    await f1!.save()
    assert.equal((await ProjectStakeholder.find(s1.id))!.powerLevel, 'medium')

    await f1!.delete()
    assert.isNull(await ProjectStakeholder.find(s1.id))
  })

  test('user null 外部干系人与 project/creator preload', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stake-preload') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const external = await ProjectStakeholder.create({
      organizationId: org.id,
      projectId: project.id,
      name: '外部专家',
      stakeholderType: 'external',
      createdBy: owner.id,
    })
    const loaded = await ProjectStakeholder.query()
      .where('id', external.id)
      .preload('project')
      .preload('user')
      .preload('creator')
      .firstOrFail()
    assert.equal(loaded.project.id, project.id)
    assert.isNull(loaded.user)
    assert.equal(loaded.creator.id, owner.id)
  })
})

test.group('W1 模型：communication_plans 沟通计划', (group) => {
  useAuthDatabase(group)

  test('创建（默认启停/频次/渠道）→ 配置变更 → 启停切换 → 软删除', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('comm-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')

    const plan = await CommunicationPlan.create({
      organizationId: org.id,
      projectId: project.id,
      ownerId: owner.id,
      name: '每周核心团队同步例会',
      communicationType: 'meeting',
      purpose: '对齐进度与风险',
      frequency: 'weekly',
      channel: 'video_conference',
      audience: '项目经理 + 各组长',
      deliverable: '会议纪要',
      createdBy: owner.id,
    })
    const f1 = await CommunicationPlan.find(plan.id)
    assert.equal(f1!.isActive, true)
    assert.equal(f1!.frequency, 'weekly')
    assert.equal(f1!.channel, 'video_conference')
    assert.equal(f1!.reportTemplateKey, null)

    f1!.frequency = 'monthly'
    f1!.reportTemplateKey = 'monthly_progress_report'
    f1!.isActive = false
    f1!.updatedBy = owner.id
    await f1!.save()
    const f2 = await CommunicationPlan.find(plan.id)
    assert.equal(f2!.frequency, 'monthly')
    assert.equal(f2!.reportTemplateKey, 'monthly_progress_report')
    assert.equal(f2!.isActive, false)

    f2!.isActive = true
    await f2!.save()
    assert.equal((await CommunicationPlan.find(plan.id))!.isActive, true)

    await f2!.delete()
    assert.isNull(await CommunicationPlan.find(plan.id))
  })

  test('project/owner/creator/updater 关系 preload 无报错', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('comm-preload') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const plan = await CommunicationPlan.create({
      organizationId: org.id,
      projectId: project.id,
      ownerId: owner.id,
      name: '月度干系人简报',
      communicationType: 'report',
      purpose: '干系人知会',
      frequency: 'monthly',
      channel: 'pdf_export',
      audience: '全体干系人',
      createdBy: owner.id,
    })
    const loaded = await CommunicationPlan.query()
      .where('id', plan.id)
      .preload('project')
      .preload('owner')
      .preload('creator')
      .preload('updater')
      .firstOrFail()
    assert.equal(loaded.project.id, project.id)
    assert.equal(loaded.owner.id, owner.id)
    assert.equal(loaded.creator.id, owner.id)
    assert.isNull(loaded.updater)
  })
})

test.group('W1 模型：既有模型扩展关系', (group) => {
  useAuthDatabase(group)

  test('Project preload department/charter/requirements/issues/stakeholders/communicationPlans', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('proj-rel') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')

    const dept = await Department.create({
      organizationId: org.id,
      name: '交付中心',
      code: `DEL-${rootCodeSeq()}`,
      path: '/1/',
      createdBy: owner.id,
    })
    project.departmentId = dept.id
    await project.save()

    await ProjectCharter.create({
      organizationId: org.id,
      projectId: project.id,
      title: '预载章程',
      vision: 'v',
      scope: 's',
      objectives: ['o'],
      successCriteria: ['c'],
      startDate: DateTime.fromISO('2026-09-01'),
      endDate: DateTime.fromISO('2026-12-31'),
      createdBy: owner.id,
    })
    await Requirement.create({
      organizationId: org.id,
      projectId: project.id,
      code: 'REQ-P1',
      title: '预载需求',
      createdBy: owner.id,
    })
    const issue = await Issue.create({
      organizationId: org.id,
      projectId: project.id,
      reportedBy: owner.id,
      code: 'ISS-P1',
      title: '预载议题',
    })
    await ProjectStakeholder.create({
      organizationId: org.id,
      projectId: project.id,
      name: '预载干系人',
      createdBy: owner.id,
    })
    await CommunicationPlan.create({
      organizationId: org.id,
      projectId: project.id,
      ownerId: owner.id,
      name: '预载沟通计划',
      purpose: 'p',
      audience: 'a',
      createdBy: owner.id,
    })

    const loaded = await Project.query()
      .where('id', project.id)
      .preload('department')
      .preload('charter')
      .preload('requirements')
      .preload('issues')
      .preload('stakeholders')
      .preload('communicationPlans')
      .firstOrFail()
    assert.equal(loaded.department!.id, dept.id)
    assert.equal(loaded.charter!.title, '预载章程')
    assert.equal(loaded.requirements.length, 1)
    assert.equal(loaded.issues.length, 1)
    assert.equal(loaded.issues[0].id, issue.id)
    assert.equal(loaded.stakeholders.length, 1)
    assert.equal(loaded.communicationPlans.length, 1)
  })

  test('OrganizationMember.departmentId 与 department preload', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('orgmem-rel') })
    const org = await createOrganization(owner)
    const memberUser = await createUser({ email: uniqueEmail('orgmem-rel-member') })
    const dept = await Department.create({
      organizationId: org.id,
      name: '研发中心',
      code: `RDC-${rootCodeSeq()}`,
      path: '/1/',
      createdBy: owner.id,
    })
    const member = await OrganizationMember.create({
      organizationId: org.id,
      userId: memberUser.id,
      role: 'member',
      departmentId: dept.id,
    })
    const loaded = await OrganizationMember.query()
      .where('id', member.id)
      .preload('department')
      .preload('organization')
      .preload('user')
      .firstOrFail()
    assert.equal(loaded.departmentId, dept.id)
    assert.equal(loaded.department!.id, dept.id)
    assert.equal(loaded.organization.id, org.id)
  })

  test('Task preload requirementTasks / issues 无报错', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('task-rel') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const task = await Task.create({ projectId: project.id, name: '关系宿主任务' })
    const req = await Requirement.create({
      organizationId: org.id,
      projectId: project.id,
      code: 'REQ-T1',
      title: '任务侧需求',
      createdBy: owner.id,
    })
    await RequirementTask.create({
      organizationId: org.id,
      requirementId: req.id,
      taskId: task.id,
    })
    const issue = await Issue.create({
      organizationId: org.id,
      projectId: project.id,
      relatedTaskId: task.id,
      reportedBy: owner.id,
      code: 'ISS-T1',
      title: '任务侧议题',
    })

    const loaded = await Task.query()
      .where('id', task.id)
      .preload('requirementTasks', (q) => q.preload('requirement'))
      .preload('issues')
      .firstOrFail()
    assert.equal(loaded.requirementTasks.length, 1)
    assert.equal(loaded.requirementTasks[0].requirement.id, req.id)
    assert.equal(loaded.issues.length, 1)
    assert.equal(loaded.issues[0].id, issue.id)
  })

  test('GanttBaseline 快照新契约（baselineCostCents/totalBaselineCostCents）持久化', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('gantt-cost') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const task = await Task.create({
      projectId: project.id,
      name: '成本任务',
      costEstimateCents: 500000,
    })

    const snapshot = {
      tasks: [
        { id: task.id, startDate: '2026-09-01', endDate: '2026-09-15', baselineCostCents: 500000 },
      ],
      milestones: [],
      savedAt: DateTime.utc().toISO()!,
      totalBaselineCostCents: 500000,
    }
    const baseline = await GanttBaseline.create({
      projectId: project.id,
      createdBy: owner.id,
      snapshot,
    })
    const fetched = await GanttBaseline.query().where('id', baseline.id).firstOrFail()
    assert.equal(fetched.snapshot.tasks[0].baselineCostCents, 500000)
    assert.equal(fetched.snapshot.tasks[0].startDate, '2026-09-01')
    assert.equal(fetched.snapshot.totalBaselineCostCents, 500000)
    assert.deepEqual(fetched.snapshot, snapshot)

    // 序列化输出保持对象形状（不二次 stringify）
    const serialized = fetched.serialize()
    assert.equal(serialized.snapshot.totalBaselineCostCents, 500000)
  })
})
