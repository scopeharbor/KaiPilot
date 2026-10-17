/**
 * v3-triz-contradiction-copilot tasks 1.3 —— TRIZ 上下文包组装服务单测。
 *
 * 覆盖（tasks 1.3 验收 + spec「AI-as-ARIZ 后台语义映射」第 2 条 / 「对话求解的 RBAC 与组织隔离」第 1、3 条）：
 * - 五域只读组装：任务与关键路径 / 风险登记册 / 资源分配与负载 / 里程碑 / 变更请求；
 * - 组织隔离：跨组织项目统一 404；同组织其它项目实体不进读数与白名单；
 * - 权限裁剪：缺某域权限 ⇒ 该域整体缺席，且不发起该域读取；
 * - 白名单完整性：输出实体 ID 全部来自本项目；
 * - 有界：条目上限 + 体积上限 + 超限截断可断言；上限只允许收紧；
 * - 低敏与只读：标题截断不落全文、请求/包结构无陈述原文与 prompt 字段、组装全程零写库。
 */
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Milestone from '#models/milestone'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Risk from '#models/risk'
import Task from '#models/task'
import type User from '#models/user'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import ChangeRequestService from '#services/change_request_service'
import type RiskService from '#services/risk_service'
import TrizContextPackService, {
  TRIZ_CONTEXT_PACK_LIMITS,
  isContextRefWhitelisted,
  resolveTrizContextPackLimits,
  type TrizContextDomainKey,
  type TrizContextPack,
  type TrizContextPackLimits,
  type TrizContextPermissionChecker,
} from '#services/triz_copilot/triz_context_pack_service'
import { PROJECT_VIEW, RISK_VIEW, ProjectRoleName } from '#rbac'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

const SERVICE_PATH = 'app/services/triz_copilot/triz_context_pack_service.ts'

interface SeedResult {
  overdueCriticalTaskId: number
  riskId: number
  resourceId: number
  milestoneId: number
  changeRequestIds: number[]
}

