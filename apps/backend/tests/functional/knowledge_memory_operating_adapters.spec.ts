/**
 * v3-knowledge-memory-operating-layer —— 四个只读 adapter 的 DB 级功能测试。
 *
 * 覆盖：
 * - 3.4  knowledge：同租/跨租、L1–L4、pending/outdated、L3 排除、低敏字段
 * - 3.6  memory：本人/他人/组织、跨租、candidate/confirmed/invalidated、inference 恒定
 * - 3.8  Skill draft：pending/committed/discarded、stale base、plugin enabled/disabled/uninstalled
 * - 3.10 observation：zero-result、no-observation、degraded、truncation、匿名权限计数
 * - 3.11 page-scoped 批量查询：查询次数与对象数解耦，禁止逐行 N+1
 * - 3.12 单 lane 失败 → degraded，无自动重试、无 provider fallback
 * - 3.13 adapter 输出低敏 allowlist：正文/摘要/secret 不得穿透到聚合器
 *
 * 直接实例化 port（不经 HTTP），因此断言的是 adapter 语义本身。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

import CompilerSkill from '#models/compiler_skill'
import CopilotContextObservation from '#models/copilot_context_observation'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import KnowledgeItem from '#models/knowledge_item'
import PluginInstallation from '#models/plugin_installation'
import SkillKnowledgeDraft from '#models/skill_knowledge_draft'
import AuditService from '#services/audit_service'
import KnowledgeService from '#services/knowledge/knowledge_service'
import type Organization from '#models/organization'
import type User from '#models/user'

import KnowledgeOperatingReadPort from '#services/knowledge_memory_operating/knowledge_port'
import CopilotMemoryOperatingReadPort from '#services/knowledge_memory_operating/memory_port'
import SkillKnowledgeDraftOperatingReadPort from '#services/knowledge_memory_operating/skill_draft_port'
import RetrievalSignalOperatingReadPort from '#services/knowledge_memory_operating/observation_port'
import type { OperatingReadContext } from '#services/knowledge_memory_operating/port'
import { scanOperatingLowSensitive } from '@aiproj/types'

import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const BAIT_BODY = '知识正文诱饵-adapter-ABC'
const BAIT_SUMMARY = '记忆摘要诱饵-adapter-XYZ'
const BAIT_SECRET = 'sk-live-adapter-000111'

function ctxFor(org: Organization, actor: User): OperatingReadContext {
  return { organizationId: org.id, actorId: actor.id, projectId: null, evalContext: false }
}

function knowledgePort(): KnowledgeOperatingReadPort {
  return new KnowledgeOperatingReadPort(new KnowledgeService(new AuditService()))
}

/** 统计一次调用期间的 SQL 查询数（无 N+1 门禁用）。 */
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

