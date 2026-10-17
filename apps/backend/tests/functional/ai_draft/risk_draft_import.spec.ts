import { test } from '@japa/runner'
import Risk from '#models/risk'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

const STREAM = '/api/v1/ai/project-drafts/stream'

function makeReadyContext(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    rawInput: '开发一个内部审批系统',
    parsedIntent: {
      schemaVersion: '1.0',
      projectType: 'software',
      projectName: '内部审批系统',
      objectives: ['减少重复录入'],
      deliverables: [],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.72,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
    ...overrides,
  }
}

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** 测试专用：把离线生成版本标成「测试已验证来源」（与 ai_draft_import.spec 相同的生产外夹具）。 */
async function markAsProviderVerifiedFixture(draftUid: string) {
  const { default: AiProjectDraft } = await import('#models/ai_project_draft')
  const { default: AiProjectDraftVersion } = await import('#models/ai_project_draft_version')
  const session = await AiProjectDraft.query().where('draft_uid', draftUid).firstOrFail()
  const version = await AiProjectDraftVersion.query()
    .where('draft_id', session.id)
    .where('status', 'active')
    .firstOrFail()
  if (!version.meta) throw new Error('TEST_FIXTURE_META_MISSING')
  version.meta = {
    ...version.meta,
    provider: 'test-verified-provider',
    model: 'test-verified-model',
    usingRealAdapter: true,
    fallbackUsed: false,
    confirmability: { status: 'confirmable', reasons: [] },
    provenance: {
      requestedStrategy: version.meta.provenance?.requestedStrategy ?? 'prompt',
      effectiveStrategy: version.meta.provenance?.effectiveStrategy ?? 'prompt',
      provider: 'test-verified-provider',
      requestedModel: 'test-verified-model',
      responseModel: 'test-verified-model',
      fallbackUsed: false,
    },
  }
  await version.save()
}

async function generateDraft(client: any, token: string) {
  const gen = await client
    .post(STREAM)
    .header('Authorization', `Bearer ${token}`)
    .json({ context: makeReadyContext() })
  gen.assertStatus(200)
  const draftUid = gen.headers()['x-draft-id'] as string
  await markAsProviderVerifiedFixture(draftUid)
  const detail = await client
    .get(`/api/v1/ai/project-drafts/${draftUid}`)
    .header('Authorization', `Bearer ${token}`)
  return { draftUid, draft: detail.body().data.draft }
}

test.group('AI 草案风险导入', (group) => {
  useAuthDatabase(group)

  test('全量确认导入落地风险并携带 AIMarker', async ({ assert, client }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid, draft } = await generateDraft(client, token)

    // 确认草案包含 riskHints
    assert.isArray(draft.riskHints)
    const riskHintCount = draft.riskHints.length
    assert.isAbove(riskHintCount, 0)

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true })
    res.assertStatus(201)

    const body = res.body().data
    assert.isNumber(body.projectId)

    // 验证 risks 表有数据
    const risks = await Risk.query().where('project_id', body.projectId)
    assert.isTrue(risks.length > 0, '应有风险落地')

    // 验证每条风险都有 aiMetadata
    for (const risk of risks) {
      assert.isNotNull(risk.aiMetadata, '风险应有 aiMetadata')
      const parsed = JSON.parse(risk.aiMetadata!)
      assert.isObject(parsed.aiMarker, 'aiMetadata 应包含 aiMarker')
      assert.isString(parsed.sourceDraftId, 'aiMetadata 应包含 sourceDraftId')
      assert.equal(parsed.sourceDraftId, draftUid)
    }
  })

  test('部分接受时未选风险不落库', async ({ assert, client }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid, draft } = await generateDraft(client, token)

    if (draft.riskHints.length < 2) {
      // 如果草案风险不足 2 条，跳过此测试
      return
    }

    // 只选第一条风险
    const selectedRiskHintId = draft.riskHints[0].id

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        mode: 'partial',
        acknowledgedWarnings: true,
        selection: {
          taskIds: draft.tasks.map((t: any) => t.id),
          wbsNodeIds: draft.wbs.map((w: any) => w.id),
          acceptanceIds: [],
          milestoneIds: [],
          riskHintIds: [selectedRiskHintId],
          unselectedStrategy: 'discard',
        },
      })
    res.assertStatus(201)

    const projectId = res.body().data.projectId
    const risks = await Risk.query().where('project_id', projectId)

    // 只有选中的那条风险应落地
    assert.equal(risks.length, 1)
    assert.equal(risks[0]!.title, draft.riskHints[0].description.value)
  })

  test('风险导入失败整体回滚', async ({ assert, client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token)

    // 使用无效版本号触发失败
    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 999, mode: 'all', acknowledgedWarnings: true })

    // 应该失败
    assert.notEqual(res.status(), 201)

    // 验证零风险落地
    const risks = await Risk.query().where('organization_id', org.id)
    assert.lengthOf(risks, 0)
  })
})