async function seedOrgAndProject() {
  const owner = await createUser({ email: uniqueEmail('triz-pack') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

/** 把用户以只读观察者身份加入既有项目（组织侧角色另配 'viewer' → READONLY_OBSERVER）。 */
async function addReadonlyProjectMember(projectId: number, userId: number): Promise<void> {
  const role = await ProjectRole.create({
    projectId,
    name: ProjectRoleName.READONLY_OBSERVER,
    description: 'readonly',
    permissions: [] as unknown as string[],
    isSystem: true,
  })
  await ProjectMember.create({
    projectId,
    userId,
    projectRoleId: role.id,
    isActive: true,
  })
}

/** 种子事实：1 逾期关键任务 + 1 普通任务 + 1 已完成逾期任务 + 1 风险 + 1 过载资源 + 1 逾期里程碑 + 2 变更请求。 */
async function seedProjectFacts(
  orgId: number,
  projectId: number,
  ownerId: number,
): Promise<SeedResult> {
  const past = DateTime.now().minus({ days: 5 })

  const overdueCritical = await Task.create({
    projectId,
    name: '逾期关键任务：联调排期',
    status: 'in_progress',
    priority: 'high',
    taskType: 'task',
    endDate: past,
    isCriticalPath: true,
    progressPercent: 40,
  })
  await Task.create({
    projectId,
    name: '未开始任务',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
  })
  await Task.create({
    projectId,
    name: '已完成任务',
    status: 'completed',
    priority: 'low',
    taskType: 'task',
    endDate: past,
  })

  const risk = await Risk.create({
    organizationId: orgId,
    projectId,
    title: '关键路径任务延期风险',
    description: '描述',
    category: 'schedule',
    probability: 3,
    impact: 4,
    score: 12,
    status: 'identified',
    riskLevel: 'high',
    priority: 'high',
    identifiedAt: DateTime.now(),
    createdBy: ownerId,
  })

  const resource = await Resource.create({
    projectId,
    name: '工程师A',
    resourceType: 'human',
    role: 'member',
    dailyCapacityHours: 8,
  })
  await ResourceAllocation.create({
    resourceId: resource.id,
    taskId: overdueCritical.id,
    allocationType: 'assigned',
    allocationPercent: 90,
  })
  await ResourceAllocation.create({
    resourceId: resource.id,
    taskId: overdueCritical.id,
    allocationType: 'assigned',
    allocationPercent: 80,
  })

  const milestone = await Milestone.create({
    projectId,
    name: '上线里程碑',
    status: 'planned',
    plannedDate: DateTime.now().minus({ days: 1 }),
  })

  const changeRequests = await app.container.make(ChangeRequestService)
  const draft = await changeRequests.createDraft(
    orgId,
    projectId,
    { title: '范围变更草稿' },
    ownerId,
  )
  const submitted = await changeRequests.createDraft(
    orgId,
    projectId,
    { title: '排期变更待审' },
    ownerId,
  )
  await changeRequests.submit(orgId, projectId, submitted.id, ownerId)

  return {
    overdueCriticalTaskId: Number(overdueCritical.id),
    riskId: Number(risk.id),
    resourceId: Number(resource.id),
    milestoneId: Number(milestone.id),
    changeRequestIds: [Number(draft.id), Number(submitted.id)].sort((a, b) => a - b),
  }
}

function assemble(
  service: TrizContextPackService,
  params: { organizationId: number; projectId: number; user: User },
  extra: { asOfDate?: string; limits?: Partial<TrizContextPackLimits> } = {},
): Promise<TrizContextPack> {
  return service.assemble({ ...params, ...extra })
}

async function countRows(tables: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const row = await db.from(table).count('* as total').first()
    counts[table] = Number(row?.total ?? 0)
  }
  return counts
}

async function projectTaskIds(projectId: number): Promise<number[]> {
  const rows = await Task.query()
    .where('project_id', projectId)
    .whereNull('deleted_at')
    .orderBy('id')
  return rows.map((row) => Number(row.id))
}

test.group('TrizContextPackService（TRIZ 上下文包组装）', (group) => {
  useAuthDatabase(group)

  test('全权用户组装五域上下文，白名单实体 ID 全部来自本项目', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    const seed = await seedProjectFacts(org.id, project.id, owner.id)

    const pack = await assemble(new TrizContextPackService(), {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    })

    assert.deepEqual(
      Object.keys(pack.domains).sort(),
      ['changeRequests', 'milestones', 'resources', 'risks', 'tasks'],
      '五域齐备（任务与关键路径 / 风险 / 资源 / 里程碑 / 变更请求）',
    )
    assert.isEmpty(pack.trimmedDomains)
    assert.equal(pack.organizationId, Number(org.id))
    assert.equal(pack.projectId, Number(project.id))

    // 任务与关键路径读数
    assert.equal(pack.domains.tasks?.readings.total, 3)
    assert.equal(pack.domains.tasks?.readings.criticalPathCount, 1)
    assert.equal(pack.domains.tasks?.readings.overdueCount, 1)
    assert.equal(pack.domains.tasks?.readings.schedule.hasBaseline, false)
    assert.isNumber(pack.domains.tasks?.readings.schedule.spi)
    assert.deepEqual(pack.domains.tasks?.criticalPathTaskIds, [seed.overdueCriticalTaskId])

    // 风险读数（登记册 + 矩阵占用格）
    assert.equal(pack.domains.risks?.readings.total, 1)
    assert.isAbove(pack.domains.risks?.readings.matrixCells.length ?? 0, 0)

    // 资源分配与负载读数（两笔分配合计 170% → 过载）
    assert.equal(pack.domains.resources?.readings.resourceCount, 1)
    assert.equal(pack.domains.resources?.readings.overloadedResourceCount, 1)
    assert.isAbove(pack.domains.resources?.readings.teamAverageUtilizationPercent ?? 0, 100)

    // 里程碑读数（计划日已过 → missed）
    assert.equal(pack.domains.milestones?.readings.total, 1)
    assert.equal(pack.domains.milestones?.readings.byDisplayStatus.missed, 1)

    // 变更请求读数（1 草稿 + 1 待审）
    assert.equal(pack.domains.changeRequests?.readings.total, 2)
    assert.equal(pack.domains.changeRequests?.readings.pendingApprovalCount, 1)

    // 白名单完整性：逐类与库中本项目实体完全一致
    const dbTaskIds = await projectTaskIds(Number(project.id))
    assert.deepEqual(pack.entityWhitelist.taskIds, dbTaskIds)
    assert.deepEqual(pack.entityWhitelist.riskIds, [seed.riskId])
    assert.deepEqual(pack.entityWhitelist.resourceIds, [seed.resourceId])
    assert.deepEqual(pack.entityWhitelist.milestoneIds, [seed.milestoneId])
    assert.deepEqual(pack.entityWhitelist.changeRequestIds, seed.changeRequestIds)
    assert.equal(
      pack.entityWhitelist.refs.length,
      dbTaskIds.length + 5,
      'refs 与各 kind 数组一一对应',
    )

    // 白名单校验：命中真实体，拒绝编造 ID / 未知 kind / 非法格式
    assert.isTrue(isContextRefWhitelisted(pack, `task:${seed.overdueCriticalTaskId}`))
    assert.isTrue(isContextRefWhitelisted(pack, `change_request:${seed.changeRequestIds[0]}`))
    assert.isFalse(isContextRefWhitelisted(pack, 'task:999999'))
    assert.isFalse(isContextRefWhitelisted(pack, 'user:1'))
    assert.isFalse(isContextRefWhitelisted(pack, 'task:abc'))
  })

  test('同组织其它项目的实体不进入读数与白名单', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)

    const otherProject = await Project.create({
      organizationId: org.id,
      name: '同组织另一项目',
      code: `PX${Date.now()}`,
      createdBy: owner.id,
    })
    const foreignTask = await Task.create({
      projectId: otherProject.id,
      name: '其它项目的关键任务',
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      isCriticalPath: true,
      endDate: DateTime.now().minus({ days: 1 }),
    })
    await Risk.create({
      organizationId: org.id,
      projectId: otherProject.id,
      title: '其它项目风险',
      description: '描述',
      category: 'technical',
      probability: 4,
      impact: 4,
      score: 16,
      status: 'identified',
      riskLevel: 'critical',
      priority: 'high',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
    })

    const pack = await assemble(new TrizContextPackService(), {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    })

    assert.equal(pack.domains.tasks?.readings.total, 3, '不得把其它项目任务计入读数')
    assert.equal(pack.domains.risks?.readings.total, 1, '不得把其它项目风险计入读数')
    assert.notInclude(pack.entityWhitelist.taskIds, Number(foreignTask.id))

    const ownTaskIds = await projectTaskIds(Number(project.id))
    for (const id of pack.entityWhitelist.taskIds) {
      assert.include(ownTaskIds, id, `白名单任务 ${id} 必须属于本项目`)
    }
    assert.deepEqual(pack.entityWhitelist.taskIds, ownTaskIds)
  })

  test('跨组织项目：统一 404（不泄露存在性）', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)

    const outsider = await createUser({ email: uniqueEmail('triz-pack-out') })
    const outsiderOrg = await createOrganization(outsider)

    await assert.rejects(
      () =>
        assemble(new TrizContextPackService(), {
          organizationId: Number(outsiderOrg.id),
          projectId: Number(project.id),
          user: outsider,
        }),
      ResourceNotFoundException,
    )

    // 判定器报跨组织时同样按 404 处理，不得以 403 泄露存在性
    const crossOrgChecker: TrizContextPermissionChecker = {
      check: async () => ({ allowed: false, reason: 'cross_org_denied' }),
    }
    await assert.rejects(
      () =>
        assemble(new TrizContextPackService({ permissionChecker: crossOrgChecker }), {
          organizationId: Number(org.id),
          projectId: Number(project.id),
          user: owner,
        }),
      ResourceNotFoundException,
    )
  })

  test('权限裁剪（真实 RBAC）：只读观察者缺 resource:view / change_request:create，两域整体缺席', async ({
    assert,
  }) => {
    const { owner, org, project } = await seedOrgAndProject()
    const seed = await seedProjectFacts(org.id, project.id, owner.id)

    const viewer = await createUser({ email: uniqueEmail('triz-pack-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    await addReadonlyProjectMember(Number(project.id), Number(viewer.id))

    const pack = await assemble(new TrizContextPackService(), {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: viewer,
    })

    assert.isUndefined(pack.domains.resources, '无 resource:view ⇒ 资源域不得出现')
    assert.isUndefined(pack.domains.changeRequests, '无 change_request:create ⇒ 变更域不得出现')
    assert.isDefined(pack.domains.tasks)
    assert.isDefined(pack.domains.risks)
    assert.isDefined(pack.domains.milestones)

    assert.deepEqual(
      pack.trimmedDomains.map((entry) => entry.domain),
      ['resources', 'changeRequests'] as TrizContextDomainKey[],
    )
    assert.deepEqual(
      pack.trimmedDomains.map((entry) => entry.requiredPermission),
      ['resource:view', 'change_request:create'],
    )
    assert.include(pack.warnings, 'DOMAIN_TRIMMED')

    // 被裁域不得留下任何实体痕迹（白名单同样不得包含）
    assert.deepEqual(pack.entityWhitelist.resourceIds, [])
    assert.deepEqual(pack.entityWhitelist.changeRequestIds, [])
    assert.deepEqual(
      pack.entityWhitelist.refs.filter((ref) => ref.startsWith('resource:')),
      [],
    )
    assert.notInclude(pack.entityWhitelist.refs, `resource:${seed.resourceId}`)
  })

  test('权限裁剪（注入判定）：缺 risk:view 时风险域缺席，且不发起风险读取', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)

    let riskReadAttempted = false
    const denyingChecker: TrizContextPermissionChecker = {
      check: async (_user, permission) => ({ allowed: permission !== RISK_VIEW }),
    }
    const untouchedRiskService = {
      list: async () => {
        riskReadAttempted = true
        throw new Error('无 risk:view 时不得读取风险登记册')
      },
      matrix: async () => {
        riskReadAttempted = true
        throw new Error('无 risk:view 时不得读取风险矩阵')
      },
    } as unknown as RiskService

    const pack = await assemble(
      new TrizContextPackService({
        permissionChecker: denyingChecker,
        riskService: untouchedRiskService,
      }),
      { organizationId: Number(org.id), projectId: Number(project.id), user: owner },
    )

    assert.isUndefined(pack.domains.risks)
    assert.isFalse(riskReadAttempted, '被裁域必须零读取（不给越权读数留机会）')
    assert.deepEqual(pack.trimmedDomains, [
      { domain: 'risks', requiredPermission: 'risk:view', reason: 'missing_permission' },
    ])
    assert.isDefined(pack.domains.tasks, '单域裁剪不影响其它域')
    assert.deepEqual(pack.entityWhitelist.riskIds, [])
  })

  test('无 project:view 时拒绝组装（403），不返回任何域数据', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)

    const denyAllChecker: TrizContextPermissionChecker = {
      check: async (_user, permission) => ({ allowed: permission !== PROJECT_VIEW }),
    }

    await assert.rejects(
      () =>
        assemble(new TrizContextPackService({ permissionChecker: denyAllChecker }), {
          organizationId: Number(org.id),
          projectId: Number(project.id),
          user: owner,
        }),
      PermissionDeniedException,
    )
  })

  test('有界截断：条目数超上限即截断并标记，读数不受截断影响', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)
    for (let index = 0; index < 22; index += 1) {
      await Task.create({
        projectId: project.id,
        name: `批量任务 ${index}`,
        status: 'in_progress',
        priority: 'medium',
        taskType: 'task',
        endDate: DateTime.now().plus({ days: index + 1 }),
      })
    }

    const pack = await assemble(
      new TrizContextPackService(),
      { organizationId: Number(org.id), projectId: Number(project.id), user: owner },
      { limits: { maxTaskItems: 2 } },
    )

    assert.equal(pack.domains.tasks?.items.length, 2, '条目严格受上限约束')
    assert.equal(pack.domains.tasks?.readings.total, 25, '读数仍覆盖项目全量（不被截断污染）')
    assert.isTrue(pack.domains.tasks?.truncated)
    assert.isTrue(pack.truncated)
    assert.include(pack.warnings, 'CONTEXT_TRUNCATED')
    assert.equal(pack.limits.maxTaskItems, 2)
  })

  test('有界体积：默认上限内不溢出，收紧上限后条目被收缩且读数不变', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)
    for (let index = 0; index < 30; index += 1) {
      await Task.create({
        projectId: project.id,
        name: `体积任务 ${index} ${'长'.repeat(30)}`,
        status: 'in_progress',
        priority: 'medium',
        taskType: 'task',
        endDate: DateTime.now().plus({ days: index + 1 }),
      })
    }

    const params = { organizationId: Number(org.id), projectId: Number(project.id), user: owner }

    // 默认上限：条目按域上限收敛，整体体积不越默认上限（有界的硬保证）
    const defaultPack = await assemble(new TrizContextPackService(), params)
    assert.equal(defaultPack.domains.tasks?.items.length, TRIZ_CONTEXT_PACK_LIMITS.maxTaskItems)
    assert.isAtMost(
      Buffer.byteLength(JSON.stringify(defaultPack), 'utf8'),
      TRIZ_CONTEXT_PACK_LIMITS.maxSerializedBytes,
    )

    // 收紧字节上限：条目继续被丢弃直到落在上限内（读数不受影响）
    const tightened = await assemble(new TrizContextPackService(), params, {
      limits: { maxSerializedBytes: 1600 },
    })
    const bytes = Buffer.byteLength(JSON.stringify(tightened), 'utf8')
    assert.isAtMost(bytes, 1600, `上下文包体积 ${bytes} 必须落在上限内`)
    assert.isTrue(tightened.truncated)
    assert.include(tightened.warnings, 'CONTEXT_TRUNCATED')
    assert.isBelow(
      tightened.domains.tasks?.items.length ?? 0,
      defaultPack.domains.tasks?.items.length ?? 0,
      '体积收缩必须真的丢条目',
    )
    assert.equal(tightened.domains.tasks?.readings.total, 33, '收缩只减条目，读数保持全量口径')

    // 白名单与最终保留条目一致：被丢弃的实体不得残留 ref
    const retainedTaskRefs = tightened.entityWhitelist.refs.filter((ref) => ref.startsWith('task:'))
    assert.isAtMost(
      retainedTaskRefs.length,
      (tightened.domains.tasks?.items.length ?? 0) +
        (tightened.domains.tasks?.criticalPathTaskIds.length ?? 0),
    )
  })

  test('上限只允许收紧：传入更大的上限被忽略，字节下限被兜底', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    const seed = await seedProjectFacts(org.id, project.id, owner.id)

    const pack = await assemble(
      new TrizContextPackService(),
      { organizationId: Number(org.id), projectId: Number(project.id), user: owner },
      { limits: { maxTaskItems: 999, maxRiskItems: 999, maxSerializedBytes: 10_000_000 } },
    )

    assert.equal(pack.limits.maxTaskItems, TRIZ_CONTEXT_PACK_LIMITS.maxTaskItems)
    assert.equal(pack.limits.maxRiskItems, TRIZ_CONTEXT_PACK_LIMITS.maxRiskItems)
    assert.equal(pack.limits.maxSerializedBytes, TRIZ_CONTEXT_PACK_LIMITS.maxSerializedBytes)
    assert.equal(pack.domains.tasks?.readings.total, 3)
    assert.include(pack.entityWhitelist.taskIds, seed.overdueCriticalTaskId)

    // 非法/过小取值被忽略或兜底
    assert.equal(
      resolveTrizContextPackLimits({ maxRiskItems: 0, maxTaskItems: -3 }).maxRiskItems,
      TRIZ_CONTEXT_PACK_LIMITS.maxRiskItems,
    )
    assert.equal(resolveTrizContextPackLimits({ maxSerializedBytes: 1 }).maxSerializedBytes, 512)
  })

  test('组装全程零业务表写入', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)

    const tables = [
      'tasks',
      'risks',
      'resources',
      'resource_allocations',
      'milestones',
      'change_requests',
      'audit_logs',
    ]
    const before = await countRows(tables)

    await assemble(new TrizContextPackService(), {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    })

    assert.deepEqual(await countRows(tables), before, '组装不得写入任何业务表（含审计）')
  })

  test('条目排序确定：任务按逾期→关键路径→截止日，资源按过载优先，里程碑按滑移优先', async ({
    assert,
  }) => {
    const { owner, org, project } = await seedOrgAndProject()
    const asOfDate = DateTime.now().toISODate()!

    const overduePlain = await Task.create({
      projectId: project.id,
      name: '逾期非关键任务',
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.now().minus({ days: 1 }),
    })
    const criticalUpcoming = await Task.create({
      projectId: project.id,
      name: '关键路径未逾期任务',
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      isCriticalPath: true,
      endDate: DateTime.now().plus({ days: 5 }),
    })
    const plainUpcoming = await Task.create({
      projectId: project.id,
      name: '普通未逾期任务',
      status: 'not_started',
      priority: 'low',
      taskType: 'task',
      endDate: DateTime.now().plus({ days: 1 }),
    })

    const overloaded = await Resource.create({
      projectId: project.id,
      name: '过载资源',
      resourceType: 'human',
      role: 'member',
      dailyCapacityHours: 8,
    })
    const idle = await Resource.create({
      projectId: project.id,
      name: '空闲资源',
      resourceType: 'human',
      role: 'member',
      dailyCapacityHours: 8,
    })
    await ResourceAllocation.create({
      resourceId: overloaded.id,
      taskId: overduePlain.id,
      allocationType: 'assigned',
      allocationPercent: 130,
    })
    await ResourceAllocation.create({
      resourceId: idle.id,
      taskId: overduePlain.id,
      allocationType: 'assigned',
      allocationPercent: 30,
    })

    const missed = await Milestone.create({
      projectId: project.id,
      name: '已滑移里程碑',
      status: 'planned',
      plannedDate: DateTime.now().minus({ days: 10 }),
    })
    const upcoming = await Milestone.create({
      projectId: project.id,
      name: '未来里程碑',
      status: 'planned',
      plannedDate: DateTime.now().plus({ days: 30 }),
    })

    const pack = await assemble(
      new TrizContextPackService(),
      { organizationId: Number(org.id), projectId: Number(project.id), user: owner },
      { asOfDate },
    )

    assert.deepEqual(
      pack.domains.tasks?.items.map((fact) => fact.id),
      [Number(overduePlain.id), Number(criticalUpcoming.id), Number(plainUpcoming.id)],
    )
    assert.equal(pack.domains.tasks?.readings.overdueCount, 1)
    assert.equal(pack.domains.resources?.readings.overloadedResourceCount, 1)
    assert.deepEqual(
      pack.domains.resources?.items.map((fact) => fact.id),
      [Number(overloaded.id), Number(idle.id)],
    )
    assert.deepEqual(
      pack.domains.milestones?.items.map((fact) => fact.id),
      [Number(missed.id), Number(upcoming.id)],
    )
    assert.deepEqual(pack.domains.milestones?.readings.byDisplayStatus, { missed: 1, planned: 1 })
  })

  test('非法 asOfDate 被拒绝（422），不进入任何读取', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()

    await assert.rejects(
      () =>
        assemble(
          new TrizContextPackService(),
          { organizationId: Number(org.id), projectId: Number(project.id), user: owner },
          { asOfDate: '2026/06/15' },
        ),
      /asOfDate 必须为 YYYY-MM-DD/,
    )
  })

  test('低敏：超长标题被截断，上下文不出现实体标题全文', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    const longName = `超长任务标题${'冗'.repeat(120)}`
    const longTask = await Task.create({
      projectId: project.id,
      name: longName,
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      isCriticalPath: true,
      endDate: DateTime.now().minus({ days: 2 }),
    })

    const pack = await assemble(new TrizContextPackService(), {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    })

    const item = pack.domains.tasks?.items.find((fact) => fact.id === Number(longTask.id))
    assert.isDefined(item)
    assert.isBelow(item!.label.length, longName.length)
    assert.isTrue(item!.label.endsWith('…'))
    assert.notInclude(JSON.stringify(pack), longName, '上下文不得落实体标题全文')
  })

  test('确定性：同一输入两次组装，域内容与白名单完全一致', async ({ assert }) => {
    const { owner, org, project } = await seedOrgAndProject()
    await seedProjectFacts(org.id, project.id, owner.id)

    const service = new TrizContextPackService()
    const params = {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      user: owner,
    }
    const first = await assemble(service, params)
    const second = await assemble(service, params)

    assert.deepEqual(second.domains, first.domains)
    assert.deepEqual(second.entityWhitelist, first.entityWhitelist)
    assert.deepEqual(second.trimmedDomains, first.trimmedDomains)
    assert.deepEqual(second.limits, first.limits)
    assert.deepEqual(second.warnings, first.warnings)
  })

  test('静态红线：模块无写库调用，请求与包结构无陈述原文/prompt 字段', async ({ assert }) => {
    const source = readFileSync(app.makePath(SERVICE_PATH), 'utf8')
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

    for (const forbidden of [
      '.create(',
      '.update(',
      '.delete(',
      '.save(',
      '.insert(',
      '.truncate(',
      'db.transaction(',
      'aiGateway',
    ]) {
      assert.notInclude(code, forbidden, `上下文包组装不得出现写库/模型调用符号：${forbidden}`)
    }

    for (const block of [
      source.match(/export interface TrizContextPackRequest \{[\s\S]*?\n\}/)?.[0] ?? '',
      source.match(/export interface TrizContextPack \{[\s\S]*?\n\}/)?.[0] ?? '',
    ]) {
      assert.isNotEmpty(block, '结构定义必须存在')
      assert.notMatch(block, /statement|prompt|rawText|userInput|description/i)
    }
  })
})
