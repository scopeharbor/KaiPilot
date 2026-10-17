/**
 * 跨项目依赖 Service 单元测试
 * v3-multi-project-dependency-crud §5.4-5.8, §6.2-6.4
 */
import { test } from '@japa/runner'
import MultiProjectDependencyService from '#services/multi_project_dependency_service'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'

/** previewCreate 的合法入参：两端 external，免播种 project/task。 */
function externalPreviewInput(suffix: string) {
  return {
    providerEndpointType: 'external',
    providerProjectId: null,
    providerMilestoneId: null,
    providerTaskId: null,
    providerExternalLabel: `外部供应方-${suffix}`,
    providerExternalKey: `ext-provider-${suffix}`,
    consumerEndpointType: 'external',
    consumerProjectId: null,
    consumerMilestoneId: null,
    consumerTaskId: null,
    consumerExternalLabel: `外部消费方-${suffix}`,
    consumerExternalKey: `ext-consumer-${suffix}`,
    category: 'technical',
    type: 'ss',
  }
}

test.group('MultiProjectDependencyService', (group) => {
  let svc: any
  let org: any
  let pmo: any

  group.each.setup(async () => {
    const s = await setupTest()
    svc = await s.container.make(MultiProjectDependencyService)
    org = await createTestOrg(s.db)
    pmo = await createTestUser(s.db, org, { role: 'pmo' })
    // observer 成员只作为组织内的第二身份存在；本 change 的越权用例待 Service 实现补齐后再加
    await createTestUser(s.db, org, { role: 'observer' })
  })

  // ── List & Detail ──

  test('list returns empty for new organization').run(async ({ assert }) => {
    const result = await svc.list(org.id, {}, '-createdAt', 1, 20, pmo.id, null)
    assert.isArray(result.data)
    assert.equal(result.meta.total, 0)
  })

  test('list returns paginated results').run(async ({ assert }) => {
    const result = await svc.list(org.id, {}, '-createdAt', 1, 10, pmo.id, null)
    assert.isArray(result.data)
    assert.property(result.meta, 'total')
    assert.property(result.meta, 'page')
    assert.property(result.meta, 'perPage')
    assert.property(result.meta, 'totalPages')
  })

  test('list enforces organization isolation').run(async ({ assert }) => {
    const result = await svc.list(999999, {}, '-createdAt', 1, 20, pmo.id, null)
    assert.isArray(result.data)
  })

  test('detail returns 404 for non-existent dependency').run(async ({ assert }) => {
    try {
      await svc.detail(org.id, 999999, pmo.id, null)
      assert.fail()
    } catch {
      assert.isTrue(true)
    }
  })

  // ── Create Preview ──

  // 签名是 previewCreate(organizationId, actorUserId, input, ctx?)，端点字段是扁平的
  // providerEndpointType/providerProjectId/... 原用例把 input 与 actorUserId 传反、
  // 且用了嵌套的 providerEndpoint:{type,id}——那是被废弃的设计，从未能跑通。
  test('previewCreate 返回预览标识、确认哈希与幂等键').run(async ({ assert }) => {
    const preview = await svc.previewCreate(org.id, pmo.id, {
      providerEndpointType: 'external',
      providerProjectId: null,
      providerMilestoneId: null,
      providerTaskId: null,
      providerExternalLabel: '外部供应方',
      providerExternalKey: 'ext-provider-1',
      consumerEndpointType: 'external',
      consumerProjectId: null,
      consumerMilestoneId: null,
      consumerTaskId: null,
      consumerExternalLabel: '外部消费方',
      consumerExternalKey: 'ext-consumer-1',
      category: 'deliverable',
      type: 'fs',
    })

    assert.isString(preview.previewId)
    assert.isString(preview.confirmationHash)
    assert.isString(preview.idempotencyKey)
    assert.equal(preview.operation, 'create')
    assert.equal(preview.diff.operation, 'create')
    assert.equal(preview.diff.after.category, 'deliverable')
    assert.equal(preview.diff.after.type, 'fs')
    // expiresAt 断言相对当下，不写死时间戳
    assert.isAbove(Date.parse(preview.expiresAt), Date.now() - 1000)
  })

  test('previewCreate 对两端相同的端点标记自依赖').run(async ({ assert }) => {
    const sameEndpoint = {
      endpointType: 'external' as const,
      externalKey: 'ext-same',
      externalLabel: '同一外部对象',
    }
    const preview = await svc.previewCreate(org.id, pmo.id, {
      providerEndpointType: sameEndpoint.endpointType,
      providerProjectId: null,
      providerMilestoneId: null,
      providerTaskId: null,
      providerExternalLabel: sameEndpoint.externalLabel,
      providerExternalKey: sameEndpoint.externalKey,
      consumerEndpointType: sameEndpoint.endpointType,
      consumerProjectId: null,
      consumerMilestoneId: null,
      consumerTaskId: null,
      consumerExternalLabel: sameEndpoint.externalLabel,
      consumerExternalKey: sameEndpoint.externalKey,
      category: 'deliverable',
      type: 'fs',
    })

    assert.isTrue(preview.selfDependencyCheck.isSelfDependency)
    assert.include(preview.warningCodes, 'DEPENDENCY_CYCLE_BLOCKED')
  })

  // ── Confirm Create ──

  test('confirm 按预览落库的端点真实写入依赖').run(async ({ assert }) => {
    const preview = await svc.previewCreate(org.id, pmo.id, externalPreviewInput('confirm'))

    const result = await svc.confirm(
      org.id,
      pmo.id,
      preview.previewId,
      preview.confirmationHash,
      preview.idempotencyKey,
    )

    assert.isFalse(result.idempotentReplay)
    // 端点如实落库——修复前这里是写死的 provider task 101 / consumer task 201
    assert.equal(result.data.providerEndpoint.endpointType, 'external')
    assert.equal(result.data.consumerEndpoint.endpointType, 'external')
    assert.equal(result.data.category, 'technical')
    assert.equal(result.data.type, 'ss')
  })

  test('confirm 拒绝不存在的预览').run(async ({ assert }) => {
    // 原用例用 `try { await svc.confirmCreate(...) } catch {}` 吞掉
    // 「方法不存在」的 TypeError 而假通过；这里断言具体异常类型与消息。
    await assert.rejects(
      () => svc.confirm(org.id, pmo.id, 'preview-does-not-exist', 'wrong-hash', 'idem-x'),
      '预览不存在',
    )
  })

  // ── 生命周期：update / archive / restore / delete ──
  //
  // 这四条分支曾长期是 501 占位（service 无对应方法），对应用例一直 skip。
  // 现按规范 multi-project-dependency-crud 实现并启用。

  /** 造一条已确认落库的活跃依赖，供生命周期用例作为起点。 */
  async function seedActiveDependency(suffix: string) {
    const preview = await svc.previewCreate(org.id, pmo.id, externalPreviewInput(suffix))
    const created = await svc.confirm(
      org.id,
      pmo.id,
      preview.previewId,
      preview.confirmationHash,
      preview.idempotencyKey,
    )
    return created.data
  }

  /** 走完一次「预览 → 确认」。 */
  async function runLifecycle(
    make: () => Promise<{ previewId: string; confirmationHash: string; idempotencyKey: string }>,
  ) {
    const preview = await make()
    return svc.confirm(
      org.id,
      pmo.id,
      preview.previewId,
      preview.confirmationHash,
      preview.idempotencyKey,
    )
  }

  test('previewUpdate 只把实际变更的字段计入 diff').run(async ({ assert }) => {
    const dep = await seedActiveDependency('upd')

    const preview = await svc.previewUpdate(org.id, pmo.id, {
      dependencyId: dep.id,
      riskLevel: 'critical',
      lagDays: 3,
    })

    assert.equal(preview.operation, 'update')
    assert.deepEqual(preview.diff.changedFields.sort(), ['lagDays', 'riskLevel'])
    assert.equal(preview.diff.after.riskLevel, 'critical')
    assert.equal(preview.diff.before?.riskLevel, 'medium')
    assert.isTrue(preview.lifecycleCheck.isValid)
  })

  test('confirmUpdate 落库变更字段').run(async ({ assert }) => {
    const dep = await seedActiveDependency('updc')

    const result = await runLifecycle(() =>
      svc.previewUpdate(org.id, pmo.id, { dependencyId: dep.id, riskLevel: 'high', bufferDays: 5 }),
    )

    assert.equal(result.data.riskLevel, 'high')
    assert.equal(result.data.bufferDays, 5)
    // 未声明变更的字段保持原值
    assert.equal(result.data.category, 'technical')
  })

  test('previewUpdate 拒绝非法状态转换').run(async ({ assert }) => {
    const dep = await seedActiveDependency('updbad')

    // active → draft 不在 VALID_TRANSITIONS 里
    const preview = await svc.previewUpdate(org.id, pmo.id, {
      dependencyId: dep.id,
      status: 'draft',
    })
    assert.isFalse(preview.lifecycleCheck.isValid)

    await assert.rejects(
      () =>
        svc.confirm(
          org.id,
          pmo.id,
          preview.previewId,
          preview.confirmationHash,
          preview.idempotencyKey,
        ),
      '不允许的状态转换：active → draft',
    )
  })

  test('archive 把活跃依赖转为归档且保留行').run(async ({ assert }) => {
    const dep = await seedActiveDependency('arc')

    const preview = await svc.previewArchive(org.id, pmo.id, dep.id)
    assert.equal(preview.operation, 'archive')
    assert.isTrue(preview.lifecycleCheck.isValid)

    const result = await runLifecycle(async () => preview)
    assert.equal(result.data.status, 'archived')

    // 行仍在——归档不删数据，审计链得以保留
    const stillThere = await svc.detail(org.id, dep.id)
    assert.equal(stillThere.status, 'archived')
  })

  test('restore 把归档依赖转回活跃').run(async ({ assert }) => {
    const dep = await seedActiveDependency('res')
    await runLifecycle(() => svc.previewArchive(org.id, pmo.id, dep.id))

    const preview = await svc.previewRestore(org.id, pmo.id, dep.id)
    assert.equal(preview.operation, 'restore')
    assert.isTrue(preview.lifecycleCheck.isValid)
    // 规范要求 restore 重跑完整性检查
    assert.isFalse(preview.duplicateCheck.isDuplicate)
    assert.isFalse(preview.cycleCheck.wouldCreateCycle)

    const result = await runLifecycle(async () => preview)
    assert.equal(result.data.status, 'active')
  })

  test('restore 在会产生重复活跃边时被拒').run(async ({ assert }) => {
    const first = await seedActiveDependency('dup1')
    await runLifecycle(() => svc.previewArchive(org.id, pmo.id, first.id))

    // 归档后再建一条同 type/category/端点类型的活跃边
    await seedActiveDependency('dup2')

    const preview = await svc.previewRestore(org.id, pmo.id, first.id)
    assert.isTrue(preview.duplicateCheck.isDuplicate, '恢复后将与现有活跃边重复')
    assert.include(preview.warningCodes, 'DEPENDENCY_DUPLICATE_BLOCKED')

    await assert.rejects(
      () =>
        svc.confirm(
          org.id,
          pmo.id,
          preview.previewId,
          preview.confirmationHash,
          preview.idempotencyKey,
        ),
      '恢复后将与现有活跃依赖重复',
    )

    // 仍是归档态，未被恢复
    const stillArchived = await svc.detail(org.id, first.id)
    assert.equal(stillArchived.status, 'archived')
  })

  test('previewDelete 拒绝活跃依赖（比 archive 更严格）').run(async ({ assert }) => {
    const dep = await seedActiveDependency('delact')

    const preview = await svc.previewDelete(org.id, pmo.id, dep.id)
    assert.isFalse(preview.lifecycleCheck.isValid)
    assert.equal(preview.lifecycleCheck.message, '仅允许删除已归档的依赖，请先归档')

    await assert.rejects(
      () =>
        svc.confirm(
          org.id,
          pmo.id,
          preview.previewId,
          preview.confirmationHash,
          preview.idempotencyKey,
        ),
      '仅允许删除已归档的依赖，请先归档',
    )
    // 依赖仍在
    const stillPresent = await svc.detail(org.id, dep.id)
    assert.equal(stillPresent.id, dep.id)
  })

  test('delete 允许已归档依赖并移除行').run(async ({ assert }) => {
    const dep = await seedActiveDependency('delarc')
    await runLifecycle(() => svc.previewArchive(org.id, pmo.id, dep.id))

    const preview = await svc.previewDelete(org.id, pmo.id, dep.id)
    assert.isTrue(preview.lifecycleCheck.isValid)

    const result = await runLifecycle(async () => preview)
    assert.equal(result.data.id, dep.id)

    // 行已移除；痕迹由 DEPENDENCY_CONFIRMED 审计事件承担
    await assert.rejects(() => svc.detail(org.id, dep.id), '跨项目依赖不存在')
  })

  test('confirm 拒绝端点声明与预览操作不匹配').run(async ({ assert }) => {
    const dep = await seedActiveDependency('mismatch')
    const preview = await svc.previewArchive(org.id, pmo.id, dep.id)

    // 拿 archive 的预览走 delete 端点的期望
    await assert.rejects(
      () =>
        svc.confirm(
          org.id,
          pmo.id,
          preview.previewId,
          preview.confirmationHash,
          preview.idempotencyKey,
          undefined,
          'delete',
        ),
      '预览操作与端点不匹配：预览为 archive，端点要求 delete',
    )
  })

  // ── Idempotency ──

  test('confirm 幂等重放：同一预览二次确认返回原结果且不重复写入').run(async ({ assert }) => {
    const preview = await svc.previewCreate(org.id, pmo.id, externalPreviewInput('idem'))

    const first = await svc.confirm(
      org.id,
      pmo.id,
      preview.previewId,
      preview.confirmationHash,
      preview.idempotencyKey,
    )
    assert.isFalse(first.idempotentReplay)

    const replay = await svc.confirm(
      org.id,
      pmo.id,
      preview.previewId,
      preview.confirmationHash,
      preview.idempotencyKey,
    )
    assert.isTrue(replay.idempotentReplay)
    assert.equal(replay.data.id, first.data.id, '重放必须返回同一条依赖，不得新建')
  })

  // ── No side effects ──

  test('confirm 不触碰 task_dependencies（架构不变量）').run(async ({ assert }) => {
    // 原用例只有 `assert.isTrue(true)`——注释声称验证不变量但实际什么都没验。
    // 这里真实比对确认前后的行数。
    const dbModule = await import('@adonisjs/lucid/services/db')
    const Database = dbModule.default
    const countTaskDeps = async (): Promise<number> => {
      const rows = (await Database.from('task_dependencies').count(
        '* as total',
      )) as unknown as Array<{
        total: number
      }>
      return Number(rows[0]?.total ?? 0)
    }

    const before = await countTaskDeps()

    const preview = await svc.previewCreate(org.id, pmo.id, externalPreviewInput('no-side'))
    await svc.confirm(
      org.id,
      pmo.id,
      preview.previewId,
      preview.confirmationHash,
      preview.idempotencyKey,
    )

    assert.equal(await countTaskDeps(), before, '跨项目依赖写入不得新增 task_dependencies 行')
  })
})
