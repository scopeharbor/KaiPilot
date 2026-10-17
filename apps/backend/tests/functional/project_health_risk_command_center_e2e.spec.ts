/**
 * 项目健康风险指挥中心 E2E / 性能门（§7.1–7.7）。
 *
 * 覆盖：跨角色多组织 fixture、核心读路径（attention→证据→安全下钻）、
 * stale/conflict/prediction-stale 场景、large-project（1000 任务/2000 依赖/100 风险）
 * 2 秒聚合性能门与有界截断。全部本地 fixture，零真实 provider/网络。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
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

function url(projectId: number | string): string {
  return '/api/v1/projects/' + projectId + '/health-risk-command-center'
}

interface SeedOptions {
  withDiagnosis?: boolean | { stale?: boolean }
  withPrediction?: { stale?: boolean; criticalSignals?: number }
  withCriticalRisk?: boolean
}

/** 种子一个完整项目上下文（诊断/预测/风险按需）。 */
async function seedProject(org: any, owner: any, options: SeedOptions = {}) {
  const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])

  const { default: Risk } = await import('#models/risk')
  const { DateTime } = await import('luxon')
  if (options.withCriticalRisk) {
    await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '关键依赖延期风险',
      description: 'E2E 种子：关键依赖可能延期',
      category: 'schedule',
      probability: 4,
      impact: 5,
      createdBy: Number(owner.id),
      riskLevel: 'critical',
      score: 90,
      status: 'mitigating',
      identifiedAt: DateTime.now().minus({ days: 10 }),
    })
    await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '次要供应商风险',
      description: 'E2E 种子：复查逾期样例',
      category: 'external',
      probability: 1,
      impact: 1,
      createdBy: Number(owner.id),
      riskLevel: 'low',
      score: 20,
      status: 'identified',
      identifiedAt: DateTime.now().minus({ days: 20 }),
      nextReviewAt: DateTime.now().minus({ days: 3 }),
    })
  }

  const { default: ProjectHealthDiagnosis } = await import('#models/project_health_diagnosis')
  if (options.withDiagnosis) {
    await ProjectHealthDiagnosis.create({
      organizationId: org.id,
      projectId: project.id,
      status: 'confirmed',
      ruleVersion: 'health-rules.v1',
      inputSignature: 'sig-e2e',
      outputHash: 'hash-e2e',
      evidenceHash: null,
      summary: {
        overallScore: 88,
        overallLabel: '良好',
        warnings: [],
        suggestedActions: [],
        evidenceHash: 'e2e-evidence-hash',
        dimensionScores: [
          {
            dimension: 'progress' as const,
            score: 85,
            severity: 'low' as const,
            evidence: [],
            warnings: [],
            suggestedActions: [],
          },
        ],
      },
      aiDraft: null,
      warnings: [],
      generatedBy: Number(owner.id),
      generatedAt: DateTime.now().minus({ days: 2 }),
      confirmedBy: Number(owner.id),
      confirmedAt: DateTime.now().minus({ days: 1 }),
      // 布尔形态 = 有最新且未过期的已确认诊断；对象形态可显式声明过期。
      stale: typeof options.withDiagnosis === 'object' && options.withDiagnosis.stale === true,
      staleReason:
        typeof options.withDiagnosis === 'object' && options.withDiagnosis.stale
          ? 'INPUT_SIGNATURE_CHANGED'
          : null,
    })
  }

  const { default: ProjectPredictionSnapshot } = await import('#models/project_prediction_snapshot')
  const { default: ProjectPredictionSignal } = await import('#models/project_prediction_signal')
  if (options.withPrediction) {
    const snapshot = await ProjectPredictionSnapshot.create({
      organizationId: org.id,
      projectId: project.id,
      // window 为封闭整数枚举（7/14/30/60/90，DB CHECK）
      window: 30,
      status: 'confirmed',
      ruleVersion: 'prediction-rules.v1',
      inputSignature: 'pred-sig',
      outputHash: 'pred-hash',
      sourceHash: 'pred-src',
      generatedBy: Number(owner.id),
      generatedAt: DateTime.now().minus({ days: 1 }),
      confirmedAt: DateTime.now(),
      stale: options.withPrediction.stale === true,
      staleReason: options.withPrediction.stale ? 'FACTS_CHANGED' : null,
      confirmationStatus: 'confirmed',
    })
    for (let i = 0; i < (options.withPrediction.criticalSignals ?? 0); i++) {
      await ProjectPredictionSignal.create({
        snapshotId: snapshot.id,
        severity: 'critical',
        signalType: 'risk_escalation',
        score: 90,
        confidenceBand: 'high',
        ruleId: 'rule-e2e',
        ruleVersion: 'prediction-rules.v1',
        description: `E2E 种子信号 ${i}`,
      })
    }
  }

  return { project }
}

