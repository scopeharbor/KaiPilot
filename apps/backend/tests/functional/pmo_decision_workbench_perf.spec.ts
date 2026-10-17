/**
 * v3-pmo-decision-intelligence-workbench —— 有界性能门（task 11.3）。
 *
 * 规模约定：1000 projects / 100 cases / 每 case 5 options，本机 SQLite，
 * 禁止依赖外部缓存/容器。测量 queue / detail / comparison / readiness 的
 * p50/p95 与 query 形状；阈值固化于本文件（apply Observation Packet 记录）。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: any): Promise<string> {
  const response = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return response.body().data.accessToken
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

test.group('PMO 决策工作台 —— 有界性能门（task 11.3）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  test('1000 项目/100 cases/每 case 5 options：queue/detail/comparison/readiness p95 达标', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pmdw-perf') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    const { default: app } = await import('@adonisjs/core/services/app')

    // ── Seed：1000 projects（批量插入）──
    const { default: db } = await import('@adonisjs/lucid/services/db')
    await db.transaction(async (trx) => {
      const now = new Date().toISOString()
      const rows = Array.from({ length: 1000 }, (_, index) => ({
        organization_id: Number(org.id),
        name: `perf-project-${index}`,
        code: `PERF-${index}`,
        created_by: Number(owner.id),
        status: 'active',
        created_at: now,
        updated_at: now,
      }))
      // SQLite 变量上限：分批 200 行
      for (let start = 0; start < rows.length; start += 200) {
        await trx.table('projects').insert(rows.slice(start, start + 200))
      }
    })

    // ── Seed：100 cases × 5 options × 1 snapshot（直接建表行）──
    const caseIds: number[] = []
    await db.transaction(async (trx) => {
      const now = new Date().toISOString()
      // 逐条插入并取 id（SQLite 无多行 returning）
      for (let index = 0; index < 100; index += 1) {
        const inserted = await trx
          .table('pmo_decision_cases')
          .insert({
            organization_id: Number(org.id),
            title: `perf-case-${index}`,
            decision_question: `性能议题 ${index}？`,
            scope_summary: 'perf',
            owner_id: Number(owner.id),
            due_date: null,
            status: 'under-review',
            revision: 2,
            supersedes_case_id: null,
            superseded_by_case_id: null,
            created_by: Number(owner.id),
            updated_by: Number(owner.id),
            created_at: now,
            updated_at: now,
          })
          .returning?.('id')
        let caseId: number | undefined =
          Array.isArray(inserted) && inserted.length > 0
            ? Number(
                typeof inserted[0] === 'object' ? (inserted[0] as { id: number }).id : inserted[0],
              )
            : undefined
        if (!caseId) {
          const last = await trx
            .from('pmo_decision_cases')
            .where('organization_id', Number(org.id))
            .orderBy('id', 'desc')
            .first()
          caseId = Number(last!.id)
        }
        caseIds.push(caseId)
        const optionRows = Array.from({ length: 5 }, (_, optionIndex) => ({
          organization_id: Number(org.id),
          case_id: caseId!,
          label: `方案${optionIndex}`,
          assumptions: '[]',
          constraints: '[]',
          affected_project_refs: '[]',
          proposed_outcome_category: 'perf',
          evidence_refs: '[]',
          revision: 1,
          active: true,
          created_at: now,
          updated_at: now,
        }))
        await trx.table('pmo_decision_options').insert(optionRows)
        await trx.table('pmo_decision_evidence_snapshots').insert({
          organization_id: Number(org.id),
          case_id: caseId!,
          snapshot_revision: 1,
          snapshot_hash: `perf${index}`.padEnd(8, '0').slice(0, 8),
          readiness: 'ready',
          payload: JSON.stringify({ sources: [] }),
          source_states: '[]',
          warning_codes: '[]',
          truncated: false,
          collected_at: now,
          created_at: now,
        })
      }
    })

    // ── 服务层基准 ──
    const { default: DecisionReviewService } =
      await import('#services/decision_workbench/decision_review_service')
    const review = await app.container.make(DecisionReviewService)

    const queueSamples: number[] = []
    const detailSamples: number[] = []
    const comparisonSamples: number[] = []
    const readinessSamples: number[] = []

    for (let round = 0; round < 20; round += 1) {
      const caseId = caseIds[round % caseIds.length]!

      let startedAt = performance.now()
      await review.listSnapshots(Number(org.id), caseId)
      detailSamples.push(performance.now() - startedAt)

      startedAt = performance.now()
      await review.compare({ user: owner, organizationId: Number(org.id), caseId })
      comparisonSamples.push(performance.now() - startedAt)

      startedAt = performance.now()
      await review.checkReadiness({ user: owner, organizationId: Number(org.id), caseId })
      readinessSamples.push(performance.now() - startedAt)

      // queue：HTTP 分页列表（真实用户路径）
      startedAt = performance.now()
      const listed = await client
        .get('/api/v1/organizations/' + org.id + '/pmo/decision-workbench/cases')
        .qs({ perPage: 20, page: (round % 5) + 1 })
        .header('Authorization', 'Bearer ' + token)
      listed.assertStatus(200)
      assert.equal(listed.body().data.length, 20)
      queueSamples.push(performance.now() - startedAt)
    }

    const thresholds = { queueP95: 1500, detailP95: 500, comparisonP95: 800, readinessP95: 600 }
    const metrics = {
      queueP50: percentile(queueSamples, 50),
      queueP95: percentile(queueSamples, 95),
      detailP95: percentile(detailSamples, 95),
      comparisonP95: percentile(comparisonSamples, 95),
      readinessP95: percentile(readinessSamples, 95),
    }
    assert.isTrue(
      metrics.queueP95 < thresholds.queueP95,
      `queue p95 ${metrics.queueP95.toFixed(0)}ms >= ${thresholds.queueP95}ms`,
    )
    assert.isTrue(
      metrics.detailP95 < thresholds.detailP95,
      `detail p95 ${metrics.detailP95.toFixed(0)}ms >= ${thresholds.detailP95}ms`,
    )
    assert.isTrue(
      metrics.comparisonP95 < thresholds.comparisonP95,
      `comparison p95 ${metrics.comparisonP95.toFixed(0)}ms >= ${thresholds.comparisonP95}ms`,
    )
    assert.isTrue(
      metrics.readinessP95 < thresholds.readinessP95,
      `readiness p95 ${metrics.readinessP95.toFixed(0)}ms >= ${thresholds.readinessP95}ms`,
    )

    // payload 上限：队列响应体不携带快照正文（有界读模型）
    const lastListed = await client
      .get('/api/v1/organizations/' + org.id + '/pmo/decision-workbench/cases')
      .qs({ perPage: 20, page: 1 })
      .header('Authorization', 'Bearer ' + token)
    assert.isFalse(
      JSON.stringify(lastListed.body()).includes('"payload"'),
      'queue response must not embed snapshot payloads',
    )
  }).timeout(240_000)
})
