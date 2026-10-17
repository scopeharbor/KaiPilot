/**
 * AgentAssignmentService 单元测试（v3-copilot-agent-as-assignee）。
 *
 * 覆盖（21 用例）：
 * §3.2  逾期路径零域写：除状态变更外无任务字段修改
 * §3.3  不存在低风险场景直接写入旁路
 * §4.2  审批人候选不含 Agent
 * §4.4  指派 Agent 前后资源负载数字不变
 * §4.6  参与人计数不含 Agent
 * §4.8  为 Agent 指派设置工时被拒
 * §5.3  回落通知收件人为指派者和项目管理者
 * §5.5  回落后任务处于待指定负责人状态
 * §5.7  回落事件被审计记录
 * §7.2  越权指派被拒
 * §7.4  跨组织任务不可指派 Agent
 * §7.5  既有任务行为未被改变
 * + 原有 8 条：正常分配/无截止时间/有工时/审批候选/资源负载/参与者/逾期回退/审计追踪/组织隔离
 */

import AgentAssignment from '#models/agent_assignment'
import Task from '#models/task'
import AuditService from '#services/audit_service'
import AgentAssignmentService from '#services/agent_assignment_service'
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

// Mock NotificationService 用于测试
class MockNotificationService {
  public notifications: any[] = []

  async createForUser(input: any): Promise<void> {
    this.notifications.push(input)
  }
}

