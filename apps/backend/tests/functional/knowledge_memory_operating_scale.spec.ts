/**
 * v3-knowledge-memory-operating-layer —— 规模与查询预算（§8.1/§8.2/§8.3）
 *
 * 规模 fixture：1000 knowledge + 1000 memory + 500 Skill drafts + 观测窗口 = 2500 对象。
 *
 * 覆盖：
 * - 8.1 本机规模 seed/probe harness
 * - 8.2 SQL / adapter-call 计数门禁：首页按 kind 常数级批量读取，无逐行 N+1
 * - 8.3 API 时延与 payload 探针（本机 SQLite，非 production build 的下界参考）
 *
 * 说明：p95 的**权威**测量在 `pnpm performance:gates`（production build）里做；
 * 本 spec 负责「查询次数」这一类与构建方式无关的结构性门禁，以及一个宽松的
 * 时延上界——把结构性回归挡在单元层，而不是等到 gate 才发现。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

import CompilerSkill from '#models/compiler_skill'
import KnowledgeItem from '#models/knowledge_item'
import AuditService from '#services/audit_service'
import KnowledgeService from '#services/knowledge/knowledge_service'
import type Organization from '#models/organization'
import type User from '#models/user'

import KnowledgeMemoryOperatingService from '#services/knowledge_memory_operating/operating_service'
import KnowledgeOperatingReadPort from '#services/knowledge_memory_operating/knowledge_port'
import CopilotMemoryOperatingReadPort from '#services/knowledge_memory_operating/memory_port'
import SkillKnowledgeDraftOperatingReadPort from '#services/knowledge_memory_operating/skill_draft_port'
import RetrievalSignalOperatingReadPort from '#services/knowledge_memory_operating/observation_port'
import type { OperatingReadContext } from '#services/knowledge_memory_operating/port'

import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const KNOWLEDGE_COUNT = 1000
const MEMORY_COUNT = 1000
const DRAFT_COUNT = 500

/** 本机 SQLite 的宽松上界；production build 的 p95<1000ms 由 performance:gates 判定。 */
const LOCAL_API_BUDGET_MS = 3000

function service(): KnowledgeMemoryOperatingService {
  return KnowledgeMemoryOperatingService.withPorts({
    knowledge: new KnowledgeOperatingReadPort(new KnowledgeService(new AuditService())),
    memory: new CopilotMemoryOperatingReadPort(),
    skillDraft: new SkillKnowledgeDraftOperatingReadPort(),
    retrieval: new RetrievalSignalOperatingReadPort(),
  } as never)
}

function ctxFor(org: Organization, actor: User): OperatingReadContext {
  return { organizationId: org.id, actorId: actor.id, projectId: null, evalContext: false }
}

async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0
  const listener = () => {
    queries += 1
  }
  db.connection().getWriteClient()
  const emitter = (db as unknown as { emitter?: { on: Function; off: Function } }).emitter
  if (emitter) emitter.on('db:query', listener)
  try {
    const result = await fn()
    return { result, queries }
  } finally {
    if (emitter) emitter.off('db:query', listener)
  }
}

