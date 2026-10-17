import AuditLog from '#models/audit_log'
import CompilerArtifact from '#models/compiler_artifact'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import TaskResourceRequirement from '#models/task_resource_requirement'
import { ProjectRoleName, RESOURCE_VIEW } from '#rbac'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import type User from '#models/user'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken
}

async function createTask(projectId: number, overrides: Record<string, unknown> = {}) {
  const [taskId] = await db.table('tasks').insert({
    project_id: projectId,
    name: '资源 API 测试任务',
    status: 'not_started',
    start_date: '2026-10-01',
    end_date: '2026-10-03',
    created_at: new Date().toISOString(),
    ...overrides,
  })
  return taskId
}

async function createResource(projectId: number, overrides: Partial<Resource> = {}) {
  return Resource.create({
    projectId,
    name: '前端资源',
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: JSON.stringify(['React']),
    roleTags: JSON.stringify(['frontend']),
    ...overrides,
  })
}

test.group('V2 Resource Management API', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rm-v2-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  test('planning requirements and matching endpoints are scoped and zero-write', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupProject()
    const token = await login(client, owner)
    const taskId = await createTask(Number(project.id))
    const resource = await createResource(Number(project.id))

    const createRequirement = await client
      .post(`/api/v1/projects/${project.id}/resources/requirements`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId,
        role: 'frontend',
        skillTags: ['React'],
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        priority: 'high',
      })
    createRequirement.assertStatus(201)
    const requirementId = createRequirement.body().data.id

    const planning = await client
      .get(`/api/v1/projects/${project.id}/resources/planning`)
      .qs({ from: '2026-10-01', to: '2026-10-03' })
      .header('Authorization', `Bearer ${token}`)
    planning.assertStatus(200)
    assert.equal(planning.body().data.summary.totalResources, 1)
    assert.equal(planning.body().data.matrix[0].resourceId, resource.id)

    const requirements = await client
      .get(`/api/v1/projects/${project.id}/resources/requirements`)
      .header('Authorization', `Bearer ${token}`)
    requirements.assertStatus(200)
    assert.equal(requirements.body().meta.total, 1)
    assert.deepEqual(requirements.body().data[0].skillTags, ['React'])

    const beforeCount = await ResourceAllocation.query()
      .where('task_id', taskId)
      .count('*', 'total')
    const matches = await client
      .get(`/api/v1/projects/${project.id}/resources/requirements/${requirementId}/matches`)
      .header('Authorization', `Bearer ${token}`)
    matches.assertStatus(200)
    const afterCount = await ResourceAllocation.query().where('task_id', taskId).count('*', 'total')
    assert.equal(matches.body().data.meta.writesApplied, false)
    assert.equal(matches.body().data.candidates[0].resourceId, resource.id)
    assert.equal(Number(beforeCount[0].$extras.total), Number(afterCount[0].$extras.total))

    const audit = await AuditLog.query()
      .where('organization_id', Number(org.id))
      .where('project_id', Number(project.id))
      .where('entity_type', 'task_resource_requirement')
      .firstOrFail()
    assert.equal((audit.metadata as Record<string, unknown>).event, 'RESOURCE_REQUIREMENT_CREATED')
  })

  test('allocation write returns warning summary without blocking overload', async ({
    client,
    assert,
  }) => {
    const { owner, project } = await setupProject()
    const token = await login(client, owner)
    const taskId = await createTask(Number(project.id))
    const resource = await createResource(Number(project.id))
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId,
      allocationType: 'assigned',
      allocationPercent: 75,
      startDate: DateTime.fromISO('2026-10-01'),
      endDate: DateTime.fromISO('2026-10-01'),
    })

    const response = await client
      .post(`/api/v1/projects/${project.id}/resources/${resource.id}/allocations`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId,
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-01',
      })

    response.assertStatus(201)
    assert.equal(response.body().data.allocationPercent, 50)
    assert.include(
      response.body().warningSummary.data.map((conflict: { type: string }) => conflict.type),
      'overload',
    )
  })

  test('planning endpoint rejects unbounded window', async ({ client }) => {
    const { owner, project } = await setupProject()
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/resources/planning`)
      .qs({ from: '2026-10-01' })
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(422)
  })

  test('availability exception API writes audit and rejects personal calendar fields', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupProject()
    const token = await login(client, owner)
    const resource = await createResource(Number(project.id))

    const createResponse = await client
      .post(`/api/v1/projects/${project.id}/resources/${resource.id}/availability-exceptions`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        startDate: '2026-10-02',
        endDate: '2026-10-02',
        capacityOverrideHours: 0,
        reason: '请假',
        status: 'confirmed',
      })
    createResponse.assertStatus(201)
    assert.equal(createResponse.body().data.reason, '请假')

    const listResponse = await client
      .get(`/api/v1/projects/${project.id}/resources/${resource.id}/availability-exceptions`)
      .header('Authorization', `Bearer ${token}`)
    listResponse.assertStatus(200)
    assert.equal(listResponse.body().meta.total, 1)

    const audit = await AuditLog.query()
      .where('organization_id', Number(org.id))
      .where('project_id', Number(project.id))
      .where('entity_type', 'resource_availability_exception')
      .firstOrFail()
    assert.equal(
      (audit.metadata as Record<string, unknown>).event,
      'RESOURCE_AVAILABILITY_EXCEPTION_CREATED',
    )

    const forbidden = await client
      .post(`/api/v1/projects/${project.id}/resources/${resource.id}/availability-exceptions`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        startDate: '2026-10-03',
        endDate: '2026-10-03',
        capacityOverrideHours: 0,
        reason: '外部日历字段不允许',
        externalCalendarUrl: 'https://calendar.example.test/feed',
      })
    forbidden.assertStatus(422)
  })

  test('linked resource user may self-update own availability exception', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupProject()
    const viewer = await createUser({ email: uniqueEmail('rm-v2-api-self') })
    await addOrgMember(org, viewer, 'member')
    const viewerRole = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: ProjectRoleName.READONLY_OBSERVER,
      permissions: [RESOURCE_VIEW],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: viewerRole.id,
      isActive: true,
    })
    const resource = await createResource(Number(project.id), { userId: Number(viewer.id) })
    const ownerToken = await login(client, owner)
    const created = await client
      .post(`/api/v1/projects/${project.id}/resources/${resource.id}/availability-exceptions`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({
        startDate: '2026-10-02',
        endDate: '2026-10-02',
        capacityOverrideHours: 0,
        reason: '请假',
      })
    created.assertStatus(201)

    const selfToken = await login(client, viewer)
    const updated = await client
      .patch(
        `/api/v1/projects/${project.id}/resources/${resource.id}/availability-exceptions/${created.body().data.id}`,
      )
      .header('Authorization', `Bearer ${selfToken}`)
      .json({ reason: '本人更新请假说明', status: 'confirmed' })
    updated.assertStatus(200)
    assert.equal(updated.body().data.reason, '本人更新请假说明')
  })

  test('resource suggestion preview is zero-write and apply requires explicit confirmation', async ({
    client,
    assert,
  }) => {
    const { owner, org, project } = await setupProject()
    const token = await login(client, owner)
    const taskId = await createTask(Number(project.id))
    const resource = await createResource(Number(project.id))
    const requirement = await client
      .post(`/api/v1/projects/${project.id}/resources/requirements`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId,
        role: 'frontend',
        skillTags: ['React'],
        allocationPercent: 60,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      })
    requirement.assertStatus(201)

    const preview = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        allocationCandidates: [
          { requirementId: requirement.body().data.id, resourceId: resource.id },
        ],
      })
    preview.assertStatus(200)
    assert.equal(preview.body().data.deterministicFacts.source, 'resource_planning_service')
    assert.equal(preview.body().data.deterministicFacts.writesApplied, false)
    assert.equal(preview.body().data.operations[0].type, 'create_resource_allocation')
    assert.equal(preview.body().data.evidence.kind, 'validation_feedback')

    const previewArtifact = await CompilerArtifact.query()
      .where('organization_id', Number(org.id))
      .where('artifactId', preview.body().data.evidence.artifactId)
      .firstOrFail()
    assert.equal(previewArtifact.payload.evidenceType, 'resource_suggestion')
    assert.equal(previewArtifact.payload.phase, 'preview')
    assert.equal(previewArtifact.payload.writesApplied, false)
    assert.notProperty(previewArtifact.payload, 'before')
    assert.notProperty(previewArtifact.payload, 'after')

    const afterPreview = await ResourceAllocation.query()
      .where('task_id', taskId)
      .count('*', 'total')
    assert.equal(Number(afterPreview[0].$extras.total), 0)

    const withoutConfirmation = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/apply`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        previewHash: preview.body().data.previewHash,
        operations: preview.body().data.operations,
      })
    withoutConfirmation.assertStatus(422)

    const apply = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/apply`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        confirm: true,
        previewHash: preview.body().data.previewHash,
        operations: preview.body().data.operations,
      })
    apply.assertStatus(200)
    assert.equal(apply.body().data.meta.writesApplied, true)
    assert.equal(apply.body().data.meta.evidence.kind, 'validation_feedback')

    const afterApply = await ResourceAllocation.query().where('task_id', taskId).count('*', 'total')
    assert.equal(Number(afterApply[0].$extras.total), 1)

    const audit = await AuditLog.query()
      .where('organization_id', Number(org.id))
      .where('project_id', Number(project.id))
      .where('entity_type', 'resource_suggestion')
      .firstOrFail()
    assert.equal((audit.metadata as Record<string, unknown>).event, 'RESOURCE_SUGGESTION_APPLIED')

    const applyArtifact = await CompilerArtifact.query()
      .where('organization_id', Number(org.id))
      .where('artifactId', apply.body().data.meta.evidence.artifactId)
      .firstOrFail()
    assert.equal(applyArtifact.payload.phase, 'apply')
    assert.equal(applyArtifact.payload.writesApplied, true)
    assert.equal(applyArtifact.payload.previewHash, preview.body().data.previewHash)
  })

  test('resource suggestion diff covers requirement create update and delete operations', async ({
    client,
    assert,
  }) => {
    const { owner, project } = await setupProject()
    const token = await login(client, owner)
    const taskId = await createTask(Number(project.id))
    const existing = await client
      .post(`/api/v1/projects/${project.id}/resources/requirements`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId,
        role: 'frontend',
        allocationPercent: 40,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      })
    existing.assertStatus(201)

    const preview = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        requirementOperations: [
          {
            type: 'create_requirement',
            input: {
              taskId,
              role: 'backend',
              skillTags: ['Node.js'],
              estimatedPersonDays: 2,
              startDate: '2026-10-01',
              endDate: '2026-10-03',
            },
          },
          {
            type: 'update_requirement',
            requirementId: existing.body().data.id,
            input: { allocationPercent: 80, priority: 'critical' },
          },
          { type: 'delete_requirement', requirementId: existing.body().data.id },
        ],
      })
    preview.assertStatus(200)
    assert.equal(preview.body().data.diff.creates, 1)
    assert.equal(preview.body().data.diff.updates, 1)
    assert.equal(preview.body().data.diff.deletes, 1)

    const apply = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/apply`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        confirm: true,
        previewHash: preview.body().data.previewHash,
        operations: preview.body().data.operations,
      })
    apply.assertStatus(200)

    const rows = await TaskResourceRequirement.query()
      .where('project_id', Number(project.id))
      .orderBy('id', 'asc')
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].role, 'backend')
    assert.equal(rows[0].sourceKind, 'rule_suggestion')
  })

  test('resource suggestions reject computed load fields and unsupported auto leveling', async ({
    client,
  }) => {
    const { owner, project } = await setupProject()
    const token = await login(client, owner)
    const taskId = await createTask(Number(project.id))

    const computed = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/preview`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        requirementOperations: [
          {
            type: 'create_requirement',
            input: {
              taskId,
              role: 'frontend',
              allocationPercent: 50,
              startDate: '2026-10-01',
              endDate: '2026-10-03',
              computedLoadPercent: 80,
            },
          },
        ],
      })
    computed.assertStatus(422)

    const leveling = await client
      .post(`/api/v1/projects/${project.id}/resources/suggestions/leveling`)
      .header('Authorization', `Bearer ${token}`)
      .json({})
    leveling.assertStatus(422)
  })

  test('readonly project member can read planning but cannot create requirements', async ({
    client,
  }) => {
    const { org, project } = await setupProject()
    const viewer = await createUser({ email: uniqueEmail('rm-v2-api-viewer') })
    await addOrgMember(org, viewer, 'member')
    const viewerRole = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: ProjectRoleName.READONLY_OBSERVER,
      permissions: [RESOURCE_VIEW],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: viewerRole.id,
      isActive: true,
    })
    await createResource(Number(project.id))
    const taskId = await createTask(Number(project.id))
    const token = await login(client, viewer)

    const planning = await client
      .get(`/api/v1/projects/${project.id}/resources/planning`)
      .qs({ from: '2026-10-01', to: '2026-10-03' })
      .header('Authorization', `Bearer ${token}`)
    planning.assertStatus(200)

    const write = await client
      .post(`/api/v1/projects/${project.id}/resources/requirements`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId,
        role: 'frontend',
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      })
    write.assertStatus(403)
  })

  test('other organization member cannot read project resource planning', async ({ client }) => {
    const { project } = await setupProject()
    const otherOwner = await createUser({ email: uniqueEmail('rm-v2-api-other') })
    await createOrganization(otherOwner)
    const token = await login(client, otherOwner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/resources/planning`)
      .qs({ from: '2026-10-01', to: '2026-10-03' })
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(403)
  })
})