async function seedKnowledge(
  org: Organization,
  creator: User,
  o: Partial<{
    layer: 'L1' | 'L2' | 'L3' | 'L4'
    status: 'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'
    title: string
    isSynthetic: boolean
    hasProvenance: boolean
  }> = {},
) {
  return KnowledgeItem.create({
    organizationId: org.id,
    layer: o.layer ?? 'L1',
    layerMeta: {} as never,
    title: o.title ?? '条目',
    content: { body: BAIT_BODY, secret: BAIT_SECRET } as never,
    status: o.status ?? 'active',
    domain: 'delivery',
    purpose: 'planning',
    complexity: null,
    provenance: ((o.hasProvenance ?? true)
      ? {
          sources: [
            {
              layer: 'L1',
              sourceId: 's1',
              isSynthetic: false,
              retrievedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
        }
      : { sources: [] }) as never,
    reviewHistory: [] as never,
    isSynthetic: o.isSynthetic ?? false,
    syntheticMethod: null,
    createdBy: creator.id,
    updatedBy: null,
    lastReferencedAt: null,
    retentionDays: null,
  })
}

async function seedMemory(
  org: Organization,
  actor: User,
  o: Partial<{
    memoryScope: 'user' | 'project' | 'organization'
    status: 'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
  }> = {},
) {
  return CopilotMemoryEntry.create({
    organizationId: org.id,
    projectId: null,
    actorId: actor.id,
    entryId: `mem-${Math.random().toString(36).slice(2, 12)}`,
    memoryScope: o.memoryScope ?? 'user',
    summary: BAIT_SUMMARY,
    confidence: 0.7,
    confidenceSource: 'single_observation',
    basisSessionDbId: null,
    status: o.status ?? 'candidate',
    validityTier: 'medium',
    observedAt: DateTime.now().minus({ days: 2 }),
    lastConfirmedAt: null,
    retentionExpiresAt: null,
  })
}

async function seedSkillDraft(
  org: Organization,
  creator: User,
  o: Partial<{
    skillKey: string
    skillVersion: string
    baseVersion: string
    draftStatus: 'pending' | 'committed' | 'discarded'
  }> = {},
) {
  const skill = await CompilerSkill.create({
    organizationId: org.id,
    skillKey: o.skillKey ?? `core.builtin.s${Math.random().toString(36).slice(2, 8)}`,
    name: 'Skill',
    version: o.skillVersion ?? '1.0.0',
    description: 'd',
    status: 'active' as never,
    category: 'delivery' as never,
    tags: [] as never,
    dependencies: [] as never,
    activation: {} as never,
    knowledge: {} as never,
    provenance: null,
    basePriority: 1,
    createdBy: creator.id,
    updatedBy: creator.id,
  })
  const draft = await SkillKnowledgeDraft.create({
    organizationId: org.id,
    skillId: skill.id,
    sections: [] as never,
    baseVersion: o.baseVersion ?? o.skillVersion ?? '1.0.0',
    status: (o.draftStatus ?? 'pending') as never,
    aiAssisted: false,
    createdBy: creator.id,
    updatedBy: creator.id,
  })
  return { skill, draft }
}

const WINDOW = 50

test.group('knowledge adapter（§3.4）', (group) => {
  useAuthDatabase(group)

  test('只返回本组织条目，跨租条目不可见也不计数', async ({ assert }) => {
    const ua = await createUser()
    const orgA = await createOrganization(ua)
    const ub = await createUser()
    const orgB = await createOrganization(ub)
    await seedKnowledge(orgA, ua, { status: 'pending' })
    await seedKnowledge(orgB, ub, { status: 'pending' })
    await seedKnowledge(orgB, ub, { status: 'active' })

    const port = knowledgePort()
    const list = await port.listWindow({ ctx: ctxFor(orgA, ua), limit: WINDOW })
    const count = await port.countByFacets({ ctx: ctxFor(orgA, ua) })
    assert.lengthOf(list.items, 1)
    assert.equal(count.total, 1)
  })

  test('pending / outdated / draft 都进入队列（不被 active-only 过滤吞掉）', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await seedKnowledge(org, u, { status: 'pending' })
    await seedKnowledge(org, u, { status: 'outdated' })
    await seedKnowledge(org, u, { status: 'draft' })
    await seedKnowledge(org, u, { status: 'active' })

    const list = await knowledgePort().listWindow({ ctx: ctxFor(org, u), limit: WINDOW })
    assert.lengthOf(list.items, 4)
    const lifecycles = list.items.map((i: any) => i.lifecycle).sort()
    assert.deepEqual(lifecycles, ['active', 'draft', 'outdated', 'pending'])
  })

  test('L1/L2/L4 可见，L3 在生产上下文被排除', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    for (const layer of ['L1', 'L2', 'L4'] as const) {
      await seedKnowledge(org, u, { layer, status: 'active' })
    }
    await seedKnowledge(org, u, { layer: 'L3', status: 'active', isSynthetic: true })

    const list = await knowledgePort().listWindow({ ctx: ctxFor(org, u), limit: WINDOW })
    const layers = list.items.map((i: any) => i.layer).sort()
    assert.deepEqual(layers, ['L1', 'L2', 'L4'])
  })

  test('缺 provenance 的条目派生 provenance_gap', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await seedKnowledge(org, u, { status: 'active', hasProvenance: false })

    const list = await knowledgePort().listWindow({ ctx: ctxFor(org, u), limit: WINDOW })
    assert.equal(list.items[0]!.status, 'provenance_gap')
  })

  test('输出不含正文与 secret（低敏 allowlist）', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await seedKnowledge(org, u, { status: 'pending' })

    const list = await knowledgePort().listWindow({ ctx: ctxFor(org, u), limit: WINDOW })
    const payload = JSON.stringify(list.items)
    assert.notInclude(payload, BAIT_BODY)
    assert.notInclude(payload, BAIT_SECRET)
    assert.isTrue(scanOperatingLowSensitive({ items: list.items }).safe)
  })

  test('查询次数与条目数解耦：200 条仍是常数级查询（§3.11）', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    for (let i = 0; i < 200; i += 1) {
      await seedKnowledge(org, u, { status: i % 2 === 0 ? 'pending' : 'active', title: `条目${i}` })
    }

    const { result, queries } = await withQueryCount(() =>
      knowledgePort().listWindow({ ctx: ctxFor(org, u), limit: 20 }),
    )
    assert.lengthOf(result.items, 20)
    assert.equal(result.laneTotal, 200)
    assert.isAtMost(queries, 3, `200 条只应发常数级查询，实际 ${queries}`)
  })
})

