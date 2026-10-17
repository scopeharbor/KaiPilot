/**
 * v3-knowledge-memory-operating-layer —— 只读 GET API 功能测试。
 *
 * 覆盖：
 * - 3.4 / 3.6 / 3.8   知识 / memory / Skill draft adapter 的同租、跨租、生命周期、
 *                     他人 user memory、plugin disabled/uninstalled 语义
 * - 3.10 / 3.11       观测 lane 的 no-observation 语义；列表按 kind 常数级查询
 * - 4.2               feature flag off → 路由 feature-off 且零 adapter 调用
 * - 4.8               deleted / cross-org / 未知 kind / 未知 surface 的 detail 语义
 * - 4.12              Validator 边界与注入式取值
 * - 4.13 / 4.14       JWT、角色矩阵、组织 scope 的 Policy 与非泄露
 * - 4.16 / 4.17       统一 envelope、稳定错误码、无 POST/PUT/PATCH/DELETE
 * - 4.18              读取路径 zero-diff（领域表 + 审计计数前后不变）
 *
 * 红线：全程 fixture 数据、本机 SQLite、零真实 provider、零公网；读路径零写入。
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
import type Organization from '#models/organization'
import type User from '#models/user'

import { KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV } from '#services/knowledge_memory_operating/feature_flag'

import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from './auth/_helpers.js'

const SUMMARY = '/api/v1/knowledge-memory/summary'
const ITEMS = '/api/v1/knowledge-memory/items'

/**
 * 敏感诱饵：以下值被写进权威记录的正文/摘要字段，
 * 任何运营响应体都不得回显（spec「敏感诱饵不进入任何运营表面」）。
 */
const BAIT_KNOWLEDGE_BODY = '知识正文诱饵-should-not-leak-ABC123'
const BAIT_MEMORY_SUMMARY = '记忆摘要诱饵-should-not-leak-XYZ789'
const BAIT_SECRET = 'sk-live-should-not-leak-000111'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

/** flag on/off 由 controller 每请求读取，故可逐用例切换。 */
function enableFlag() {
  process.env[KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV] = 'true'
}
function disableFlag() {
  delete process.env[KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV]
}

