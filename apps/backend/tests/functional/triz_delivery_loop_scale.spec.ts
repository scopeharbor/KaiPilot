/**
 * v3-triz-to-delivery-closed-loop §11.1/11.2 —— 1000-link 实际数据库规模门。
 *
 * 冻结口径：1000 links、100 items/page、50 delivery refs/link、20 context refs/link；
 * list/summary/filter/posture p95 <1500ms、detail p95 <800ms、单次读取 SQL ≤12。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { ClosedLoopReadModelService } from '#services/triz_delivery_loop/closed_loop_read_model_service'
import {
  TrizDlClosedAdapterRegistry,
  type TrizDlClosedDeliveryPort,
} from '#services/triz_delivery_loop/read_adapters'
import {
  TrizDlRiskContextPort,
  TrizDlTaskDbPort,
} from '#services/triz_delivery_loop/default_read_adapters'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const SCALE_LINKS = 1000
const PAGE_SIZE = 100
const DELIVERY_REFS = 50
const CONTEXT_REFS = 20
const LIST_P95_MS = 1500
const DETAIL_P95_MS = 800
const QUERY_BUDGET = 12

const now = () => DateTime.now().toSQL()!

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0
}

async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0
  // Lucid 的测试连接不会稳定暴露 db:query emitter；read model 的每条 SQL 都从
  // db.query() 建 builder，因此在这条门禁内透明包裹该工厂，得到可复现的实际 SQL 数。
  const queryHost = db as unknown as {
    query: (...args: unknown[]) => unknown
  }
  const originalQuery = queryHost.query
  queryHost.query = (...args: unknown[]) => {
    queries += 1
    return originalQuery.apply(db, args)
  }
  try {
    return { result: await fn(), queries }
  } finally {
    queryHost.query = originalQuery
  }
}

function countingRegistry(counter: Map<string, number>): TrizDlClosedAdapterRegistry {
  const wrap = (port: TrizDlClosedDeliveryPort): TrizDlClosedDeliveryPort => ({
    kind: port.kind,
    fetchSummaries: async (ids, ctx) => {
      counter.set(port.kind, (counter.get(port.kind) ?? 0) + 1)
      return port.fetchSummaries(ids, ctx)
    },
  })
  return new TrizDlClosedAdapterRegistry()
    .register(wrap(new TrizDlTaskDbPort()))
    .register(wrap(new TrizDlRiskContextPort()))
}

async function seedScaleWorld() {
  const owner = await createUser({
    email: `tdl-scale-${Date.now()}@test.local`,
  })
  const org = await createOrganization(owner)
  const [projectIdRaw] = await db.table('projects').insert({
    organization_id: org.id,
    name: 'TRIZ 闭环规模门',
    description: null,
    status: 'active',
    priority: 'medium',
    created_by: owner.id,
    created_at: now(),
    updated_at: now(),
  })
  const projectId = Number(projectIdRaw)
  const [decisionIdRaw] = await db.table('triz_decision_logs').insert({
    organization_id: org.id,
    project_id: projectId,
    decision_type: 'adopt',
    decision_status: 'active',
    subject_refs: '[]',
    source_refs: '[]',
    artifact_hashes: '[]',
    reason_summary: '规模门决策',
    reason_hash: 'tdl-scale-reason',
    alternative_summary: null,
    supersedes_decision_log_id: null,
    created_by: owner.id,
    created_at: now(),
  })
  const decisionId = Number(decisionIdRaw)

  await db.table('tasks').multiInsert(
    Array.from({ length: DELIVERY_REFS }, (_, i) => ({
      project_id: projectId,
      name: `规模任务 ${String(i).padStart(2, '0')}`,
      status: 'in_progress',
      priority: 'medium',
      task_type: 'task',
      duration_days: 1,
      created_at: now(),
      updated_at: now(),
    })),
  )
  const taskRows = await db
    .query()
    .from('tasks')
    .where('project_id', projectId)
    .orderBy('id', 'asc')
    .select('id')

  await db.table('risks').multiInsert(
    Array.from({ length: CONTEXT_REFS }, (_, i) => ({
      organization_id: org.id,
      project_id: projectId,
      risk_code: `TDL-SCALE-${i}`,
      title: `规模风险 ${String(i).padStart(2, '0')}`,
      description: '低敏规模 fixture',
      category: 'technical',
      probability: 2,
      impact: 2,
      score: 4,
      status: 'mitigating',
      identified_at: '2026-08-01',
      created_by: owner.id,
      created_at: now(),
      updated_at: now(),
    })),
  )
  const riskRows = await db
    .query()
    .from('risks')
    .where('project_id', projectId)
    .orderBy('id', 'asc')
    .select('id')

  const deliveryRefs = taskRows.map((row) => ({ kind: 'task', entityId: String(row.id) }))
  const contextRefs = riskRows.map((row) => ({ kind: 'risk', entityId: String(row.id) }))
  for (let offset = 0; offset < SCALE_LINKS; offset += 100) {
    await db.table('triz_delivery_links').multiInsert(
      Array.from({ length: Math.min(100, SCALE_LINKS - offset) }, (_, i) => ({
        organization_id: org.id,
        project_id: projectId,
        decision_log_id: decisionId,
        delivery_refs: JSON.stringify(deliveryRefs),
        context_refs: JSON.stringify(contextRefs),
        link_mode: 'existing_entity',
        link_digest: `tdl-scale-${String(offset + i).padStart(4, '0')}`,
        actor_user_id: owner.id,
        created_at: now(),
      })),
    )
  }

  const firstLink = await db
    .query()
    .from('triz_delivery_links')
    .where('project_id', projectId)
    .orderBy('id', 'asc')
    .first()
  const deepLink = await db
    .query()
    .from('triz_delivery_links')
    .where('project_id', projectId)
    .orderBy('id', 'asc')
    .offset(899)
    .first()

  return {
    organizationId: Number(org.id),
    projectId,
    actorUserId: Number(owner.id),
    firstLinkId: Number(firstLink.id),
    deepLinkId: Number(deepLink.id),
    hiddenTaskId: String(taskRows[0]!.id),
  }
}

test.group('TRIZ 交付闭环 — 1000-link 性能与有界载荷门', (group) => {
  useAuthDatabase(group)

  test('list/summary/filter/posture 保持批量查询、p95 与 payload 上限', async ({ assert }) => {
    const world = await seedScaleWorld()
    const calls = new Map<string, number>()
    const service = new ClosedLoopReadModelService(countingRegistry(calls))
    const params = {
      organizationId: world.organizationId,
      projectId: world.projectId,
      actorUserId: world.actorUserId,
      perPage: PAGE_SIZE,
      postureFilter: 'in_progress' as const,
    }

    await service.list({ ...params, page: 1 })
    calls.clear()
    const measured = await withQueryCount(() => service.list({ ...params, page: 6 }))
    assert.lengthOf(measured.result.items, PAGE_SIZE)
    assert.equal(measured.result.summary.visibleItemCount, PAGE_SIZE)
    assert.isTrue(measured.result.items.every((item) => item.posture === 'in_progress'))
    assert.equal(calls.get('task'), 1)
    assert.equal(calls.get('risk'), 1)
    assert.isAtMost(measured.queries, QUERY_BUDGET)

    const payloadBytes = Buffer.byteLength(JSON.stringify(measured.result), 'utf8')
    assert.isBelow(payloadBytes, 1_000_000, `100-item payload ${payloadBytes} bytes 超出 1MB`)

    const samples: number[] = []
    for (let run = 0; run < 12; run += 1) {
      const started = performance.now()
      await service.list({ ...params, page: (run % 10) + 1 })
      samples.push(performance.now() - started)
    }
    const p50 = percentile(samples, 0.5)
    const p95 = percentile(samples, 0.95)
    console.log(
      `[PERF][TRIZ-DL] list summary/filter/posture p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms queries=${measured.queries} payload=${payloadBytes}B`,
    )
    assert.isBelow(p95, LIST_P95_MS)
  }).timeout(180000)

  test('deep detail 使用权威 posture；隐藏 refs 不进入 refs、排序或 payload', async ({
    assert,
  }) => {
    const world = await seedScaleWorld()
    const service = new ClosedLoopReadModelService(countingRegistry(new Map()))

    const detailProbe = await withQueryCount(() =>
      service.detail(`link-${world.deepLinkId}`, {
        organizationId: world.organizationId,
        projectId: world.projectId,
      }),
    )
    assert.equal(detailProbe.result.posture, 'in_progress')
    assert.lengthOf(detailProbe.result.entitySummaries, DELIVERY_REFS)
    assert.lengthOf(detailProbe.result.contextSummaries, CONTEXT_REFS)
    assert.isTrue(detailProbe.result.entitySummaries.every((entry) => entry.kind === 'task'))
    assert.isTrue(detailProbe.result.contextSummaries.every((entry) => entry.kind === 'risk'))
    assert.isAtMost(detailProbe.queries, QUERY_BUDGET)

    const samples: number[] = []
    for (let run = 0; run < 10; run += 1) {
      const started = performance.now()
      await service.detail(`link-${world.deepLinkId}`, {
        organizationId: world.organizationId,
        projectId: world.projectId,
      })
      samples.push(performance.now() - started)
    }
    const p50 = percentile(samples, 0.5)
    const p95 = percentile(samples, 0.95)
    console.log(
      `[PERF][TRIZ-DL] detail p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms queries=${detailProbe.queries}`,
    )
    assert.isBelow(p95, DETAIL_P95_MS)

    const hidden = await service.list({
      organizationId: world.organizationId,
      projectId: world.projectId,
      actorUserId: world.actorUserId,
      page: 1,
      perPage: PAGE_SIZE,
      hiddenEntityIds: new Set([world.hiddenTaskId]),
    })
    assert.isTrue(hidden.meta.hasHiddenRefs)
    assert.isTrue(
      hidden.items.every(
        (item) =>
          item.warningCodes.includes('TRIZ_DL_HIDDEN_ENTITY') &&
          !item.deliveryRefs.some((ref) => ref.entityId === world.hiddenTaskId),
      ),
    )
    const sortedIds = hidden.items.map((item) => item.itemId)
    const rerunResult = await service.list({
      organizationId: world.organizationId,
      projectId: world.projectId,
      actorUserId: world.actorUserId,
      page: 1,
      perPage: PAGE_SIZE,
      hiddenEntityIds: new Set([world.hiddenTaskId]),
    })
    const rerunIds = rerunResult.items.map((item) => item.itemId)
    assert.deepEqual(rerunIds, sortedIds, '隐藏 ref 不得改变稳定排序')
  }).timeout(180000)
})