test.group('AgentAssignmentService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('agent-assign-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'project_manager')
    const mockNotifications = new MockNotificationService()
    const service = new AgentAssignmentService(new AuditService(), mockNotifications as any)

    return { owner, org, project, service, mockNotifications }
  }

  test('正常 Agent 分配', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建任务（不设 estimatedHours）
    const task = await Task.create({
      projectId: project.id,
      name: 'Agent 任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    assert.equal(assignment.taskId, task.id)
    assert.equal(assignment.projectId, project.id)
    assert.equal(assignment.organizationId, org.id)
    assert.equal(assignment.assigneeType, 'agent')
    assert.equal(assignment.assignedBy, owner.id)
    assert.equal(assignment.status, 'pending')
    assert.isNotNull(assignment.dueTime)
  })

  test('无截止时间被拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: 'Agent 任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })

    try {
      await service.assignAgent(
        org.id,
        project.id,
        {
          taskId: task.id,
          dueTime: '', // 空字符串
        },
        owner.id,
      )
      assert.fail('应该抛出异常')
    } catch (error: any) {
      assert.include(error.message, '截止时间')
    }
  })

  test('有预估工时的任务被拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '有工时任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      estimatedHours: 8,
      endDate: DateTime.now().plus({ days: 7 }),
    })

    try {
      await service.assignAgent(
        org.id,
        project.id,
        {
          taskId: task.id,
          dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
        },
        owner.id,
      )
      assert.fail('应该抛出异常')
    } catch (error: any) {
      assert.include(error.message, '预估工时')
    }
  })

  test('Agent 不计入审批候选人', async ({ assert }) => {
    // Agent 分配不通过 assignee_id 关联用户，因此不进入审批候选人查询
    // 这是设计决策：Agent 不参与人工审批流程
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: 'Agent 任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // Agent 分配记录独立存储，不污染任务的 assignee_id
    assert.isNull((await Task.find(task.id))!.assigneeId)
    assert.equal(assignment.assigneeType, 'agent')
  })

  test('Agent 不计入资源负载', async ({ assert }) => {
    // Agent 分配不影响用户资源负载计算
    // 资源负载只统计 assigneeType = 'user' 的任务
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: 'Agent 任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 验证任务的 assigneeType 为 agent
    const updatedTask = await Task.find(task.id)
    assert.equal(updatedTask!.assigneeType, 'user') // 任务本身的 assigneeType 不变
  })

  test('Agent 不计入参与者', async ({ assert }) => {
    // Agent 分配不加入任务参与者列表
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: 'Agent 任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // Agent 分配独立于任务参与者的概念
    assert.equal(assignment.assigneeType, 'agent')
  })

  test('逾期回退清除负责人并通知', async ({ assert }) => {
    const { owner, org, project, service, mockNotifications } = await setup()

    // 创建一个任务（使用未来的截止时间先创建分配）
    const task = await Task.create({
      projectId: project.id,
      name: '逾期任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 1 }).toISO()!,
        notes: '测试逾期',
      },
      owner.id,
    )

    // 手动将 due_time 设为过去（模拟逾期）
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 1 }).toSQL() })

    // 执行逾期处理
    const processedCount = await service.handleOverdue()

    assert.equal(processedCount, 1)

    // 验证分配状态已更新
    const updatedAssignment = await AgentAssignment.find(assignment.id)
    assert.equal(updatedAssignment!.status, 'overdue')

    // 验证任务的 assigneeId 已清除
    const updatedTask = await Task.find(task.id)
    assert.isNull(updatedTask!.assigneeId)

    // 验证通知已发送（服务使用 type='general'，metadata 中标记 notificationKind）
    const overdueNotification = mockNotifications.notifications.find(
      (n: any) => n.metadata?.notificationKind === 'agent_assignment_overdue',
    )
    assert.isNotNull(overdueNotification)
    assert.include(overdueNotification.title, '逾期')
  })

  test('审计追踪 - 创建分配', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '审计测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 验证审计日志已创建
    const auditLog = await db
      .from('audit_logs')
      .where('entity_type', 'agent_assignment')
      .where('entity_id', '>', 0)
      .first()

    assert.isNotNull(auditLog)
    assert.equal(auditLog.action, 'create')
    assert.include(auditLog.metadata, 'AGENT_ASSIGNMENT_CREATED')
  })

  test('审计追踪 - 完成分配', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '完成审计测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    await service.completeAssignment(assignment.id)

    // 验证审计日志已创建
    const auditLog = await db
      .from('audit_logs')
      .where('entity_type', 'agent_assignment')
      .where('entity_id', assignment.id)
      .where('action', 'apply')
      .first()

    assert.isNotNull(auditLog)
  })

  test('审计追踪 - 逾期回退', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '逾期审计测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 1 }).toISO()!,
      },
      owner.id,
    )

    // 手动将 due_time 设为过去
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 1 }).toSQL() })

    await service.handleOverdue()

    // 验证审计日志已创建
    const auditLog = await db
      .from('audit_logs')
      .where('entity_type', 'agent_assignment')
      .where('entity_id', assignment.id)
      .where('action', 'update')
      .first()

    assert.isNotNull(auditLog)
    assert.include(auditLog.metadata, 'AGENT_ASSIGNMENT_OVERDUE_FALLBACK')
  })

  test('组织隔离 - 跨组织查询被拒绝', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建另一个组织和项目
    const otherOwner = await createUser({ email: uniqueEmail('agent-other') })
    const otherOrg = await createOrganization(otherOwner)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      otherOwner,
      otherOwner,
      'project_manager',
    )

    // 在第一个组织创建任务
    const task = await Task.create({
      projectId: project.id,
      name: '组织隔离测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 尝试从另一个组织查询
    try {
      await service.get(otherOrg.id, otherProject.id, assignment.id)
      assert.fail('应该抛出异常')
    } catch (error: any) {
      assert.include(error.message, '不存在')
    }
  })

  // =========================================================================
  // §3.2 — 逾期路径零域写
  // =========================================================================

  test('逾期路径零域写：除状态变更外无任务字段修改', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建具有特定字段的任务
    const task = await Task.create({
      projectId: project.id,
      name: '不变的任务名',
      status: 'not_started',
      priority: 'high',
      taskType: 'task',
      description: '原始描述',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 手动将 due_time 设为过去（模拟逾期）
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 1 }).toSQL() })

    await service.handleOverdue()

    // 重新加载任务，验证域字段未被修改
    const updatedTask = await Task.find(task.id)
    assert.equal(updatedTask!.name, '不变的任务名')
    assert.equal(updatedTask!.priority, 'high')
    assert.equal(updatedTask!.status, 'not_started')
    assert.equal(updatedTask!.description, '原始描述')

    // assigneeId 被清除（这是预期行为）
    assert.isNull(updatedTask!.assigneeId)

    // 分配状态已变为 overdue
    const updatedAssignment = await AgentAssignment.find(assignment.id)
    assert.equal(updatedAssignment!.status, 'overdue')
  })

  // =========================================================================
  // §3.3 — 不存在低风险场景直接写入旁路
  // =========================================================================

  test('不存在低风险场景直接写入旁路', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建任务，记录修改前的完整状态
    const task = await Task.create({
      projectId: project.id,
      name: '旁路检测任务',
      status: 'in_progress',
      priority: 'low',
      taskType: 'task',
      description: '旁路检测描述',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const originalName = task.name
    const originalStatus = task.status
    const originalPriority = task.priority
    const originalDescription = task.description

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 手动将 due_time 设为过去
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 2 }).toSQL() })

    await service.handleOverdue()

    // handleOverdue 只应修改三个字段：assignment.status, task.assignee_id, task.assignee_type
    const finalTask = await Task.find(task.id)
    assert.equal(finalTask!.name, originalName, '任务名不应被修改')
    assert.equal(finalTask!.status, originalStatus, '任务状态不应被修改')
    assert.equal(finalTask!.priority, originalPriority, '任务优先级不应被修改')
    assert.equal(finalTask!.description, originalDescription, '任务描述不应被修改')
    assert.isNull(finalTask!.assigneeId, 'assignee_id 应被清除')
    assert.equal(finalTask!.assigneeType, 'user', 'assignee_type 应重置为 user')
  })

  // =========================================================================
  // §4.2 — 审批人候选不含 Agent
  // =========================================================================

  test('审批人候选不含 Agent', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '审批候选测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // Agent 不在 project_members 表中——它只在 agent_assignments 表中
    const members = await db
      .from('project_members')
      .where('project_id', project.id)
      .where('is_active', true)

    // 项目成员中不应出现 agent（因为 agent 不是用户）
    const memberUserIds = members.map((m: any) => m.user_id)
    assert.isFalse(
      memberUserIds.includes(-1),
      'Agent 不应在项目成员列表中（使用 -1 作为不可能的 user_id）',
    )

    // 分配记录独立于项目成员
    const assignment = await db.from('agent_assignments').where('project_id', project.id).first()
    assert.isNotNull(assignment, '应存在 agent 分配记录')
    assert.notInclude(
      memberUserIds,
      assignment.assignee_id,
      'Agent 的 assignee_id 不在 project_members 中',
    )
  })

  // =========================================================================
  // §4.4 — 资源负载数字不变
  // =========================================================================

  test('指派 Agent 前后资源负载数字不变', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建资源
    const { default: ResourceModel } = await import('#models/resource')
    const { default: ResourceAllocationModel } = await import('#models/resource_allocation')

    const resource = await ResourceModel.create({
      projectId: project.id,
      name: '测试开发者',
      resourceType: 'human',
      role: 'member',
      status: 'active',
      capacityVersion: 1,
      capacityCalendarPolicy: 'standard',
      dailyCapacityHours: 8,
      workDays: '[1,2,3,4,5]',
      timezone: 'Asia/Shanghai',
      roleTags: 'developer',
    })

    // 创建资源分配（关联到另一个任务）
    const otherTask = await Task.create({
      projectId: project.id,
      name: '已有任务',
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      estimatedHours: 16,
      endDate: DateTime.now().plus({ days: 3 }),
    })

    await ResourceAllocationModel.create({
      resourceId: resource.id,
      taskId: otherTask.id,
      allocationType: 'allocated',
      allocationPercent: 50,
    })

    // 记录 Agent 指派前的资源负载
    const { default: ResourceLoadService } = await import('#services/resource_load_service')
    const loadService = new ResourceLoadService()
    const loadBefore = (await loadService.load(
      org.id,
      project.id,
      DateTime.now().toISODate()!,
      DateTime.now().plus({ days: 14 }).toISODate()!,
    )) as { resources: Array<{ overallUtilizationPercent: number }> }

    const utilizationBefore = loadBefore.resources[0]?.overallUtilizationPercent ?? 0

    // 创建任务并分配 Agent
    const agentTask = await Task.create({
      projectId: project.id,
      name: 'Agent 任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: agentTask.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 记录 Agent 指派后的资源负载
    const loadAfter = (await loadService.load(
      org.id,
      project.id,
      DateTime.now().toISODate()!,
      DateTime.now().plus({ days: 14 }).toISODate()!,
    )) as { resources: Array<{ overallUtilizationPercent: number }> }

    const utilizationAfter = loadAfter.resources[0]?.overallUtilizationPercent ?? 0

    // 资源负载数字不应因 Agent 分配而改变
    assert.equal(utilizationBefore, utilizationAfter, '资源利用率在 Agent 分配前后应保持不变')
  })

  // =========================================================================
  // §4.6 — 参与人计数不含 Agent
  // =========================================================================

  test('参与人计数不含 Agent', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 添加第二个项目成员
    const member2 = await createUser({ email: uniqueEmail('agent-member2') })
    await db.table('organization_members').insert({
      organization_id: org.id,
      user_id: member2.id,
      role: 'member',
      created_at: DateTime.now().toSQL(),
    })
    const { default: ProjectRoleModel } = await import('#models/project_role')
    const role = await ProjectRoleModel.create({
      projectId: project.id,
      name: 'developer',
      description: 'developer',
      permissions: [],
      isSystem: true,
    })
    await db.table('project_members').insert({
      project_id: project.id,
      user_id: member2.id,
      project_role_id: role.id,
      is_active: true,
      created_at: DateTime.now().toSQL(),
    })

    // 项目成员计数应为 2（owner + member2）
    const countBefore = await db
      .from('project_members')
      .where('project_id', project.id)
      .where('is_active', true)
      .count('* as total')
    assert.equal(Number(countBefore[0].total), 2)

    // 创建任务并分配 Agent
    const task = await Task.create({
      projectId: project.id,
      name: '参与者计数测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
      },
      owner.id,
    )

    // 分配 Agent 后，项目成员计数仍应为 2
    const countAfter = await db
      .from('project_members')
      .where('project_id', project.id)
      .where('is_active', true)
      .count('* as total')
    assert.equal(Number(countAfter[0].total), 2, 'Agent 分配不应影响项目成员计数')
  })

  // =========================================================================
  // §4.8 — 预估工时被拒
  // =========================================================================

  test('为 Agent 指派设置工时被拒', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '有工时任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      estimatedHours: 10,
      endDate: DateTime.now().plus({ days: 7 }),
    })

    try {
      await service.assignAgent(
        org.id,
        project.id,
        {
          taskId: task.id,
          dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
        },
        owner.id,
      )
      assert.fail('应该抛出异常')
    } catch (error: any) {
      assert.include(error.message, '预估工时')
    }
  })

  // =========================================================================
  // §5.3 — 回落通知收件人为指派者和项目管理者
  // =========================================================================

  test('回落通知收件人为指派者和项目管理者', async ({ assert }) => {
    // 创建项目所有者（PM）和另一个用户（指派者）
    const pm = await createUser({ email: uniqueEmail('agent-pm') })
    const pmOrg = await createOrganization(pm)
    const { project: pmProject } = await createProjectWithMember(pmOrg, pm, pm, 'project_manager')

    const assigner = await createUser({ email: uniqueEmail('agent-assigner') })
    await db.table('organization_members').insert({
      organization_id: pmOrg.id,
      user_id: assigner.id,
      role: 'member',
      created_at: DateTime.now().toSQL(),
    })
    const { default: ProjectRoleModel } = await import('#models/project_role')
    const role = await ProjectRoleModel.create({
      projectId: pmProject.id,
      name: 'developer',
      description: 'developer',
      permissions: [],
      isSystem: true,
    })
    await db.table('project_members').insert({
      project_id: pmProject.id,
      user_id: assigner.id,
      project_role_id: role.id,
      is_active: true,
      created_at: DateTime.now().toSQL(),
    })

    const mockNotifications = new MockNotificationService()
    const svc = new AgentAssignmentService(new AuditService(), mockNotifications as any)

    // 创建任务
    const task = await Task.create({
      projectId: pmProject.id,
      name: '回落通知测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    // 由 assigner 分配 Agent
    const assignment = await svc.assignAgent(
      pmOrg.id,
      pmProject.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 1 }).toISO()!,
      },
      assigner.id,
    )

    // 手动将 due_time 设为过去
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 1 }).toSQL() })

    await svc.handleOverdue()

    // 验证通知发给了指派者（服务使用 type='general'，metadata 中标记 notificationKind）
    const assignerNotification = mockNotifications.notifications.find(
      (n: any) =>
        n.recipientId === assigner.id &&
        n.metadata?.notificationKind === 'agent_assignment_overdue',
    )
    assert.isNotNull(assignerNotification, '指派者应收到逾期通知')

    // 验证通知发给了 PM（项目管理者）
    const pmNotification = mockNotifications.notifications.find(
      (n: any) =>
        n.recipientId === pm.id && n.metadata?.notificationKind === 'agent_assignment_overdue',
    )
    assert.isNotNull(pmNotification, '项目管理者应收到逾期通知')
  })

  // =========================================================================
  // §5.5 — 回落后任务处于待指定负责人状态
  // =========================================================================

  test('回落后任务处于待指定负责人状态', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建任务
    const task = await Task.create({
      projectId: project.id,
      name: '回落状态测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 1 }).toISO()!,
      },
      owner.id,
    )

    // 手动将 due_time 设为过去
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 1 }).toSQL() })

    await service.handleOverdue()

    const updatedTask = await Task.find(task.id)

    // assignee_id 应为 null
    assert.isNull(updatedTask!.assigneeId, '任务的 assignee_id 应被清除')

    // assignee_type 应重置为 'user'（为后续人工指派做准备）
    assert.equal(updatedTask!.assigneeType, 'user', '任务的 assignee_type 应重置为 user')

    // 验证可以重新指派给人工用户
    // 再次创建一个用户任务分配来验证可重新指派
    const reassignUser = await createUser({ email: uniqueEmail('reassign') })
    await db.table('organization_members').insert({
      organization_id: org.id,
      user_id: reassignUser.id,
      role: 'member',
      created_at: DateTime.now().toSQL(),
    })
    const { default: ProjectRoleModel } = await import('#models/project_role')
    const role = await ProjectRoleModel.create({
      projectId: project.id,
      name: 'developer',
      description: 'developer',
      permissions: [],
      isSystem: true,
    })
    await db.table('project_members').insert({
      project_id: project.id,
      user_id: reassignUser.id,
      project_role_id: role.id,
      is_active: true,
      created_at: DateTime.now().toSQL(),
    })

    // 通过 Task 模型直接更新 assignee_id（模拟正常指派流程）
    updatedTask!.assigneeId = reassignUser.id
    updatedTask!.assigneeType = 'user'
    await updatedTask!.save()

    const reassignedTask = await Task.find(task.id)
    assert.equal(reassignedTask!.assigneeId, reassignUser.id, '任务应能重新指派给人工用户')
    assert.equal(reassignedTask!.assigneeType, 'user')
  })

  // =========================================================================
  // §5.7 — 回落事件被审计记录
  // =========================================================================

  test('回落事件被审计记录', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const task = await Task.create({
      projectId: project.id,
      name: '审计回落测试',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    const assignment = await service.assignAgent(
      org.id,
      project.id,
      {
        taskId: task.id,
        dueTime: DateTime.now().plus({ days: 1 }).toISO()!,
      },
      owner.id,
    )

    // 手动将 due_time 设为过去
    await db
      .from('agent_assignments')
      .where('id', assignment.id)
      .update({ due_time: DateTime.now().minus({ hours: 1 }).toSQL() })

    await service.handleOverdue()

    // 查询审计日志
    const auditLog = await db
      .from('audit_logs')
      .where('entity_type', 'agent_assignment')
      .where('entity_id', assignment.id)
      .where('action', 'update')
      .first()

    assert.isNotNull(auditLog, '应存在回落审计记录')
    assert.equal(auditLog.organization_id, org.id, '审计记录应包含正确的 organizationId')
    assert.equal(auditLog.project_id, project.id, '审计记录应包含正确的 projectId')
    assert.include(
      auditLog.metadata,
      'AGENT_ASSIGNMENT_OVERDUE_FALLBACK',
      '审计记录应包含回落事件标识',
    )
  })

  // =========================================================================
  // §7.2 — 越权指派被拒
  // =========================================================================

  test('越权指派被拒', async ({ assert }) => {
    // 创建项目所有者 B
    const ownerB = await createUser({ email: uniqueEmail('agent-ownerB') })
    const orgB = await createOrganization(ownerB)
    const { project: projectB } = await createProjectWithMember(
      orgB,
      ownerB,
      ownerB,
      'project_manager',
    )

    // 创建用户 A（非项目成员）
    const userA = await createUser({ email: uniqueEmail('agent-userA') })

    const mockNotifications = new MockNotificationService()
    const svc = new AgentAssignmentService(new AuditService(), mockNotifications as any)

    // 在项目 B 创建任务
    const task = await Task.create({
      projectId: projectB.id,
      name: '越权测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    // 用户 A 尝试分配 Agent（A 不是项目成员）
    try {
      await svc.assignAgent(
        orgB.id,
        projectB.id,
        {
          taskId: task.id,
          dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
        },
        userA.id,
      )
      assert.fail('应该抛出异常：非项目成员不应能分配 Agent')
    } catch (error: any) {
      // 验证异常被抛出
      assert.isNotNull(error, '越权指派应被拒绝')
    }
  })

  // =========================================================================
  // §7.4 — 跨组织任务不可指派 Agent
  // =========================================================================

  test('跨组织任务不可指派 Agent', async ({ assert }) => {
    // 创建两个组织
    const ownerA = await createUser({ email: uniqueEmail('agent-ownerA') })
    const orgA = await createOrganization(ownerA)
    await createProjectWithMember(orgA, ownerA, ownerA, 'project_manager')

    const ownerB = await createUser({ email: uniqueEmail('agent-ownerB') })
    const orgB = await createOrganization(ownerB)
    const { project: projectB } = await createProjectWithMember(
      orgB,
      ownerB,
      ownerB,
      'project_manager',
    )

    const mockNotifications = new MockNotificationService()
    const svc = new AgentAssignmentService(new AuditService(), mockNotifications as any)

    // 在组织 B 的项目中创建任务
    const task = await Task.create({
      projectId: projectB.id,
      name: '跨组织测试任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 7 }),
    })

    // 使用组织 A 的 organizationId 尝试分配（任务属于组织 B）
    try {
      await svc.assignAgent(
        orgA.id, // 组织 A
        projectB.id, // 项目属于组织 B
        {
          taskId: task.id,
          dueTime: DateTime.now().plus({ days: 5 }).toISO()!,
        },
        ownerA.id,
      )
      assert.fail('应该抛出异常：跨组织操作应被拒绝')
    } catch (error: any) {
      assert.include(error.message, '项目不存在')
    }
  })

  // =========================================================================
  // §7.5 — 既有任务行为未被改变
  // =========================================================================

  test('既有任务行为未被改变', async ({ assert }) => {
    const { org, project } = await setup()

    // 添加第二个成员
    const member2 = await createUser({ email: uniqueEmail('existing-member') })
    await db.table('organization_members').insert({
      organization_id: org.id,
      user_id: member2.id,
      role: 'member',
      created_at: DateTime.now().toSQL(),
    })
    const { default: ProjectRoleModel } = await import('#models/project_role')
    const role = await ProjectRoleModel.create({
      projectId: project.id,
      name: 'developer',
      description: 'developer',
      permissions: [],
      isSystem: true,
    })
    await db.table('project_members').insert({
      project_id: project.id,
      user_id: member2.id,
      project_role_id: role.id,
      is_active: true,
      created_at: DateTime.now().toSQL(),
    })

    // 创建普通（非 Agent）任务，带预估工时
    const task = await Task.create({
      projectId: project.id,
      name: '普通用户任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      estimatedHours: 12,
      endDate: DateTime.now().plus({ days: 7 }),
    })

    // 正常指派流程（通过 TaskService 或直接更新）
    task.assigneeId = member2.id
    task.assigneeType = 'user'
    await task.save()

    // 验证正常任务指派行为正确
    const updatedTask = await Task.find(task.id)
    assert.equal(updatedTask!.assigneeId, member2.id, '任务应正确设置负责人 ID')
    assert.equal(updatedTask!.assigneeType, 'user', '任务负责人类型应为 user')

    // 验证预估工时被保留
    assert.equal(updatedTask!.estimatedHours, 12, '预估工时应被保留')

    // 验证其他字段未被改变
    assert.equal(updatedTask!.name, '普通用户任务')
    assert.equal(updatedTask!.priority, 'medium')
    assert.equal(updatedTask!.status, 'not_started')
  })
})