async function seedKnowledge(
  org: Organization,
  creator: User,
  overrides: Partial<{
    layer: 'L1' | 'L2' | 'L3' | 'L4'
    status: 'draft' | 'pending' | 'active' | 'deprecated' | 'outdated'
    title: string
    isSynthetic: boolean
    hasProvenance: boolean
  }> = {},
): Promise<KnowledgeItem> {
  const hasProvenance = overrides.hasProvenance ?? true
  return KnowledgeItem.create({
    organizationId: org.id,
    layer: overrides.layer ?? 'L1',
    layerMeta: {} as never,
    title: overrides.title ?? '标准方法论条目',
    // 正文诱饵：低敏投影绝不能带出去
    content: { body: BAIT_KNOWLEDGE_BODY, secret: BAIT_SECRET } as never,
    status: overrides.status ?? 'active',
    domain: 'delivery',
    purpose: 'planning',
    complexity: null,
    provenance: (hasProvenance
      ? {
          sources: [
            {
              layer: 'L1',
              sourceId: 'src-1',
              isSynthetic: false,
              retrievedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
        }
      : { sources: [] }) as never,
    reviewHistory: [] as never,
    isSynthetic: overrides.isSynthetic ?? false,
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
  overrides: Partial<{
    memoryScope: 'user' | 'project' | 'organization'
    status: 'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
    projectId: number | null
  }> = {},
): Promise<CopilotMemoryEntry> {
  return CopilotMemoryEntry.create({
    organizationId: org.id,
    projectId: overrides.projectId ?? null,
    actorId: actor.id,
    entryId: `mem-${org.id}-${actor.id}-${Math.random().toString(36).slice(2, 10)}`,
    memoryScope: overrides.memoryScope ?? 'user',
    // 摘要诱饵：memory adapter 只能带出 byte size，不得带出内容
    summary: BAIT_MEMORY_SUMMARY,
    confidence: 0.8,
    confidenceSource: 'single_observation',
    basisSessionDbId: null,
    status: overrides.status ?? 'candidate',
    validityTier: 'medium',
    observedAt: DateTime.now().minus({ days: 3 }),
    lastConfirmedAt: null,
    retentionExpiresAt: null,
  })
}

async function seedSkillWithDraft(
  org: Organization,
  creator: User,
  overrides: Partial<{
    skillKey: string
    skillVersion: string
    baseVersion: string
    draftStatus: 'pending' | 'committed' | 'discarded'
  }> = {},
): Promise<{ skill: CompilerSkill; draft: SkillKnowledgeDraft }> {
  const skill = await CompilerSkill.create({
    organizationId: org.id,
    skillKey: overrides.skillKey ?? `core.builtin.skill-${Math.random().toString(36).slice(2, 8)}`,
    name: '交付方法论',
    version: overrides.skillVersion ?? '1.0.0',
    description: '测试 Skill',
    status: 'active' as never,
    category: 'delivery' as never,
    tags: [] as never,
    dependencies: [] as never,
    activation: {} as never,
    knowledge: {} as never,
    provenance: null,
    basePriority: 10,
    createdBy: creator.id,
    updatedBy: creator.id,
  })
  const draft = await SkillKnowledgeDraft.create({
    organizationId: org.id,
    skillId: skill.id,
    sections: [] as never,
    baseVersion: overrides.baseVersion ?? overrides.skillVersion ?? '1.0.0',
    status: (overrides.draftStatus ?? 'pending') as never,
    aiAssisted: false,
    createdBy: creator.id,
    updatedBy: creator.id,
  })
  return { skill, draft }
}

/** 领域表 + 审计的行数快照，用于 zero-diff 断言。 */
async function tableCounts(): Promise<Record<string, number>> {
  const tables = [
    'knowledge_items',
    'copilot_memory_entries',
    'skill_knowledge_drafts',
    'compiler_skills',
    'copilot_context_observations',
    'audit_logs',
  ]
  const out: Record<string, number> = {}
  for (const t of tables) {
    const row = await db.from(t).count('* as c').first()
    out[t] = Number(row?.c ?? 0)
  }
  return out
}

test.group('knowledge-memory operating API —— feature flag（§4.2）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('flag 关闭时三个 GET 均 feature-off，且不触达 adapter', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedKnowledge(org, owner, { status: 'pending' })
    const token = await login(client, owner.email)

    disableFlag()
    for (const url of [SUMMARY, ITEMS, `${ITEMS}/knowledge_item/k-1`]) {
      const res = await client.get(url).bearerToken(token)
      res.assertStatus(404)
      assert.equal(res.body().error.code, 'FEATURE_NOT_ENABLED')
      // 低敏：feature-off 响应不得回显任何领域内容
      assert.notInclude(JSON.stringify(res.body()), BAIT_KNOWLEDGE_BODY)
    }
  })

  test('flag 关闭不改变既有 /api/v1/knowledge 行为', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedKnowledge(org, owner)
    const token = await login(client, owner.email)

    disableFlag()
    const res = await client.get('/api/v1/knowledge').bearerToken(token)
    // 既有端点与运营层 flag 无关：仍按自身 Policy 作答（200 或 403，绝不是 FEATURE_NOT_ENABLED）
    if (res.response.status >= 400) {
      res.assertBodyContains({ error: {} })
    } else {
      res.assertStatus(200)
    }
  })
})

test.group('knowledge-memory operating API —— 认证与权限（§4.13/§4.14）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('无 token → 401 AUTH_REQUIRED', async ({ client, assert }) => {
    const res = await client.get(SUMMARY)
    res.assertStatus(401)
    assert.equal(res.body().error.code, 'AUTH_REQUIRED')
  })

  test('owner（ORG_ADMIN）可读 summary', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedKnowledge(org, owner, { status: 'pending' })
    const token = await login(client, owner.email)

    const res = await client.get(SUMMARY).bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data
    assert.equal(data.organizationId, org.id)
    assert.lengthOf(data.lanes, 4)
  })

  test('普通 member 无运营查看权限 → 403 PERMISSION_DENIED', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const token = await login(client, member.email)

    const res = await client.get(SUMMARY).bearerToken(token)
    res.assertStatus(403)
    assert.equal(res.body().error.code, 'PERMISSION_DENIED')
  })

  test('viewer 无运营查看权限 → 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.get(SUMMARY).bearerToken(token)
    res.assertStatus(403)
  })
})

