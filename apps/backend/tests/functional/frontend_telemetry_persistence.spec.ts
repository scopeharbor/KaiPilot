/**
 * v3-ai-quality-cost-console-deferred-p1 §3.4 —— 前端埋点持久化功能测试。
 *
 * 真实 SQLite 路径验证（spec: frontend-ai-usage-telemetry / 持久化需求四场景）：
 * - 落库后五指标可从持久化记录求出；
 * - 禁存字段/敏感样本不落库；
 * - 事件不跨组织；
 * - 持久化 schema 无画像字段（列清单断言）。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { createFrontendTelemetryService } from '#services/frontend_telemetry_service'
import { createOrganization, createUser, uniqueEmail } from './auth/_helpers.js'

test.group('前端埋点持久化（§3.4）', () => {
  async function makeOrganization(prefix: string): Promise<number> {
    const user = await createUser({ email: uniqueEmail(prefix) })
    const org = await createOrganization(user)
    return Number(org.id)
  }

  const now = Date.now()
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString()

  test('落库后五指标可从持久化记录求出（聚合确定性）', async ({ assert }) => {
    const organizationId = await makeOrganization('fte-agg')
    const service = createFrontendTelemetryService()

    const { received, rejected } = await service.persistBatch(organizationId, [
      // 会话 s1：打开 + 两轮 + 首问 + 芯片点击
      { eventKind: 'panel_open', sessionId: 's1', timestamp: iso(0) },
      { eventKind: 'session_turn', sessionId: 's1', timestamp: iso(1000), turnCount: 1 },
      { eventKind: 'session_turn', sessionId: 's1', timestamp: iso(2000), turnCount: 2 },
      {
        eventKind: 'first_question_intent',
        sessionId: 's1',
        timestamp: iso(500),
        intentClass: 'query',
      },
      { eventKind: 'chip_click', sessionId: 's1', timestamp: iso(3000), chipId: 'chip-a' },
      // 会话 s2：打开后放弃
      { eventKind: 'panel_open', sessionId: 's2', timestamp: iso(4000) },
      { eventKind: 'abandonment', sessionId: 's2', timestamp: iso(5000) },
    ])

    assert.equal(received, 7)
    assert.equal(rejected, 0)

    const agg = await service.aggregateFromStore(organizationId, iso(-1000), iso(6000))
    assert.equal(agg.openRate, 1) // 两个会话都有 panel_open
    assert.equal(agg.sessionLength, 1) // (2 + 0) / 2
    assert.equal(agg.firstQuestionDistribution.query, 1)
    assert.equal(agg.abandonmentRate, 0.5) // 1 / 2 opens
    assert.equal(agg.chipClickDistribution['chip-a'], 1)

    // 聚合确定性：同窗口再读一次结果一致
    const agg2 = await service.aggregateFromStore(organizationId, iso(-1000), iso(6000))
    assert.deepEqual(agg2, agg)
  })

  test('禁存字段与敏感样本拒绝落库', async ({ assert }) => {
    const organizationId = await makeOrganization('fte-forbidden')
    const service = createFrontendTelemetryService()

    const { received, rejected } = await service.persistBatch(organizationId, [
      {
        eventKind: 'panel_open',
        sessionId: 's1',
        timestamp: iso(0),
        userInput: '用户输入的文本内容',
      },
      {
        eventKind: 'panel_open',
        sessionId: 's2',
        timestamp: iso(0),
        prompt: 'sk-1234567890abcdef',
      },
      { eventKind: 'panel_open', sessionId: 's3', timestamp: iso(0) },
    ])

    assert.equal(received, 1)
    assert.equal(rejected, 2)

    const rows = await db.from('frontend_telemetry_events').where('organization_id', organizationId)
    assert.lengthOf(rows, 1)
    // 落库行的序列化内容不得含敏感样本
    const serialized = JSON.stringify(rows)
    assert.notInclude(serialized, '用户输入的文本内容')
    assert.notInclude(serialized, 'sk-1234567890abcdef')
  })

  test('事件不跨组织：各组织聚合只含自己的事件', async ({ assert }) => {
    const orgA = await makeOrganization('fte-iso-a')
    const orgB = await makeOrganization('fte-iso-b')
    const service = createFrontendTelemetryService()

    await service.persistBatch(orgA, [
      { eventKind: 'panel_open', sessionId: 'a1', timestamp: iso(0) },
    ])
    await service.persistBatch(orgB, [
      { eventKind: 'panel_open', sessionId: 'b1', timestamp: iso(0) },
      { eventKind: 'panel_open', sessionId: 'b2', timestamp: iso(100) },
    ])

    const aggA = await service.aggregateFromStore(orgA, iso(-1000), iso(6000))
    const aggB = await service.aggregateFromStore(orgB, iso(-1000), iso(6000))

    // A 只 1 个会话（openRate 1），B 2 个会话；交叉验证 sessionLength 无串数
    assert.equal(aggA.openRate, 1)
    assert.equal(aggB.openRate, 1)
    const countA = await db
      .from('frontend_telemetry_events')
      .where('organization_id', orgA)
      .count('* as c')
    const countB = await db
      .from('frontend_telemetry_events')
      .where('organization_id', orgB)
      .count('* as c')
    assert.equal(Number(countA[0]?.c), 1)
    assert.equal(Number(countB[0]?.c), 2)
  })

  test('缺 sessionId/eventKind/timestamp 的事件拒绝落库', async ({ assert }) => {
    const organizationId = await makeOrganization('fte-invalid')
    const service = createFrontendTelemetryService()

    const { received, rejected } = await service.persistBatch(organizationId, [
      { eventKind: 'panel_open', timestamp: iso(0) }, // 缺 sessionId
      { sessionId: 's1', timestamp: iso(0) }, // 缺 eventKind
      { eventKind: 'panel_open', sessionId: 's1' }, // 缺 timestamp
      { eventKind: 'panel_open', sessionId: 's1', timestamp: iso(0) },
    ])

    assert.equal(received, 1)
    assert.equal(rejected, 3)
  })

  test('持久化 schema 无画像字段：列清单只含类别与计数所需列', async ({ assert }) => {
    const columns = (await db.rawQuery('PRAGMA table_info(frontend_telemetry_events)')) as unknown
    const names = new Set(((columns as Array<{ name: string }>) ?? []).map((c) => c.name))

    const allowed = new Set([
      'id',
      'organization_id',
      'session_id',
      'event_kind',
      'occurred_at',
      'has_submitted',
      'turn_count',
      'intent_class',
      'chip_id',
      'chip_source',
      'action_id',
      'action_label',
      'created_at',
    ])

    // 没有允许清单之外的列（无 user_id / actor / 画像辅助列）
    for (const name of names) {
      assert.isTrue(allowed.has(name), `存在未声明列: ${name}`)
    }
    // 关键列都在
    for (const required of allowed) {
      assert.isTrue(names.has(required), `缺少列: ${required}`)
    }
    // 显式负面断言：无用户标识列
    assert.isFalse(names.has('user_id'))
    assert.isFalse(names.has('actor_id'))
    assert.isFalse(names.has('user_input'))
    assert.isFalse(names.has('prompt'))
  })
})