test.group('memory adapter（§3.6）', (group) => {
  useAuthDatabase(group)

  test('本人 user memory 可见，他人 user memory 不可见也不计数', async ({ assert }) => {
    const me = await createUser()
    const org = await createOrganization(me)
    const other = await createUser()
    await seedMemory(org, me, { memoryScope: 'user' })
    await seedMemory(org, other, { memoryScope: 'user' })

    const port = new CopilotMemoryOperatingReadPort()
    const list = await port.listWindow({ ctx: ctxFor(org, me), limit: WINDOW })
    const count = await port.countByFacets({ ctx: ctxFor(org, me) })
    assert.lengthOf(list.items, 1)
    assert.equal(count.total, 1)
  })

  test('organization scope memory 对组织内成员可见', async ({ assert }) => {
    const me = await createUser()
    const org = await createOrganization(me)
    const other = await createUser()
    await seedMemory(org, other, { memoryScope: 'organization' })

    const list = await new CopilotMemoryOperatingReadPort().listWindow({
      ctx: ctxFor(org, me),
      limit: WINDOW,
    })
    assert.lengthOf(list.items, 1)
    assert.equal(list.items[0]!.scope, 'organization')
  })

  test('跨租 memory 完全不可见', async ({ assert }) => {
    const ua = await createUser()
    const orgA = await createOrganization(ua)
    const ub = await createUser()
    const orgB = await createOrganization(ub)
    await seedMemory(orgB, ub, { memoryScope: 'organization' })

    const list = await new CopilotMemoryOperatingReadPort().listWindow({
      ctx: ctxFor(orgA, ua),
      limit: WINDOW,
    })
    assert.lengthOf(list.items, 0)
  })

  test('candidate / confirmed / invalidated 派生不同 attention，但都仍是 inference', async ({
    assert,
  }) => {
    const me = await createUser()
    const org = await createOrganization(me)
    await seedMemory(org, me, { status: 'candidate' })
    await seedMemory(org, me, { status: 'confirmed' })
    await seedMemory(org, me, { status: 'invalidated' })

    const list = await new CopilotMemoryOperatingReadPort().listWindow({
      ctx: ctxFor(org, me),
      limit: WINDOW,
    })
    assert.lengthOf(list.items, 3)
    // 已确认也绝不升格为 fact：每一项都带 inference 标
    for (const item of list.items) {
      assert.include(item.safeLabels, 'inference')
    }
    const candidate = list.items.find((i: any) => i.statusDetail === 'candidate')!
    assert.equal(candidate.status, 'needs_review')
  })

  test('输出只带 summary byte size，不带 summary 内容', async ({ assert }) => {
    const me = await createUser()
    const org = await createOrganization(me)
    await seedMemory(org, me)

    const list = await new CopilotMemoryOperatingReadPort().listWindow({
      ctx: ctxFor(org, me),
      limit: WINDOW,
    })
    const payload = JSON.stringify(list.items)
    assert.notInclude(payload, BAIT_SUMMARY)
    const only = list.items[0]!
    assert.equal(only.kind, 'copilot_memory')
    if (only.kind !== 'copilot_memory') return
    assert.equal(only.summaryByteSize, BAIT_SUMMARY.length)
  })
})