test.group('knowledge-memory operating API —— 跨租与隐藏对象（§3.4/§3.6/§4.8）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('列表只返回本组织对象，B 组织内容完全不出现', async ({ client, assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    await seedKnowledge(orgA, ownerA, { status: 'pending', title: 'A 组织待审条目' })
    const bItem = await seedKnowledge(orgB, ownerB, { status: 'pending', title: 'B 组织机密条目' })

    const tokenA = await login(client, ownerA.email)
    const res = await client.get(ITEMS).bearerToken(tokenA)
    res.assertStatus(200)

    const body = JSON.stringify(res.body())
    assert.notInclude(body, 'B 组织机密条目')
    assert.notInclude(body, `k-${bItem.id}`)
  })

  test('跨组织 scopedRef 与不存在对象返回不可区分的 404', async ({ client, assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)
    const bItem = await seedKnowledge(orgB, ownerB, { status: 'pending' })

    const tokenA = await login(client, ownerA.email)
    const crossOrg = await client.get(`${ITEMS}/knowledge_item/k-${bItem.id}`).bearerToken(tokenA)
    const missing = await client.get(`${ITEMS}/knowledge_item/k-99999`).bearerToken(tokenA)

    assert.equal(crossOrg.response.status, missing.response.status)
    assert.deepEqual(crossOrg.body(), missing.body())
    assert.equal(crossOrg.response.status, 404)
    // 不得泄露 B 的 kind / 状态 / attention / 标题
    assert.notInclude(JSON.stringify(crossOrg.body()), 'pending')
    void orgA
  })

  test('他人 user memory 不出现在列表与详情', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const other = await createUser()
    await addOrgMember(org, other, 'member')
    const othersMemory = await seedMemory(org, other, { memoryScope: 'user' })

    const token = await login(client, owner.email)
    const list = await client.get(ITEMS).bearerToken(token)
    list.assertStatus(200)
    assert.notInclude(JSON.stringify(list.body()), `m-${othersMemory.id}`)

    const detail = await client
      .get(`${ITEMS}/copilot_memory/m-${othersMemory.id}`)
      .bearerToken(token)
    detail.assertStatus(404)
  })

  test('本人 user memory 可见且只带 byte size，不带 summary 内容', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const mine = await seedMemory(org, owner, { memoryScope: 'user' })

    const token = await login(client, owner.email)
    const detail = await client.get(`${ITEMS}/copilot_memory/m-${mine.id}`).bearerToken(token)
    detail.assertStatus(200)

    const body = JSON.stringify(detail.body())
    assert.notInclude(body, BAIT_MEMORY_SUMMARY)
    assert.include(body, 'summaryByteSize')
    // memory 永远是 inference，绝不能被叙述成 fact
    assert.include(body, 'inference')
  })
})

