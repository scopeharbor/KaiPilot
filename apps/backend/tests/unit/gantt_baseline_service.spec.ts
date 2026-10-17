import { ResourceNotFoundException } from '#exceptions/api_exception'
import AuditLog from '#models/audit_log'
import GanttBaseline from '#models/gantt_baseline'
import Milestone from '#models/milestone'
import Task from '#models/task'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import GanttBaselineService from '#services/gantt_baseline_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('GanttBaselineService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('baseline-owner') })
    const organization = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      organization,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return {
      owner,
      organization,
      project,
      service: new GanttBaselineService(new AuditService()),
    }
  }

  test('保存任务/里程碑最小快照并写审计', async ({ assert }) => {
    const { owner, organization, project, service } = await setup()
    const task = await Task.create({
      projectId: project.id,
      name: '开发',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-12'),
    })
    const milestone = await Milestone.create({
      projectId: project.id,
      name: '冻结',
      status: 'planned',
      plannedDate: DateTime.fromISO('2026-07-15'),
      displayOrder: 0,
    })

    const baseline = await service.save(organization.id, project.id, owner.id)
    assert.deepInclude(baseline.snapshot.tasks[0], {
      id: task.id,
      startDate: '2026-07-10',
      endDate: '2026-07-12',
    })
    assert.deepInclude(baseline.snapshot.milestones[0], {
      id: milestone.id,
      plannedDate: '2026-07-15',
    })
    const log = await AuditLog.query()
      .where('project_id', project.id)
      .where('entity_type', 'project')
      .where('action', 'update')
      .first()
    assert.equal(log?.metadata?.event, 'GANTT_BASELINE_SAVED')
  })

  test('再次保存覆盖同一基线，不新增第二行', async ({ assert }) => {
    const { owner, organization, project, service } = await setup()
    const first = await service.save(organization.id, project.id, owner.id)
    const second = await service.save(organization.id, project.id, owner.id)
    assert.equal(second.id, first.id)
    assert.equal(
      await GanttBaseline.query()
        .where('project_id', project.id)
        .count('* as total')
        .then((rows) => Number(rows[0].$extras.total)),
      1,
    )
  })

  test('无基线读取返回 null', async ({ assert }) => {
    const { organization, project, service } = await setup()
    assert.isNull(await service.get(organization.id, project.id))
  })

  test('跨组织项目读取返回 404 语义', async ({ assert }) => {
    const { project, service } = await setup()
    const outsider = await createUser({ email: uniqueEmail('baseline-outsider') })
    const otherOrganization = await createOrganization(outsider)
    await assert.rejects(
      () => service.get(otherOrganization.id, project.id),
      ResourceNotFoundException,
    )
  })
})