/** 2500 对象规模种子：混合 visibility / lifecycle / attention。 */
async function seedScaleWorld(org: Organization, actor: User) {
  const lifecycles = ['pending', 'active', 'outdated', 'draft', 'deprecated'] as const
  const layers = ['L1', 'L2', 'L4'] as const

  const knowledgeRows = Array.from({ length: KNOWLEDGE_COUNT }, (_, i) => ({
    organization_id: org.id,
    layer: layers[i % layers.length]!,
    layer_meta: JSON.stringify({}),
    title: `规模知识条目 ${i}`,
    content: JSON.stringify({ body: `body-${i}` }),
    status: lifecycles[i % lifecycles.length]!,
    domain: 'delivery',
    purpose: 'planning',
    complexity: null,
    // 每 7 条留一个缺 provenance 的，制造 provenance_gap
    provenance: JSON.stringify(
      i % 7 === 0
        ? { sources: [] }
        : {
            sources: [
              {
                layer: 'L1',
                sourceId: `s${i}`,
                isSynthetic: false,
                retrievedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
          },
    ),
    review_history: JSON.stringify([]),
    is_synthetic: false,
    synthetic_method: null,
    created_by: actor.id,
    updated_by: null,
    last_referenced_at: null,
    retention_days: null,
    created_at: DateTime.now().toSQL(),
    updated_at: DateTime.now().minus({ minutes: i }).toSQL(),
  }))
  for (let i = 0; i < knowledgeRows.length; i += 200) {
    await db.table('knowledge_items').multiInsert(knowledgeRows.slice(i, i + 200))
  }

  const memoryStatuses = ['candidate', 'confirmed', 'possibly_outdated', 'invalidated'] as const
  const memoryRows = Array.from({ length: MEMORY_COUNT }, (_, i) => ({
    organization_id: org.id,
    project_id: null,
    actor_id: actor.id,
    entry_id: `scale-mem-${i}`,
    memory_scope: i % 3 === 0 ? 'organization' : 'user',
    summary: `summary-${i}`,
    confidence: 0.5,
    confidence_source: 'single_observation',
    basis_session_db_id: null,
    status: memoryStatuses[i % memoryStatuses.length]!,
    validity_tier: 'medium',
    observed_at: DateTime.now().minus({ minutes: i }).toSQL(),
    last_confirmed_at: null,
    retention_expires_at: null,
    created_at: DateTime.now().toSQL(),
    updated_at: DateTime.now().minus({ minutes: i }).toSQL(),
  }))
  for (let i = 0; i < memoryRows.length; i += 200) {
    await db.table('copilot_memory_entries').multiInsert(memoryRows.slice(i, i + 200))
  }

  // Skill + draft：一半 base 过期，制造 stale
  const skills: number[] = []
  const skillRows = Array.from({ length: DRAFT_COUNT }, (_, i) => ({
    organization_id: org.id,
    skill_key: `core.builtin.scale${i}`,
    name: `规模 Skill ${i}`,
    version: i % 2 === 0 ? '1.0.0' : '2.0.0',
    description: 'd',
    status: 'active',
    // category/tags/dependencies/activation/knowledge 都是 jsonColumn：
    // 走 raw multiInsert 时必须自己序列化，否则读回时 JSON.parse 直接抛。
    category: JSON.stringify('delivery'),
    tags: JSON.stringify([]),
    dependencies: JSON.stringify([]),
    activation: JSON.stringify({}),
    knowledge: JSON.stringify({}),
    provenance: null,
    base_priority: 1,
    created_by: actor.id,
    updated_by: actor.id,
    created_at: DateTime.now().toSQL(),
    updated_at: DateTime.now().toSQL(),
  }))
  for (let i = 0; i < skillRows.length; i += 200) {
    await db.table('compiler_skills').multiInsert(skillRows.slice(i, i + 200))
  }
  const createdSkills = await CompilerSkill.query().where('organization_id', org.id).select('id')
  for (const s of createdSkills) skills.push(s.id)

  const draftRows = skills.map((skillId, i) => ({
    organization_id: org.id,
    skill_id: skillId,
    sections: JSON.stringify([]),
    base_version: '1.0.0',
    status: 'pending',
    ai_assisted: false,
    created_by: actor.id,
    updated_by: actor.id,
    created_at: DateTime.now().toSQL(),
    updated_at: DateTime.now().minus({ minutes: i }).toSQL(),
  }))
  for (let i = 0; i < draftRows.length; i += 200) {
    await db.table('skill_knowledge_drafts').multiInsert(draftRows.slice(i, i + 200))
  }
}

test.group('运营层规模与查询预算（§8.1/§8.2/§8.3）', (group) => {
  useAuthDatabase(group)

  test('2500 对象：首页查询次数是常数级，与对象数无关', async ({ assert }) => {
    const actor = await createUser()
    const org = await createOrganization(actor)
    await seedScaleWorld(org, actor)
    const probe = await new SkillKnowledgeDraftOperatingReadPort().listWindow({
      ctx: ctxFor(org, actor),
      limit: 20,
    })

    console.log(
      '[skill-lane]',
      JSON.stringify({
        items: probe.items.length,
        laneTotal: probe.laneTotal,
        degraded: probe.degraded,
        q: probe.queryCount,
      }),
    )

    const svc = service()
    const { result, queries } = await withQueryCount(() =>
      svc.listItems(ctxFor(org, actor), { page: 1, perPage: 20 }),
    )

    assert.lengthOf(result.data, 20)
    assert.equal(
      result.meta.total,
      KNOWLEDGE_COUNT + MEMORY_COUNT + DRAFT_COUNT,
      `degradedLanes=${JSON.stringify(result.meta.degradedLanes)}`,
    )
    // 每 lane 一次有界扫描；Skill lane 额外两次批量 join。逐行 N+1 会是数千次。
    assert.isAtMost(queries, 12, `首页查询次数 ${queries} 超出常数级预算`)
  })

  test('翻到第 5 页查询次数不随页深增长', async ({ assert }) => {
    const actor = await createUser()
    const org = await createOrganization(actor)
    await seedScaleWorld(org, actor)

    const svc = service()
    const first = await withQueryCount(() =>
      svc.listItems(ctxFor(org, actor), { page: 1, perPage: 20 }),
    )
    const deep = await withQueryCount(() =>
      svc.listItems(ctxFor(org, actor), { page: 5, perPage: 20 }),
    )
    assert.equal(deep.queries, first.queries)
    assert.lengthOf(deep.result.data, 20)
  })

  test('summary 在 2500 对象下仍是常数级查询且计数正确', async ({ assert }) => {
    const actor = await createUser()
    const org = await createOrganization(actor)
    await seedScaleWorld(org, actor)

    const svc = service()
    const { result, queries } = await withQueryCount(() => svc.getSummary(ctxFor(org, actor)))

    assert.isAtMost(queries, 12, `summary 查询次数 ${queries} 超出常数级预算`)
    const laneTotal = result.lanes.reduce((s, l) => s + l.total, 0)
    assert.equal(laneTotal, KNOWLEDGE_COUNT + MEMORY_COUNT + DRAFT_COUNT)
    assert.isFalse(result.anyLaneDegraded)
  })

  test('相邻页在规模下仍无重复无遗漏', async ({ assert }) => {
    const actor = await createUser()
    const org = await createOrganization(actor)
    await seedScaleWorld(org, actor)

    const svc = service()
    const seen = new Set<string>()
    for (let page = 1; page <= 5; page += 1) {
      const res = await svc.listItems(ctxFor(org, actor), { page, perPage: 20 })
      for (const item of res.data) {
        const key = `${item.kind}:${item.scopedRef.ref}`
        assert.isFalse(seen.has(key), `第 ${page} 页出现重复项 ${key}`)
        seen.add(key)
      }
    }
    assert.equal(seen.size, 100)
  })

  test('首页时延与 payload 在本机预算内', async ({ assert }) => {
    const actor = await createUser()
    const org = await createOrganization(actor)
    await seedScaleWorld(org, actor)

    const svc = service()
    const durations: number[] = []
    let payloadBytes = 0
    for (let i = 0; i < 5; i += 1) {
      const started = Date.now()
      const res = await svc.listItems(ctxFor(org, actor), { page: 1, perPage: 20 })
      durations.push(Date.now() - started)
      payloadBytes = JSON.stringify(res).length
    }
    durations.sort((a, b) => a - b)
    const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]!

    // 记录到测试输出，便于收口 Observation Packet 引用

    console.log(
      `[scale-probe] p50=${durations[Math.floor(durations.length / 2)]}ms p95=${p95}ms payload=${payloadBytes}B`,
    )
    assert.isBelow(p95, LOCAL_API_BUDGET_MS, `本机首页 p95=${p95}ms 超出预算`)
    // 有界 payload：20 条低敏投影不应膨胀到 MB 级
    assert.isBelow(payloadBytes, 200_000, `payload ${payloadBytes}B 超出有界预算`)
  })

  test('规模下 detail 仍是单对象读取，不扫全表', async ({ assert }) => {
    const actor = await createUser()
    const org = await createOrganization(actor)
    await seedScaleWorld(org, actor)

    const first = await KnowledgeItem.query().where('organization_id', org.id).firstOrFail()
    const svc = service()
    const { result, queries } = await withQueryCount(() =>
      svc.getItemDetail(ctxFor(org, actor), { kind: 'knowledge_item', ref: `k-${first.id}` }),
    )
    assert.isNotNull(result)
    assert.isAtMost(queries, 4, `detail 查询次数 ${queries} 过多`)
  })
})