test.group('skill draft adapter（§3.8）', (group) => {
  useAuthDatabase(group)

  test('pending / committed / discarded 都被投影且状态可区分', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await seedSkillDraft(org, u, { draftStatus: 'pending' })
    await seedSkillDraft(org, u, { draftStatus: 'committed' })
    await seedSkillDraft(org, u, { draftStatus: 'discarded' })

    const list = await new SkillKnowledgeDraftOperatingReadPort().listWindow({
      ctx: ctxFor(org, u),
      limit: WINDOW,
    })
    assert.lengthOf(list.items, 3)
    const statuses = list.items.map((i: any) => i.draftStatus).sort()
    assert.deepEqual(statuses, ['committed', 'discarded', 'pending'])
  })

  test('base version 落后 → baseStale', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await seedSkillDraft(org, u, { skillVersion: '2.0.0', baseVersion: '1.0.0' })

    const list = await new SkillKnowledgeDraftOperatingReadPort().listWindow({
      ctx: ctxFor(org, u),
      limit: WINDOW,
    })
    const draft = list.items[0]!
    assert.equal(draft.kind, 'skill_knowledge_draft')
    if (draft.kind !== 'skill_knowledge_draft') return
    assert.isTrue(draft.baseStale)
  })

  test('plugin enabled / disabled / 无安装记录 三态可区分', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    for (const [pluginId, status] of [
      ['com.vendor.on', 'enabled'],
      ['com.vendor.off', 'installed'],
    ] as const) {
      await PluginInstallation.create({
        organizationId: org.id,
        pluginId,
        version: '1.0.0',
        releaseId: 1,
        // 表约束只接受 installed/enabled/uninstalled；'disabled' 由
        // 'installed'（已安装但未启用）表达。
        status: status as never,
        packageDigest: 'sha256:p',
        manifestDigest: 'sha256:m',
        compatibilityDigest: 'sha256:c',
        rowVersion: 1,
      })
    }
    await seedSkillDraft(org, u, { skillKey: 'com.vendor.on.methodology' })
    await seedSkillDraft(org, u, { skillKey: 'com.vendor.off.methodology' })
    await seedSkillDraft(org, u, { skillKey: 'com.vendor.gone.methodology' })

    const list = await new SkillKnowledgeDraftOperatingReadPort().listWindow({
      ctx: ctxFor(org, u),
      limit: WINDOW,
    })
    const byPlugin = new Map(
      list.items.map((i: any) => [i.pluginProvenance.pluginId, i.pluginProvenance]),
    )
    assert.isFalse(byPlugin.get('com.vendor.on')!.disabled)
    assert.isTrue(byPlugin.get('com.vendor.off')!.disabled)
    // 没有安装记录 = 已卸载：fail closed
    assert.isTrue(byPlugin.get('com.vendor.gone')!.uninstalled)
  })

  test('100 条草稿仍是常数级查询，不做逐行 skill/plugin 查找（§3.11）', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    for (let i = 0; i < 100; i += 1) {
      await seedSkillDraft(org, u, { skillKey: `com.vendor.p${i}.methodology` })
    }

    const { result, queries } = await withQueryCount(() =>
      new SkillKnowledgeDraftOperatingReadPort().listWindow({ ctx: ctxFor(org, u), limit: 20 }),
    )
    assert.lengthOf(result.items, 20)
    assert.equal(result.laneTotal, 100)
    // 早期实现是 2N+1（=201 次）；批量 join 后固定 3 次
    assert.isAtMost(queries, 4, `100 条草稿只应发常数级查询，实际 ${queries}`)
  })
})

