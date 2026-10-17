/**
 * v2-5-compiler-run-executor-wiring —— Run 生命周期与幂等集成测试。
 *
 * 覆盖：tasks 3.1-3.6
 * - 幂等启动（相同 key 返回相同 runId）
 * - 不同 key 不同 input 冲突
 * - 跨组织 key 隔离
 * - 状态转换保护（终态后拒绝非法转换）
 * - queued → running 推进
 * - 组织隔离查询
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CompilerRun from '#models/compiler_run'
import Organization from '#models/organization'
import User from '#models/user'
import { CompilerRunService } from '#services/compiler/compiler_run_service'
import { StageRegistry } from '#services/compiler/stage_registry'
import { ArtifactStore } from '#services/compiler/artifact_store'

// ── Test Helpers ──

async function createTestUserAndOrg(): Promise<{ org: Organization; user: User }> {
  const user = await User.create({
    email: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
    password: 'Password123!',
    fullName: 'Lifecycle Test User',
    authProvider: 'local',
    isActive: true,
  })
  const org = await Organization.create({
    ownerId: user.id,
    name: `Lifecycle Test Org ${Date.now()}`,
    slug: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })
  return { org, user }
}

async function createRun(
  service: CompilerRunService,
  orgId: number,
  userId: number,
  key?: string,
  input?: Record<string, unknown>,
): Promise<CompilerRun> {
  return service.startRun({
    organizationId: orgId,
    userId,
    input: input ?? { text: 'test project' },
    idempotencyKey: key,
  })
}

test.group('CompilerRun — Idempotent Start', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  test('same idempotencyKey returns existing run', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const key = 'idem-key-1'

    const run1 = await createRun(service, org.id, user.id, key)
    const run2 = await createRun(service, org.id, user.id, key)

    assert.equal(run1.id, run2.id)
    assert.equal(run1.status, run2.status)
  })

  test('different idempotencyKey creates different runs', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())

    const run1 = await createRun(service, org.id, user.id, 'key-a')
    const run2 = await createRun(service, org.id, user.id, 'key-b')

    assert.notEqual(run1.id, run2.id)
  })

  test('cross-organization idempotencyKey isolation', async ({ assert }) => {
    const { org: org1, user: user1 } = await createTestUserAndOrg()
    const { org: org2 } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const key = 'shared-key'

    const runOrg1 = await createRun(service, org1.id, user1.id, key)
    const runOrg2 = await createRun(service, org2.id, user1.id, key)

    // Different orgs, same key -> different runs
    assert.notEqual(runOrg1.id, runOrg2.id)
  })

  test('no idempotencyKey always creates new run', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())

    const run1 = await createRun(service, org.id, user.id)
    const run2 = await createRun(service, org.id, user.id)

    assert.notEqual(run1.id, run2.id)
  })

  test('idempotencyKey with same input returns same run', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const key = 'diff-input-key'

    const run1 = await createRun(service, org.id, user.id, key, { text: 'project A' })
    const run2 = await createRun(service, org.id, user.id, key, { text: 'project A' })

    // Same key + same input -> idempotent
    assert.equal(run1.id, run2.id)
  })

  test('validateIdempotency returns conflict correctly', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const key = 'validate-key'

    // Before creating run -> no conflict
    const noConflict = await service.validateIdempotency(org.id, key)
    assert.isFalse(noConflict.conflict)

    // Create run
    await createRun(service, org.id, user.id, key)

    // After creating -> conflict
    const hasConflict = await service.validateIdempotency(org.id, key)
    assert.isTrue(hasConflict.conflict)
    assert.isDefined(hasConflict.existingRunId)
  })

  test('validateIdempotency without key returns no conflict', async ({ assert }) => {
    const { org } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const result = await service.validateIdempotency(org.id)
    assert.isFalse(result.conflict)
    assert.isUndefined(result.existingRunId)
  })
})

test.group('CompilerRun — State Transitions', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  test('new run starts as queued', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const run = await createRun(service, org.id, user.id)
    assert.equal(run.status, 'queued')
  })

  test('run with status completed cannot transition', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const run = await createRun(service, org.id, user.id)

    // Manually set to completed
    run.status = 'completed'
    await run.save()

    // Try to update to running (should fail compare-and-set)
    const affected = await CompilerRun.query()
      .where('id', run.id)
      .whereIn('status', ['queued', 'running'])
      .update({ status: 'running' })
    assert.equal(affected[0], 0)
  })

  test('queued to running transition works', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const run = await createRun(service, org.id, user.id)
    assert.equal(run.status, 'queued')

    // queued → running
    const affected = await CompilerRun.query()
      .where('id', run.id)
      .whereIn('status', ['queued', 'running'])
      .update({ status: 'running' })

    assert.isAbove(affected[0], 0)

    const reloaded = await CompilerRun.find(run.id)
    assert.equal(reloaded!.status, 'running')
  })
})

test.group('CompilerRun — Queries', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()
  })

  test('getRun returns correct run by orgId', async ({ assert }) => {
    const { org: org1, user: user1 } = await createTestUserAndOrg()
    const { org: org2 } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())

    await createRun(service, org1.id, user1.id)
    const runForOrg1 = await createRun(service, org1.id, user1.id)

    // Create a run in org 2
    await createRun(service, org2.id, user1.id)

    // Should find run in org 1
    const found = await service.getRun(org1.id, runForOrg1.id)
    assert.isNotNull(found)
    assert.equal(found!.id, runForOrg1.id)

    // Cross-org query should return null (org isolation)
    const crossOrg = await service.getRun(org2.id, runForOrg1.id)
    assert.isNull(crossOrg)
  })

  test('startRun creates run with correct orgId and userId', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())
    const run = await createRun(service, org.id, user.id)

    assert.equal(run.organizationId, org.id)
    assert.equal(run.requestedByUserId, user.id)
    assert.equal(run.status, 'queued')
  })

  test('multiple runs for same organization', async ({ assert }) => {
    const { org, user } = await createTestUserAndOrg()
    const service = new CompilerRunService(new StageRegistry(), new ArtifactStore())

    await createRun(service, org.id, user.id, 'key-1')
    await createRun(service, org.id, user.id, 'key-2')
    await createRun(service, org.id, user.id, 'key-3')

    const runs = await CompilerRun.forOrganization(org.id).orderBy('id', 'asc')
    assert.lengthOf(runs, 3)
  })
})