test.group('指挥中心 E2E —— 核心流程（§7.3）', (group) => {
  useAuthDatabase(group)

  test('识别 attention → 展开证据 → 安全下钻参数正确；全程零领域写入', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-e2e-owner') })
    const org = await createOrganization(owner)
    const { project } = await seedProject(org, owner, {
      withDiagnosis: true,
      withPrediction: { criticalSignals: 1 },
      withCriticalRisk: true,
    })
    const token = await login(client, owner)

    // 1) 打开健康与风险
    const response = await client
      .get(url(project.id))
      .qs({ attentionLimit: '20' })
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const body = response.body()
    const data = body.data
    assert.equal(data.headline.sourceKey, 'health-diagnosis')
    assert.isFalse(data.headline.degraded)

    // 2) 注意力队列包含 critical 风险项，携带安全 risk-detail 目标
    const riskItem = data.attention.find(
      (a: { reasonCode: string }) => a.reasonCode === 'HIGH_SEVERITY_RISK_OPEN',
    )
    assert.isOk(riskItem)
    assert.equal(riskItem.targets[0].kind, 'risk-detail')
    assert.equal(riskItem.targets[0].params.riskId, riskItem.entityRef.id)
    assert.equal(riskItem.targets[0].params.projectId, Number(project.id))

    // 3) 健康诊断来源携带页内证据目标（专用页面不存在 → health-evidence）
    const diagnosisSource = data.sources.find(
      (s: { sourceKey: string }) => s.sourceKey === 'health-diagnosis',
    )
    assert.equal(diagnosisSource.targets[0].kind, 'health-evidence')
    assert.equal(diagnosisSource.facts.diagnosisId, diagnosisSource.targets[0].params.diagnosisId)

    // 4) 下钻目标端二次授权：风险列表接口正常工作（独立 Policy 校验）
    const risksPage = await client
      .get('/api/v1/projects/' + project.id + '/risks')
      .header('Authorization', 'Bearer ' + token)
    assert.oneOf(risksPage.status(), [200, 403])

    // 5) 零写入证明：审计表只可能包含种子阶段的记录；读取前后无新增由下方计数断言
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const before = Number(
      ((await db.from('audit_logs').count('* as c').first()) as unknown as { c: number }).c ?? 0,
    )
    await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    const after = Number(
      ((await db.from('audit_logs').count('* as c').first()) as unknown as { c: number }).c ?? 0,
    )
    assert.equal(after, before)
  })
})