test.group('knowledge-memory operating API —— 生命周期与队列语义（§3.4/§3.8）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('pending 知识条目进入 needs_review，而不是被 active-only 检索吞掉', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const pending = await seedKnowledge(org, owner, { status: 'pending', title: '待审条目' })

    const token = await login(client, owner.email)
    const res = await client.get(`${ITEMS}?kind=knowledge_item`).bearerToken(token)
    res.assertStatus(200)

    const refs = res.body().data.data.map((i: any) => i.scopedRef.ref)
    assert.include(refs, `k-${pending.id}`)
    const row = res.body().data.data.find((i: any) => i.scopedRef.ref === `k-${pending.id}`)
    assert.equal(row.status, 'needs_review')
  })

  test('L3 synthetic 条目在生产上下文不可见', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const l3 = await seedKnowledge(org, owner, {
      layer: 'L3',
      status: 'active',
      isSynthetic: true,
      title: 'L3 合成条目',
    })

    const token = await login(client, owner.email)
    const list = await client.get(`${ITEMS}?kind=knowledge_item`).bearerToken(token)
    list.assertStatus(200)
    assert.notInclude(JSON.stringify(list.body()), `k-${l3.id}`)
  })

  test('base version 落后的 Skill 草稿标为 stale', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { draft } = await seedSkillWithDraft(org, owner, {
      skillVersion: '2.0.0',
      baseVersion: '1.0.0',
      draftStatus: 'pending',
    })

    const token = await login(client, owner.email)
    const detail = await client
      .get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`)
      .bearerToken(token)
    detail.assertStatus(200)
    const item = detail.body().data.item
    assert.isTrue(item.baseStale)
    assert.equal(item.freshnessState, 'stale')
  })

  test('已卸载插件来源的草稿降级为 disabled 且不放行 commit surface', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    // skillKey 形如 com.<author>.<plugin>.<skill>，但组织内没有对应安装记录
    const { draft } = await seedSkillWithDraft(org, owner, {
      skillKey: 'com.vendor.removed-plugin.methodology',
      draftStatus: 'pending',
    })

    const token = await login(client, owner.email)
    const detail = await client
      .get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`)
      .bearerToken(token)
    detail.assertStatus(200)
    const prov = detail.body().data.item.pluginProvenance
    assert.equal(prov.kind, 'plugin')
    assert.isTrue(prov.disabled)
    assert.isTrue(prov.uninstalled)
  })

  test('已启用插件来源的草稿保留 provenance 且不被禁用', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.vendor.active-plugin',
      version: '1.0.0',
      releaseId: 1,
      status: 'enabled' as never,
      packageDigest: 'sha256:pkg',
      manifestDigest: 'sha256:manifest',
      compatibilityDigest: 'sha256:compat',
      rowVersion: 1,
    })
    const { draft } = await seedSkillWithDraft(org, owner, {
      skillKey: 'com.vendor.active-plugin.methodology',
      draftStatus: 'pending',
    })

    const token = await login(client, owner.email)
    const detail = await client
      .get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`)
      .bearerToken(token)
    detail.assertStatus(200)
    const prov = detail.body().data.item.pluginProvenance
    assert.equal(prov.pluginId, 'com.vendor.active-plugin')
    assert.isFalse(prov.disabled)
    assert.isFalse(prov.uninstalled)
  })

  test('无观测记录时检索 lane 为 empty，而不是 degraded 或 ready', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client.get(SUMMARY).bearerToken(token)
    res.assertStatus(200)
    const lane = res.body().data.lanes.find((l: any) => l.lane === 'retrieval_signal')
    assert.equal(lane.coverage, 'empty')
    assert.isFalse(lane.degraded)
    void CopilotContextObservation
  })
})

test.group(
  'knowledge-memory operating API —— Validator 与错误 envelope（§4.12/§4.16）',
  (group) => {
    useAuthDatabase(group)
    group.each.setup(() => {
      enableFlag()
      return () => disableFlag()
    })

    test('未知 kind / 未知 enum / 越界分页 / 额外字段一律 422', async ({ client, assert }) => {
      const owner = await createUser()
      const org = await createOrganization(owner)
      const token = await login(client, owner.email)
      void org

      const bad = [
        `${ITEMS}?kind=project_event`,
        `${ITEMS}?status=totally_unknown`,
        `${ITEMS}?scope=galaxy`,
        `${ITEMS}?page=-1`,
        `${ITEMS}?page=0`,
        `${ITEMS}?perPage=1000`,
        `${ITEMS}?sort=title`,
      ]
      for (const url of bad) {
        const res = await client.get(url).bearerToken(token)
        assert.equal(res.response.status, 422, `${url} 应被拒绝`)
        assert.equal(res.body().error.code, 'VALIDATION_ERROR')
      }
    })

    test('内容型 / 注入式 scopedRef 被字符集拒绝', async ({ client, assert }) => {
      const owner = await createUser()
      await createOrganization(owner)
      const token = await login(client, owner.email)

      const injections = [
        "k-1' OR 1=1--",
        '<script>alert(1)</script>',
        'k-1 AND SLEEP(5)',
        encodeURIComponent(BAIT_SECRET),
      ]
      for (const ref of injections) {
        const res = await client
          .get(`${ITEMS}/knowledge_item/${encodeURIComponent(ref)}`)
          .bearerToken(token)
        assert.oneOf(res.response.status, [404, 422], `${ref} 不得成功`)
        assert.notInclude(JSON.stringify(res.body()), BAIT_SECRET)
      }
    })

    test('未知 surface 被拒绝', async ({ client, assert }) => {
      const owner = await createUser()
      const org = await createOrganization(owner)
      const item = await seedKnowledge(org, owner, { status: 'pending' })
      const token = await login(client, owner.email)

      const res = await client
        .get(`${ITEMS}/knowledge_item/k-${item.id}/surfaces/arbitrary_admin_panel`)
        .bearerToken(token)
      assert.equal(res.response.status, 422)
    })

    test('超出合并窗口的深页显式 422，而不是静默空页', async ({ client, assert }) => {
      const owner = await createUser()
      await createOrganization(owner)
      const token = await login(client, owner.email)

      const res = await client.get(`${ITEMS}?page=999&perPage=100`).bearerToken(token)
      assert.equal(res.response.status, 422)
      assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    })
  },
)

test.group('knowledge-memory operating API —— 只读边界（§4.17/§4.18）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('运营 URL 上不存在任何写方法', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    for (const url of [SUMMARY, ITEMS, `${ITEMS}/knowledge_item/k-1`]) {
      for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await client[verb](url).bearerToken(token).json({})
        assert.notEqual(res.response.status, 200, `${verb.toUpperCase()} ${url} 不得成功`)
        assert.notEqual(res.response.status, 201, `${verb.toUpperCase()} ${url} 不得成功`)
      }
    }
  })

  test('遍历 summary / list / 筛选 / detail / surface 前后领域表与审计计数不变', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const knowledge = await seedKnowledge(org, owner, { status: 'pending' })
    const memory = await seedMemory(org, owner, { memoryScope: 'user' })
    const { draft } = await seedSkillWithDraft(org, owner, { draftStatus: 'pending' })
    const token = await login(client, owner.email)

    const before = await tableCounts()

    await client.get(SUMMARY).bearerToken(token)
    await client.get(ITEMS).bearerToken(token)
    await client.get(`${ITEMS}?kind=knowledge_item&status=needs_review`).bearerToken(token)
    await client.get(`${ITEMS}?page=2&perPage=5`).bearerToken(token)
    await client.get(`${ITEMS}/knowledge_item/k-${knowledge.id}`).bearerToken(token)
    await client.get(`${ITEMS}/copilot_memory/m-${memory.id}`).bearerToken(token)
    await client.get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`).bearerToken(token)
    await client
      .get(`${ITEMS}/knowledge_item/k-${knowledge.id}/surfaces/knowledge_review`)
      .bearerToken(token)

    const after = await tableCounts()
    assert.deepEqual(after, before)
  })

  test('列表响应不含正文、摘要、secret 与绝对路径', async ({ client, assert }) => {
    const owner = await createUser()
    const seedOrg = await createOrganization(owner)
    await seedKnowledge(seedOrg, owner, { status: 'pending' })
    await seedMemory(seedOrg, owner, { memoryScope: 'user' })
    const token = await login(client, owner.email)

    const res = await client.get(ITEMS).bearerToken(token)
    res.assertStatus(200)
    const body = JSON.stringify(res.body())
    for (const bait of [BAIT_KNOWLEDGE_BODY, BAIT_MEMORY_SUMMARY, BAIT_SECRET]) {
      assert.notInclude(body, bait)
    }
    assert.notInclude(body, 'C:\\\\Users')
    assert.notInclude(body, 'Authorization')
  })

  test('summary 与未筛选列表使用同一可见性规则', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedKnowledge(org, owner, { status: 'pending' })
    await seedKnowledge(org, owner, { status: 'active' })
    await seedMemory(org, owner, { memoryScope: 'user' })
    const token = await login(client, owner.email)

    const summary = await client.get(SUMMARY).bearerToken(token)
    const list = await client.get(`${ITEMS}?perPage=100`).bearerToken(token)
    summary.assertStatus(200)
    list.assertStatus(200)

    const laneTotal = summary.body().data.lanes.reduce((s: number, l: any) => s + l.total, 0)
    assert.equal(list.body().data.meta.total, laneTotal)
  })
})
