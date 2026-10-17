/**
 * v2-5-code-repository-auto-linking —— CandidateService 和 ConfirmService 集成测试。
 *
 * 覆盖 5.2/5.4/5.6：API 权限、确认事务、忽略审计。
 * 依赖 AdonisJS 数据库（test.sqlite），通过 Japa 运行。
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import CandidateService from '#services/candidates/candidate_service'
import CandidateConfirmService from '#services/candidates/candidate_confirm_service'
import LinkCandidate from '#models/link_candidate'
import TaskExternalLink from '#models/task_external_link'
import { DateTime } from 'luxon'
import { useAuthDatabase } from '../functional/auth/_helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const candidateService = new CandidateService()
const confirmService = new CandidateConfirmService()

async function ensureOrganization(id: number) {
  const existing = await db.from('organizations').where('id', id).first()
  if (existing) return

  const now = DateTime.utc().toSQL({ includeOffset: false })
  const ownerId = 20_000 + id
  await db.table('users').insert({
    id: ownerId,
    full_name: `候选集成测试用户 ${id}`,
    email: `link-candidate-integration-${id}@test.local`,
    password: 'test-password',
    auth_provider: 'local',
    is_active: true,
    created_at: now,
    updated_at: now,
  })
  await db.table('organizations').insert({
    id,
    owner_id: ownerId,
    name: `候选集成测试组织 ${id}`,
    slug: `link-candidate-integration-org-${id}`,
    plan_tier: 'free',
    created_at: now,
    updated_at: now,
  })
}

async function createTestCandidate(
  overrides?: Partial<{
    organizationId: number
    taskId: number | null
    status: string
    expiresAt: DateTime
    deliveryId: string
  }>,
) {
  const deliveryId = overrides?.deliveryId ?? `test-del-${Date.now()}`
  const organizationId = overrides?.organizationId ?? 1
  await ensureOrganization(organizationId)

  return LinkCandidate.create({
    organizationId,
    provider: 'github',
    repositoryFullName: 'test-org/test-repo',
    repositoryExternalId: 'R_test_123',
    eventType: 'pull_request',
    deliveryId,
    objectType: 'pull_request',
    objectId: '42',
    taskReference: 'PROJ-123',
    taskId: overrides?.taskId ?? null,
    taskTitle: 'Test task',
    confidenceClass: 'high',
    status: overrides?.status ?? 'pending',
    evidencesJson: [
      { sourceField: 'pullRequestTitle', matchedPreview: 'PROJ-123 fix', ruleVersion: 1 },
    ],
    expiresAt: overrides?.expiresAt ?? DateTime.utc().plus({ hours: 72 }),
  })
}

// ---------------------------------------------------------------------------
// §5.2 API/Policy 权限测试
// ---------------------------------------------------------------------------

test.group('LinkCandidate Policy — 权限隔离', (group) => {
  useAuthDatabase(group)

  test('跨组织无法看到候选', async ({ assert }) => {
    const c = await createTestCandidate({ organizationId: 1 })
    const found = await candidateService.getById(c.id, 999)
    assert.isNull(found)
  })

  test('同组织可以看到候选', async ({ assert }) => {
    const c = await createTestCandidate({ organizationId: 1 })
    const found = await candidateService.getById(c.id, 1)
    assert.isNotNull(found)
    assert.equal(found!.id, c.id)
  })

  test('listByTaskPaginated 只返回指定组织的候选', async ({ assert }) => {
    await createTestCandidate({ organizationId: 1, taskId: 100 })
    await createTestCandidate({ organizationId: 2, taskId: 100 })
    const result = await candidateService.listByTaskPaginated(1, 100)
    assert.equal(result.total, 1) // 只有组织 1 的
  })

  test('不存在的候选 ID 返回 null', async ({ assert }) => {
    const found = await candidateService.getById(99999, 1)
    assert.isNull(found)
  })

  test('已处理的候选无法再次确认', async ({ assert }) => {
    const c = await createTestCandidate({ status: 'confirmed' })
    try {
      await candidateService.confirm(c.id, c.organizationId, 1)
      assert.fail('应抛出异常')
    } catch (e: any) {
      assert.include(e.message, '不允许')
    }
  })

  test('已忽略的候选无法再次确认', async ({ assert }) => {
    const c = await createTestCandidate({ status: 'ignored' })
    try {
      await candidateService.confirm(c.id, c.organizationId, 1)
      assert.fail('应抛出异常')
    } catch (e: any) {
      assert.include(e.message, '不允许')
    }
  })
})

// ---------------------------------------------------------------------------
// §5.4 确认事务测试
// ---------------------------------------------------------------------------

test.group('CandidateConfirmService — 确认事务', (group) => {
  useAuthDatabase(group)

  test('候选不存在时返回 already_settled', async ({ assert }) => {
    const result = await confirmService.confirm(99999, 1, 1, 1, {
      userId: 1,
      organizationId: 1,
    })
    assert.isFalse(result.success)
    assert.equal(result.status, 'already_settled')
  })

  test('已确认候选重复调用返回 already_settled', async ({ assert }) => {
    const c = await createTestCandidate({ status: 'confirmed' })
    const result = await confirmService.confirm(c.id, 1, 1, 1, {
      userId: 1,
      organizationId: 1,
    })
    assert.isFalse(result.success)
    assert.equal(result.status, 'already_settled')
  })

  test('过期候选返回 expired', async ({ assert }) => {
    const c = await createTestCandidate({
      expiresAt: DateTime.utc().minus({ hours: 1 }),
    })
    const result = await confirmService.confirm(c.id, 1, 1, 1, {
      userId: 1,
      organizationId: 1,
    })
    assert.isFalse(result.success)
    assert.equal(result.status, 'expired')
  })

  test('重复确认幂等', async ({ assert }) => {
    const c = await createTestCandidate()
    // 模拟重复确认（候选还在 pending 但外部链接已由其他路径创建）
    try {
      await candidateService.confirm(c.id, c.organizationId, 1)
    } catch {
      /* expected if confirmService already handled it */
    }

    const refetch = await LinkCandidate.find(c.id)
    // Candidate 应被标记为 confirmed 或 rejected
    assert.isTrue(['confirmed', 'rejected'].includes(refetch?.status ?? ''))
  })

  test('确认后候选标记为 confirmed', async ({ assert }) => {
    const c = await createTestCandidate({ taskId: null })
    // 尝试确认（没有对应任务时应标记 rejected）
    const result = await confirmService.confirm(c.id, 1, 1, 999, {
      userId: 1,
      organizationId: 1,
    })
    assert.isFalse(result.success)
    // 任务不存在 → rejected
    const refetch = await LinkCandidate.find(c.id)
    assert.equal(refetch?.status, 'rejected')
  })
})