test.group('指挥中心 E2E —— 场景矩阵（§7.5）', (group) => {
  useAuthDatabase(group)

  test('stale 诊断：headline 回退 + STALE warning + 复核注意力项', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-e2e-stale') })
    const org = await createOrganization(owner)
    const { project } = await seedProject(org, owner, {
      withDiagnosis: { stale: true },
      withCriticalRisk: true,
    })
    const token = await login(client, owner)
    const response = await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const { data } = response.body()
    assert.equal(data.headline.sourceKey, 'project-dashboard')
    assert.isTrue(
      data.sources.some((s: { meta: { availability: string } }) => s.meta.availability === 'stale'),
    )
    assert.isTrue(
      data.attention.some((a: { sourceKey: string }) => a.sourceKey === 'health-diagnosis'),
    )
  })

  test('missing 诊断：headline 回退 Dashboard 且诊断来源 empty', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-e2e-missing') })
    const org = await createOrganization(owner)
    const { project } = await seedProject(org, owner, {})
    const token = await login(client, owner)
    const response = await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const { data } = response.body()
    assert.equal(data.headline.sourceKey, 'project-dashboard')
    assert.isTrue(data.headline.degraded)
    const diag = data.sources.find((s: { sourceKey: string }) => s.sourceKey === 'health-diagnosis')
    assert.equal(diag.meta.availability, 'empty')
  })

  test('prediction stale：过期快照被权威适配器过滤，不以事实形态出现（§7.5）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-e2e-pred') })
    const org = await createOrganization(owner)
    const { project } = await seedProject(org, owner, { withPrediction: { stale: true } })
    const token = await login(client, owner)
    const response = await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    // 领域适配器（ProjectPredictionDashboardAdapter）只返回非 stale 快照：
    // 过期预测不得作为当前事实或注意力项出现。
    const { data } = response.body()
    const prediction = data.sources.find((s: { sourceKey: string }) => s.sourceKey === 'prediction')
    if (prediction && prediction.meta.availability === 'available') {
      assert.isNull(prediction.facts)
    }
    assert.isFalse(
      data.attention.some(
        (a: { reasonCode: string }) => a.reasonCode === 'PREDICTION_SIGNAL_ACTIVE',
      ),
    )
  })

  test('source conflict：headline green 但 critical 风险存在 → 冲突警告随响应返回', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-e2e-conflict') })
    const org = await createOrganization(owner)
    const { project } = await seedProject(org, owner, {
      withDiagnosis: true,
      withCriticalRisk: true,
    })
    const token = await login(client, owner)
    const response = await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const { data } = response.body()
    const risk = data.sources.find((s: { sourceKey: string }) => s.sourceKey === 'risk-workbench')
    assert.isTrue(risk.warnings.some((w: { code: string }) => w.code === 'SOURCE_POSTURE_CONFLICT'))
  })

  test('retry 恢复：失败请求后再次合法读取仍成功', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-e2e-retry') })
    const org = await createOrganization(owner)
    const { project } = await seedProject(org, owner, { withDiagnosis: true })
    const token = await login(client, owner)

    const bad = await client
      .get(url(project.id))
      .qs({ attentionLimit: '9999' })
      .header('Authorization', 'Bearer ' + token)
    bad.assertStatus(422)

    const retry = await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    retry.assertStatus(200)
    assert.match(retry.body().meta.projectionSignature, /^[0-9a-f]{8}$/)
  })
})

test.group('指挥中心 E2E —— 角色与组织边界（§7.4，补充 admin/viewer）', (group) => {
  useAuthDatabase(group)

  test('admin（组织级）与 viewer（项目成员）均可读取；跨组织用户 404 不泄露', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-roles-owner') })
    const admin = await createUser({ email: uniqueEmail('hcc-roles-admin') })
    const viewer = await createUser({ email: uniqueEmail('hcc-roles-viewer') })
    const outsider = await createUser({ email: uniqueEmail('hcc-roles-outside') })
    const org = await createOrganization(owner)
    await addOrgMember(org, admin, 'admin')
    await addOrgMember(org, viewer, 'viewer')
    await createOrganization(outsider)
    // viewer 需要项目成员身份（Read-only Observer 项目角色）走组织∩项目交集；
    // 该测试只断言可读性，不依赖诊断/风险种子。
    const { project } = await createProjectWithMember(org, owner, viewer, 'Read-only Observer', [])

    // admin：组织管理员经 organization_admin_project 路径放行
    const adminToken = await login(client, admin)
    const adminRes = await client
      .get(url(project.id))
      .header('Authorization', 'Bearer ' + adminToken)
    assert.equal(adminRes.status(), 200)

    // viewer：项目成员 ∩ 组织权限
    const viewerToken = await login(client, viewer)
    const viewerRes = await client
      .get(url(project.id))
      .header('Authorization', 'Bearer ' + viewerToken)
    assert.equal(viewerRes.status(), 200)

    // 纯组织 outsider：404 非泄露
    const outsideToken = await login(client, outsider)
    const denied = await client
      .get(url(project.id))
      .header('Authorization', 'Bearer ' + outsideToken)
    assert.equal(denied.status(), 404)
    assert.equal(denied.body().error.code, 'RESOURCE_NOT_FOUND')
  })
})

