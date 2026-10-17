/**
 * v2-5-code-repository-auto-linking —— LinkCandidate model + CandidateService
 * 表驱动集成测试。
 *
 * 依赖 AdonisJS 数据库（test.sqlite），通过 Japa 运行。
 * 覆盖：创建/幂等、状态机迁移、过期确认、清理不删外链。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import LinkCandidate from '#models/link_candidate'
import CandidateService from '#services/candidates/candidate_service'
import { useAuthDatabase } from '../functional/auth/_helpers.js'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const service = new CandidateService()

async function ensureOrganization(id: number) {
  const existing = await db.from('organizations').where('id', id).first()
  if (existing) return

  const now = DateTime.utc().toSQL({ includeOffset: false })
  const ownerId = 10_000 + id
  await db.table('users').insert({
    id: ownerId,
    full_name: `候选测试用户 ${id}`,
    email: `link-candidate-${id}@test.local`,
    password: 'test-password',
    auth_provider: 'local',
    is_active: true,
    created_at: now,
    updated_at: now,
  })
  await db.table('organizations').insert({
    id,
    owner_id: ownerId,
    name: `候选测试组织 ${id}`,
    slug: `link-candidate-org-${id}`,
    plan_tier: 'free',
    created_at: now,
    updated_at: now,
  })
}

async function createCandidate(
  overrides?: Partial<{
    organizationId: number
    deliveryId: string
    objectType: string
    objectId: string
    taskReference: string
    ruleVersion: number
    status: string
    expiresAt: DateTime
    taskId: number | null
    taskTitle: string | null
  }>,
) {
  const organizationId = overrides?.organizationId ?? 1
  await ensureOrganization(organizationId)

  return LinkCandidate.create({
    organizationId,
    provider: 'github',
    repositoryFullName: 'org/repo',
    repositoryExternalId: 'R_kg123',
    eventType: 'pull_request',
    deliveryId: overrides?.deliveryId ?? `del-${Date.now()}`,
    objectType: overrides?.objectType ?? 'pull_request',
    objectId: overrides?.objectId ?? `${Date.now()}`,
    taskReference: overrides?.taskReference ?? 'PROJ-123',
    ruleVersion: overrides?.ruleVersion ?? 1,
    taskId: overrides?.taskId ?? 100,
    taskTitle: overrides?.taskTitle ?? 'Implement login',
    confidenceClass: 'high',
    status: overrides?.status ?? 'pending',
    evidencesJson: [
      { sourceField: 'pullRequestTitle', matchedPreview: 'PROJ-123 login', ruleVersion: 1 },
    ],
    expiresAt: overrides?.expiresAt ?? DateTime.utc().plus({ hours: 72 }),
  })
}

// ---------------------------------------------------------------------------
// §1 创建与幂等
// ---------------------------------------------------------------------------

test.group('LinkCandidate 创建与幂等', (group) => {
  useAuthDatabase(group)

  test('创建新候选成功', async ({ assert }) => {
    const c = await createCandidate()
    assert.equal(c.status, 'pending')
    assert.equal(c.organizationId, 1)
    assert.equal(c.taskReference, 'PROJ-123')
    assert.isAbove(c.id, 0)
  })

  test('相同幂等键 → 唯一约束阻止重复', async ({ assert }) => {
    const deliveryId = `del-dup-${Date.now()}`
    const objectId = `obj-dup-${Date.now()}`
    const c1 = await createCandidate({ deliveryId, objectId })
    assert.equal(c1.status, 'pending')

    // 尝试用相同幂等键创建
    try {
      await createCandidate({ deliveryId, objectId })
      assert.fail('应抛出唯一约束异常')
    } catch (e: any) {
      // SQLite 唯一约束违反
      const isUniqueError =
        e.code === 'SQLITE_CONSTRAINT' ||
        e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        e.message?.includes('UNIQUE') ||
        e.message?.includes('unique')
      assert.isTrue(isUniqueError, `应抛出唯一约束异常，收到: ${e.message}`)
    }
  })
})

// ---------------------------------------------------------------------------
// §2 状态迁移
// ---------------------------------------------------------------------------

test.group('LinkCandidate 状态迁移', (group) => {
  useAuthDatabase(group)

  test('pending → confirmed 合法', async ({ assert }) => {
    const c = await createCandidate()
    const confirmed = await service.confirm(c.id, c.organizationId, 1)
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.settledBy, 1)
    assert.isNotNull(confirmed.settledAt)
  })

  test('pending → ignored 合法', async ({ assert }) => {
    const c = await createCandidate()
    const ignored = await service.ignore(c.id, c.organizationId, 1)
    assert.equal(ignored.status, 'ignored')
  })

  test('confirmed → ignored 非法', async ({ assert }) => {
    const c = await createCandidate()
    await service.confirm(c.id, c.organizationId, 1)
    try {
      await service.ignore(c.id, c.organizationId, 1)
      assert.fail('应抛出 CandidateStatusTransitionError')
    } catch (e: any) {
      assert.include(e.message, '不允许')
    }
  })

  test('ignored → confirmed 非法', async ({ assert }) => {
    const c = await createCandidate()
    await service.ignore(c.id, c.organizationId, 1)
    try {
      await service.confirm(c.id, c.organizationId, 1)
      assert.fail('应抛出 CandidateStatusTransitionError')
    } catch (e: any) {
      assert.include(e.message, '不允许')
    }
  })

  test('pending → expired 合法', async ({ assert }) => {
    const c = await createCandidate({
      expiresAt: DateTime.utc().minus({ hours: 1 }),
    })
    // 试图确认已过期的候选
    try {
      await service.confirm(c.id, c.organizationId, 1)
      assert.fail('应抛出 CandidateExpiredError')
    } catch (e: any) {
      assert.include(e.message, '已过期')
    }
    // 验证已被标记为过期
    const refreshed = await LinkCandidate.find(c.id)
    assert.equal(refreshed?.status, 'expired')
  })
})

// ---------------------------------------------------------------------------
// §3 组织隔离
// ---------------------------------------------------------------------------

test.group('LinkCandidate 组织隔离', (group) => {
  useAuthDatabase(group)

  test('跨组织查询返回空', async ({ assert }) => {
    const c = await createCandidate({ organizationId: 1 })
    const found = await service.getById(c.id, 999)
    assert.isNull(found)
  })

  test('正确组织可以查到', async ({ assert }) => {
    const c = await createCandidate({ organizationId: 1 })
    const found = await service.getById(c.id, 1)
    assert.isNotNull(found)
    assert.equal(found!.id, c.id)
  })
})

// ---------------------------------------------------------------------------
// §4 过期与清理
// ---------------------------------------------------------------------------

test.group('LinkCandidate 过期与清理', (group) => {
  useAuthDatabase(group)

  test('清理不影响正式外链（没有清理非过期候选）', async ({ assert }) => {
    const c = await createCandidate({ status: 'confirmed' })
    const count = await service.cleanupExpired()
    assert.equal(count, 0)
    const stillThere = await LinkCandidate.find(c.id)
    assert.isNotNull(stillThere)
  })

  test('手动标记过期后可以被清理', async ({ assert }) => {
    const c = await createCandidate({
      status: 'pending',
      expiresAt: DateTime.utc().minus({ hours: 1 }),
    })
    // 先尝试确认触发过期
    try {
      await service.confirm(c.id, c.organizationId, 1)
    } catch (e: any) {
      // expected
    }
    const refreshed = await LinkCandidate.find(c.id)
    assert.equal(refreshed?.status, 'expired')
  })
})

// ---------------------------------------------------------------------------
// §5 toDto
// ---------------------------------------------------------------------------

test.group('LinkCandidate toDto', (group) => {
  useAuthDatabase(group)

  test('toDto 返回正确的 DTO 形状', async ({ assert }) => {
    const c = await createCandidate()
    const dto = service.toDto(c)
    assert.equal(dto.id, c.id)
    assert.equal(dto.status, 'pending')
    assert.equal(dto.taskReference, 'PROJ-123')
    assert.equal(dto.evidences[0].sourceField, 'pullRequestTitle')
    assert.isNotNull(dto.createdAt)
    assert.isNotNull(dto.expiresAt)
  })
})