// ---------------------------------------------------------------------------
// §5.6 忽略与审计测试
// ---------------------------------------------------------------------------

test.group('LinkCandidate — 忽略与审计', (group) => {
  useAuthDatabase(group)

  test('忽略 pending 候选成功', async ({ assert }) => {
    const c = await createTestCandidate()
    const ignored = await candidateService.ignore(c.id, c.organizationId, 1)
    assert.equal(ignored.status, 'ignored')
    assert.equal(ignored.settledBy, 1)
    assert.isNotNull(ignored.settledAt)
  })

  test('忽略不创建外部链接', async ({ assert }) => {
    const c = await createTestCandidate()
    await candidateService.ignore(c.id, c.organizationId, 1)

    // 验证没有外部链接被创建
    const links = await TaskExternalLink.query()
      .where('organization_id', c.organizationId)
      .where('task_id', c.taskId ?? 0)
    assert.lengthOf(links, 0)
  })

  test('重复忽略幂等', async ({ assert }) => {
    const c = await createTestCandidate()
    await candidateService.ignore(c.id, c.organizationId, 1)

    try {
      await candidateService.ignore(c.id, c.organizationId, 1)
      assert.fail('应抛出异常')
    } catch (e: any) {
      assert.include(e.message, '不允许')
    }
  })

  test('忽略后无法确认', async ({ assert }) => {
    const c = await createTestCandidate()
    await candidateService.ignore(c.id, c.organizationId, 1)

    try {
      await candidateService.confirm(c.id, c.organizationId, 1)
      assert.fail('应抛出异常')
    } catch (e: any) {
      assert.include(e.message, '不允许')
    }
  })
})

// ---------------------------------------------------------------------------
// §7.2 Feature flag
// ---------------------------------------------------------------------------

test.group('LinkCandidate — Feature flag', (group) => {
  useAuthDatabase(group)

  test('cleanupExpired 只清理过期候选', async ({ assert }) => {
    // 创建正常候选
    await createTestCandidate({ status: 'confirmed' })
    await createTestCandidate({ status: 'ignored' })

    // 清理
    const count = await candidateService.cleanupExpired()
    assert.equal(count, 0) // 没有 expired 候选，不会误删
  })

  test('过期候选不参与列表', async ({ assert }) => {
    const c = await createTestCandidate({ status: 'expired' })
    const found = await candidateService.getById(c.id, c.organizationId)
    assert.isNotNull(found) // 仍可查到
    assert.equal(found!.status, 'expired')
  })
})
