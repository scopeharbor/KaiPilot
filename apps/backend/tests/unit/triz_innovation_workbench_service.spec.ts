import InnovationWorkbenchService from '#services/triz_innovation/innovation_workbench_service'
import TrizInnovationPolicy from '#policies/triz_innovation_policy'
import TrizInnovationScheme from '#models/triz_innovation_scheme'
import Task from '#models/task'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import type { InnovationOption } from '@aiproj/types'

test.group('V3 InnovationWorkbenchService — persistence, isolation, idempotency', (group) => {
  useAuthDatabase(group)

  async function setup(seedSecondProject = true) {
    const owner = await createUser({ email: uniqueEmail('iw-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    let project2: { id: number } | null = null
    if (seedSecondProject) {
      const res = await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
      project2 = { id: Number(res.project.id) }
    }
    return { owner, org, project: { id: Number(project.id) }, project2 }
  }

  function sampleOption(over: Partial<InnovationOption> = {}): InnovationOption {
    return {
      optionId: 'opt-a',
      origin: 'triz_analysis_path',
      sourceRefs: [
        {
          sourceType: 'contradiction',
          ref: 'pc:1:d-demo',
          hash: 'tcd-demo',
          severity: 'high',
          stale: false,
          title: '工期与资源负载对立',
        },
      ],
      selectedPathId: 'path-A',
      principleIds: ['segmentation'],
      name: '分段交付',
      description: '将关键路径分段管理',
      applicability: ['关键路径密度高'],
      nonApplicability: ['范围已锁定'],
      hashes: {
        contradictionSignatures: ['tcd-demo'],
        analysisContentHashes: [],
        selectedPathId: 'path-A',
      },
      warnings: [],
      impact: {
        schedule: 'improves',
        resource_load: 'neutral',
        risk: 'improves',
        scope_flexibility: 'neutral',
        quality_maintainability: 'neutral',
        change_complexity: 'worsens',
      },
      reviewState: 'pending',
      createdBy: 1,
      ...over,
    }
  }

  test('createScheme 写入并可读回，payload 低敏字段齐全', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const svc = await app.container.make(InnovationWorkbenchService)
    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: '方案一',
      note: '初步对比',
    })
    assert.equal(rec.status, 'open')
    assert.equal(rec.reviewState, 'pending')
    const dto = svc.toDTO(rec)
    assert.equal(dto.name, '方案一')
    assert.equal(dto.options.length, 0)
    assert.isNotNull(dto.schemeHash)
    assert.equal(dto.handoff.status, 'none')

    const loaded = await svc.getBySchemeId(Number(org.id), project.id, rec.schemeId)
    assert.equal(svc.toDTO(loaded).name, '方案一')
  })

  test('项目隔离：project1 的方案在 project2 不可见', async ({ assert }) => {
    const { owner, org, project, project2 } = await setup()
    const svc = await app.container.make(InnovationWorkbenchService)
    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: 'p1 方案',
    })
    const { data } = await svc.list(Number(org.id), project2!.id, {})
    assert.equal(data.length, 0)
    const inOwn = await svc.list(Number(org.id), project.id, {})
    assert.equal(inOwn.data.length, 1)
    // 跨项目按 schemeId 取 → 抛 ResourceNotFound
    await assert.rejects(
      () => svc.getBySchemeId(Number(org.id), project2!.id, rec.schemeId),
      /不存在/,
    )
  })

  test('组织隔离：另一组织按同 schemeId 不可见', async ({ assert }) => {
    const { owner, org, project } = await setup(false)
    const svc = await app.container.make(InnovationWorkbenchService)
    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: 'org1 方案',
    })
    const otherOwner = await createUser({ email: uniqueEmail('iw-other') })
    const otherOrg = await createOrganization(otherOwner)
    await assert.rejects(
      () => svc.getBySchemeId(Number(otherOrg.id), project.id, rec.schemeId),
      /不存在/,
    )
  })

  test('addOption 受篮子上限 5 约束且去重', async ({ assert }) => {
    const { owner, org, project } = await setup(false)
    const svc = await app.container.make(InnovationWorkbenchService)
    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: '篮子测试',
    })
    for (let i = 0; i < 5; i++) {
      await svc.addOption(
        Number(org.id),
        project.id,
        rec.schemeId,
        Number(owner.id),
        sampleOption({ optionId: `opt-${i}` }),
      )
    }
    const after = await svc.getBySchemeId(Number(org.id), project.id, rec.schemeId)
    assert.equal(after.payload.options.length, 5)
    // 第 6 个应被拒绝
    await assert.rejects(
      () =>
        svc.addOption(
          Number(org.id),
          project.id,
          rec.schemeId,
          Number(owner.id),
          sampleOption({ optionId: 'opt-5' }),
        ),
      /上限/,
    )
    // 重复 optionId 被拒绝
    await assert.rejects(
      () =>
        svc.addOption(
          Number(org.id),
          project.id,
          rec.schemeId,
          Number(owner.id),
          sampleOption({ optionId: 'opt-0' }),
        ),
      /已在方案中/,
    )
  })

  test('removeOption 减少候选并重算 schemeHash；abandon 置废弃态', async ({ assert }) => {
    const { owner, org, project } = await setup(false)
    const svc = await app.container.make(InnovationWorkbenchService)
    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: '移除/废弃',
    })
    await svc.addOption(
      Number(org.id),
      project.id,
      rec.schemeId,
      Number(owner.id),
      sampleOption({ optionId: 'opt-a' }),
    )
    await svc.addOption(
      Number(org.id),
      project.id,
      rec.schemeId,
      Number(owner.id),
      sampleOption({ optionId: 'opt-b' }),
    )
    const before = await svc.getBySchemeId(Number(org.id), project.id, rec.schemeId)
    const beforeHash = before.schemeHash
    await svc.removeOption(Number(org.id), project.id, rec.schemeId, Number(owner.id), 'opt-a')
    const after = await svc.getBySchemeId(Number(org.id), project.id, rec.schemeId)
    assert.equal(after.payload.options.length, 1)
    assert.notEqual(after.schemeHash, beforeHash)

    const abandoned = await svc.abandonScheme(
      Number(org.id),
      project.id,
      rec.schemeId,
      Number(owner.id),
    )
    assert.equal(abandoned.status, 'abandoned')
    // 废弃后不可再加 option
    await assert.rejects(
      () =>
        svc.addOption(
          Number(org.id),
          project.id,
          rec.schemeId,
          Number(owner.id),
          sampleOption({ optionId: 'opt-c' }),
        ),
      /open/,
    )
  })

  test('handoff 幂等键查重：重复创建可被识别', async ({ assert }) => {
    const { owner, org, project } = await setup(false)
    const svc = await app.container.make(InnovationWorkbenchService)
    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: '幂等测试',
    })
    await svc.saveHandoff(
      Number(org.id),
      project.id,
      rec.schemeId,
      {
        status: 'candidate_created',
        draftSessionRef: 'draft_triz_xxx',
        handedOffAt: null,
        blockedReason: null,
      },
      'iw-hof-key1',
    )
    const found = await svc.findByHandoffIdempotencyKey(Number(org.id), project.id, 'iw-hof-key1')
    assert.isNotNull(found)
    const miss = await svc.findByHandoffIdempotencyKey(Number(org.id), project.id, 'iw-hof-other')
    assert.isNull(miss)
  })

  test('方案操作不写正式业务表（tasks 不增）', async ({ assert }) => {
    const { owner, org, project } = await setup(false)
    const svc = await app.container.make(InnovationWorkbenchService)
    const tasksBefore = await Task.query().where('project_id', project.id).count('* as c')
    const before = (tasksBefore[0].$extras?.c ?? 0) as number

    const rec = await svc.createScheme({
      organizationId: Number(org.id),
      projectId: project.id,
      userId: Number(owner.id),
      name: 'no-formal-write',
    })
    await svc.addOption(Number(org.id), project.id, rec.schemeId, Number(owner.id), sampleOption())
    await svc.updateScheme(Number(org.id), project.id, rec.schemeId, Number(owner.id), {
      reviewState: 'reviewed',
    })
    await svc.abandonScheme(Number(org.id), project.id, rec.schemeId, Number(owner.id))

    const tasksAfter = await Task.query().where('project_id', project.id).count('* as c')
    const after = (tasksAfter[0].$extras?.c ?? 0) as number
    assert.equal(after, before)
    // 仅在工作台表有记录
    const schemes = await TrizInnovationScheme.query().where('project_id', project.id)
    assert.isAtLeast(schemes.length, 1)
  })

  test('RBAC 拒绝：非项目成员无法 view', async ({ assert }) => {
    const { org, project } = await setup(false)
    const policy = await app.container.make(TrizInnovationPolicy)
    const stranger = await createUser({ email: uniqueEmail('iw-stranger') })
    // stranger 不属于该组织/项目
    const allowed = await policy.view(stranger, Number(org.id), project.id)
    assert.isFalse(allowed)
  })
})