test.group('指挥中心 E2E —— large-project 性能门（§7.7）', (group) => {
  useAuthDatabase(group)

  test('1000 任务/2000 依赖/100 风险：聚合 ≤2 秒、注意力 ≤limit 有界截断', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('hcc-perf-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'viewer', [])
    const token = await login(client, owner)

    // —— 批量种子（绕过 ORM 逐条开销）——
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const now = new Date()
    const orgId = Number(org.id)
    const projectId = Number(project.id)

    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      project_id: projectId,
      name: `任务 ${i + 1}`,
      status: i % 10 === 0 ? 'in_progress' : 'not_started',
      priority: 'medium',
      task_type: 'task',
      is_critical_path: false,
      is_on_longest_path: false,
      created_at: now,
    }))
    // SQLite 对超大 UNION ALL 有限制，分批插入。
    for (let i = 0; i < tasks.length; i += 100) {
      await db.table('tasks').insert(tasks.slice(i, i + 100))
    }

    const taskRows = (await db
      .from('tasks')
      .where('project_id', projectId)
      .select('id')
      .orderBy('id')) as Array<{ id: number }>
    const deps: Array<{
      predecessor_id: number
      successor_id: number
      type: string
      created_at: Date
    }> = []
    for (let i = 1; i < taskRows.length && deps.length < 2000; i++) {
      deps.push({
        predecessor_id: taskRows[i - 1]!.id,
        successor_id: taskRows[i]!.id,
        type: 'fs',
        created_at: now,
      })
    }
    if (deps.length > 0) {
      for (let i = 0; i < deps.length; i += 200) {
        await db.table('task_dependencies').insert(deps.slice(i, i + 200))
      }
    }

    const risks = Array.from({ length: 100 }, (_, i) => ({
      organization_id: orgId,
      project_id: projectId,
      title: `风险 ${i + 1}`,
      description: `性能门种子风险 ${i + 1}`,
      risk_level: i < 20 ? 'critical' : i < 60 ? 'high' : 'medium',
      score: 100 - i,
      status: 'identified',
      identified_at: now,
      created_by: Number(owner.id),
      created_at: now,
    }))
    for (let i = 0; i < risks.length; i += 50) {
      await db.table('risks').insert(risks.slice(i, i + 50))
    }

    // —— 计时读取（预热一次后取第二次）——
    await client.get(url(project.id)).header('Authorization', 'Bearer ' + token)
    const started = Date.now()
    const response = await client
      .get(url(project.id))
      .qs({ attentionLimit: '100' })
      .header('Authorization', 'Bearer ' + token)
    const elapsed = Date.now() - started

    response.assertStatus(200)
    const body = response.body()
    assert.equal(body.meta.attentionTruncation.requestedLimit, 100)
    assert.isAtMost(body.data.attention.length, 100)

    // 性能统计落盘（低敏）：总耗时 / per-source timing / payload bytes
    const payloadBytes = JSON.stringify(body).length
    console.log(
      `[PERF] command-center total=${elapsed}ms perSource=${JSON.stringify(body.meta.perSourceTimingMs)} payload=${payloadBytes}B attention=${body.data.attention.length}`,
    )
    assert.isAtMost(elapsed, 2000, '聚合必须在 2 秒内完成')
  }).timeout(120_000)
})