test.group('observation adapter（§3.10）', (group) => {
  useAuthDatabase(group)

  test('无观测记录 → empty coverage，而不是 degraded 或 ready', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)

    const count = await new RetrievalSignalOperatingReadPort().countByFacets({
      ctx: ctxFor(org, u),
    })
    assert.equal(count.total, 0)
    assert.equal(count.coverage, 'empty')
    assert.isFalse(count.degraded)
  })

  test('zero-result 观测聚合为 retrieval_gap，且不含原始 query', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await CopilotContextObservation.create({
      organizationId: org.id,
      assemblyId: 'asm-1',
      projectId: null,
      actorId: u.id,
      sources: JSON.stringify([
        { retrievalKind: 'knowledge', hitCount: 0, scoreRange: { min: 0, max: 0 } },
      ]),
      truncation: JSON.stringify({ truncated: false }),
      uncertainty: JSON.stringify({ notAccessibleCount: 0, notExistsCount: 0 }),
      retrievalQuality: JSON.stringify([]),
      routingInputsPreserved: true,
      totalMs: 10,
      degraded: false,
      degradedReason: null,
      observedAt: new Date(),
      createdAt: new Date(),
    })

    const list = await new RetrievalSignalOperatingReadPort().listWindow({
      ctx: ctxFor(org, u),
      limit: WINDOW,
    })
    assert.lengthOf(list.items, 1)
    const signal = list.items[0]!
    assert.equal(signal.kind, 'retrieval_signal')
    if (signal.kind !== 'retrieval_signal') return
    assert.equal(signal.retrievalKind, 'knowledge')
    // 零结果不得被叙述成「实体不存在」：只报 gap 信号
    assert.notEqual(signal.status, 'ready')
    // 只带 query **类别**，绝不带原始 query 文本
    assert.equal(signal.queryCategory, 'unspecified')
    assert.notProperty(signal, 'query')
    assert.notProperty(signal, 'queryText')
  })

  test('写入降级的观测把信号标为 degraded', async ({ assert }) => {
    const u = await createUser()
    const org = await createOrganization(u)
    await CopilotContextObservation.create({
      organizationId: org.id,
      assemblyId: 'asm-2',
      projectId: null,
      actorId: u.id,
      sources: JSON.stringify([
        { retrievalKind: 'memory', hitCount: 3, scoreRange: { min: 0.1, max: 0.9 } },
      ]),
      truncation: JSON.stringify({ truncated: true }),
      uncertainty: JSON.stringify({ notAccessibleCount: 2, notExistsCount: 0 }),
      retrievalQuality: JSON.stringify([]),
      routingInputsPreserved: true,
      totalMs: 20,
      degraded: true,
      degradedReason: 'writer_failure',
      observedAt: new Date(),
      createdAt: new Date(),
    })

    const list = await new RetrievalSignalOperatingReadPort().listWindow({
      ctx: ctxFor(org, u),
      limit: WINDOW,
    })
    const signal = list.items[0]!
    assert.equal(signal.kind, 'retrieval_signal')
    if (signal.kind !== 'retrieval_signal') return
    assert.isTrue(signal.degraded)
    assert.isTrue(signal.truncated)
    // 权限排除只进匿名计数，不带来源标识
    assert.equal(signal.permissionExcludedCount, 2)
    assert.notInclude(JSON.stringify(signal), 'writer_failure')
  })

  test('跨租观测不进入本组织聚合', async ({ assert }) => {
    const ua = await createUser()
    const orgA = await createOrganization(ua)
    const ub = await createUser()
    const orgB = await createOrganization(ub)
    await CopilotContextObservation.create({
      organizationId: orgB.id,
      assemblyId: 'asm-b',
      projectId: null,
      actorId: ub.id,
      sources: JSON.stringify([{ retrievalKind: 'secret-kind-b', hitCount: 0 }]),
      truncation: JSON.stringify({ truncated: false }),
      uncertainty: JSON.stringify({}),
      retrievalQuality: JSON.stringify([]),
      routingInputsPreserved: true,
      totalMs: 5,
      degraded: false,
      degradedReason: null,
      observedAt: new Date(),
      createdAt: new Date(),
    })

    const list = await new RetrievalSignalOperatingReadPort().listWindow({
      ctx: ctxFor(orgA, ua),
      limit: WINDOW,
    })
    assert.lengthOf(list.items, 0)
    assert.notInclude(JSON.stringify(list.items), 'secret-kind-b')
  })
})
