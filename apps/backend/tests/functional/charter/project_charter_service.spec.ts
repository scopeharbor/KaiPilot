// v3-chart-gallery-data-foundation W2.2 —— ProjectCharterService 功能测试
//
// 覆盖（tasks.md 2.1/2.2）：
// - 章程创建（版本 1 / draft）、草案编辑、提交审批（pending_approval）、
//   审批决议（approved 固化审批人与时间 / rejected 驳回可升版重提）；
// - 非法状态流转与已批准/审批中禁改守卫（ValidationException 422）；
// - 跨组织访问一律 404（RL-05），未创建章程 get 返回 null。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { ProjectRoleName } from '#rbac'
import ProjectCharterService from '#services/project_charter_service'
import type { CreateCharterInput } from '#services/project_charter_service'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/** 装配组织 + 项目（owner 为项目经理）。 */
async function setup() {
  const owner = await createUser({ email: uniqueEmail('charter-owner') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

function draftPayload(overrides: Partial<CreateCharterInput> = {}): CreateCharterInput {
  return {
    title: '智能客服系统升级项目章程',
    vision: '成为行业领先的智能服务体验平台',
    scope: '本期建设范围：智能问答引擎升级与多渠道接入',
    objectives: ['目标一：意图识别准确率 ≥ 95%', '目标二：首响时长 ≤ 3 秒'],
    successCriteria: ['上线后系统可用性 ≥ 99.9%', '验收时缺陷 P0/P1 清零'],
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    businessCase: null,
    ...overrides,
  }
}

test.group('ProjectCharterService', (group) => {
  useAuthDatabase(group)

  test('创建章程草案：版本 1、draft、JSON 数组往返与日期持久化', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(ProjectCharterService)

    const charter = await service.create(org.id, project.id, draftPayload(), owner.id)

    assert.equal(charter.approvalStatus, 'draft')
    assert.equal(charter.version, 1)
    assert.equal(charter.title, '智能客服系统升级项目章程')
    assert.deepEqual(charter.objectives, [
      '目标一：意图识别准确率 ≥ 95%',
      '目标二：首响时长 ≤ 3 秒',
    ])
    assert.deepEqual(charter.successCriteria, ['上线后系统可用性 ≥ 99.9%', '验收时缺陷 P0/P1 清零'])
    assert.equal(charter.startDate.toISODate(), '2026-01-01')
    assert.equal(charter.endDate.toISODate(), '2026-06-30')
    assert.equal(charter.createdBy, owner.id)

    const fetched = await service.get(org.id, project.id)
    assert.isNotNull(fetched)
    assert.equal(fetched!.id, charter.id)
  })

  test('项目已存在章程时重复创建被拒绝（422）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(ProjectCharterService)
    await service.create(org.id, project.id, draftPayload(), owner.id)

    await assert.rejects(
      () => service.create(org.id, project.id, draftPayload({ title: '第二份' }), owner.id),
      ValidationException,
    )
  })

  test('非法日期与结束早于开始被拒绝（422）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(ProjectCharterService)

    await assert.rejects(
      () => service.create(org.id, project.id, draftPayload({ startDate: '2026-13-01' }), owner.id),
      ValidationException,
    )
    await assert.rejects(
      () =>
        service.create(
          org.id,
          project.id,
          draftPayload({ startDate: '2026-06-30', endDate: '2026-01-01' }),
          owner.id,
        ),
      ValidationException,
    )
  })

  test('编辑草稿内容：版本保持 1、JSON 数组可更新', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(ProjectCharterService)
    await service.create(org.id, project.id, draftPayload(), owner.id)

    const updated = await service.update(
      org.id,
      project.id,
      {
        title: '修订后的章程标题',
        scope: '扩大至移动端接入',
        businessCase: '管理层立项评审通过',
      },
      owner.id,
    )

    assert.equal(updated.approvalStatus, 'draft')
    assert.equal(updated.version, 1)
    assert.equal(updated.title, '修订后的章程标题')
    assert.equal(updated.scope, '扩大至移动端接入')
    assert.equal(updated.businessCase, '管理层立项评审通过')
    assert.equal(updated.updatedBy, owner.id)
  })

  test('提交审批 → 审批中禁改禁重复提交 → 通过后固化审批人与时间且禁改', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const approver = await createUser({ email: uniqueEmail('charter-approver') })
    const service = await app.container.make(ProjectCharterService)
    await service.create(org.id, project.id, draftPayload(), owner.id)

    const submitted = await service.submit(org.id, project.id, owner.id)
    assert.equal(submitted.approvalStatus, 'pending_approval')

    // 审批中禁止直接修改 / 重复提交
    await assert.rejects(
      () => service.update(org.id, project.id, { title: '偷偷改' }, owner.id),
      ValidationException,
    )
    await assert.rejects(() => service.submit(org.id, project.id, owner.id), ValidationException)

    const approved = await service.approve(org.id, project.id, 'approve', approver.id)
    assert.equal(approved.approvalStatus, 'approved')
    assert.equal(approved.approvedBy, approver.id)
    assert.isNotNull(approved.approvedAt)
    assert.equal(approved.version, 1)

    // 已批准章程禁止直接修改
    await assert.rejects(
      () => service.update(org.id, project.id, { title: '终态修改' }, owner.id),
      ValidationException,
    )
    // 已批准后不可再提交/审批
    await assert.rejects(() => service.submit(org.id, project.id, owner.id), ValidationException)
    await assert.rejects(
      () => service.approve(org.id, project.id, 'reject', approver.id),
      ValidationException,
    )
  })

  test('驳回后可编辑升版并重新提交审批，重批固化新版审批人', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const approver = await createUser({ email: uniqueEmail('charter-approver2') })
    const service = await app.container.make(ProjectCharterService)
    await service.create(org.id, project.id, draftPayload(), owner.id)
    await service.submit(org.id, project.id, owner.id)

    const rejected = await service.approve(org.id, project.id, 'reject', approver.id)
    assert.equal(rejected.approvalStatus, 'rejected')
    assert.isNull(rejected.approvedBy)
    assert.isNull(rejected.approvedAt)

    // 驳回后编辑 = 升版（version 2），状态仍为 rejected
    const revised = await service.update(
      org.id,
      project.id,
      { title: '驳回修订版', vision: '修订后的愿景' },
      owner.id,
    )
    assert.equal(revised.version, 2)
    assert.equal(revised.approvalStatus, 'rejected')
    assert.equal(revised.title, '驳回修订版')

    // 重新提交并批准
    const resubmitted = await service.submit(org.id, project.id, owner.id)
    assert.equal(resubmitted.approvalStatus, 'pending_approval')
    const finalApproved = await service.approve(org.id, project.id, 'approve', approver.id)
    assert.equal(finalApproved.approvalStatus, 'approved')
    assert.equal(finalApproved.approvedBy, approver.id)
    assert.equal(finalApproved.version, 2)
  })

  test('未创建章程时 get 返回 null；草稿直接审批被拒绝（422）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const approver = await createUser({ email: uniqueEmail('charter-approver3') })
    const service = await app.container.make(ProjectCharterService)

    assert.isNull(await service.get(org.id, project.id))

    await service.create(org.id, project.id, draftPayload(), owner.id)
    await assert.rejects(
      () => service.approve(org.id, project.id, 'approve', approver.id),
      ValidationException,
    )
  })

  test('跨组织访问一律 404（RL-05，防探测）', async ({ assert }) => {
    const { owner, org, project } = await setup()
    const service = await app.container.make(ProjectCharterService)
    const charter = await service.create(org.id, project.id, draftPayload(), owner.id)
    assert.isNotNull(charter)

    const outsider = await createUser({ email: uniqueEmail('charter-outsider') })
    const otherOrg = await createOrganization(outsider)

    await assert.rejects(() => service.get(otherOrg.id, project.id), ResourceNotFoundException)
    await assert.rejects(
      () => service.create(otherOrg.id, project.id, draftPayload(), outsider.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.update(otherOrg.id, project.id, { title: '跨组织修改' }, outsider.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.submit(otherOrg.id, project.id, outsider.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => service.approve(otherOrg.id, project.id, 'approve', outsider.id),
      ResourceNotFoundException,
    )
  })
})
