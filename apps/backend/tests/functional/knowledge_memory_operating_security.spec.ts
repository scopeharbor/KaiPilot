/**
 * v3-knowledge-memory-operating-layer —— Plugin-first、安全与低敏门禁（§7）
 *
 * 覆盖：
 * - 7.1 / 7.2  只经既有 manifest/install/adapter/provenance 显示插件内容；
 *              disabled/uninstalled 停止供新内容、历史 provenance 仍可读、核心对象不删
 * - 7.3        插件不得贡献任意 component/script/HTML/SQL/URL/prompt/provider/权限/写 handler
 * - 7.4        operating core 不依赖通用 UI slot、plugin runtime、W3b/W3c 候选
 * - 7.5        summary / list / detail / deep-link 四面跨租不泄露
 * - 7.6        DTO / error / 日志 的敏感诱饵扫描
 * - 7.7        网络与副作用 spy：全部读路径零 provider / fetch / webhook / 外部写
 *
 * 红线：fixture only、本机 SQLite、零公网。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { fileURLToPath } from 'node:url'

import CompilerSkill from '#models/compiler_skill'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import KnowledgeItem from '#models/knowledge_item'
import PluginInstallation from '#models/plugin_installation'
import SkillKnowledgeDraft from '#models/skill_knowledge_draft'
import type Organization from '#models/organization'
import type User from '#models/user'

import { KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV } from '#services/knowledge_memory_operating/feature_flag'
import {
  assertNoOperatingPortForbiddenDependency,
  scanOperatingPortDependencies,
} from '#services/knowledge_memory_operating/no_dependency_guard'

import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from './auth/_helpers.js'

const SUMMARY = '/api/v1/knowledge-memory/summary'
const ITEMS = '/api/v1/knowledge-memory/items'

/** 全套敏感诱饵：任何运营表面都不得出现其中任意一个。 */
const BAITS = {
  knowledgeBody: '知识正文诱饵-SEC-AAA111',
  memorySummary: '记忆摘要诱饵-SEC-BBB222',
  prompt: 'SYSTEM-INSTRUCTION-诱饵-CCC333',
  modelOutput: 'MODEL-OUTPUT-诱饵-DDD444',
  retrievalQuery: 'RETRIEVAL-QUERY-诱饵-EEE555',
  toolArgs: 'TOOL-ARGS-诱饵-FFF666',
  secret: 'sk-live-SEC-GGG777',
  bearer: 'Bearer SEC-HHH888',
  apiKey: 'api_key=SEC-III999',
  absPath: 'C:\\Users\\alice\\secret\\path.txt',
} as const

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

function enableFlag() {
  process.env[KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV] = 'true'
}
function disableFlag() {
  delete process.env[KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV]
}

/** 把所有诱饵一次性塞进权威记录的正文/敏感字段。 */
async function seedBaitedKnowledge(org: Organization, creator: User, title = '带诱饵条目') {
  return KnowledgeItem.create({
    organizationId: org.id,
    layer: 'L1',
    layerMeta: {} as never,
    title,
    content: {
      body: BAITS.knowledgeBody,
      prompt: BAITS.prompt,
      modelOutput: BAITS.modelOutput,
      query: BAITS.retrievalQuery,
      toolArgs: BAITS.toolArgs,
      secret: BAITS.secret,
      authorization: BAITS.bearer,
      apiKey: BAITS.apiKey,
      path: BAITS.absPath,
    } as never,
    status: 'pending',
    domain: 'delivery',
    purpose: 'planning',
    complexity: null,
    provenance: {
      sources: [
        {
          layer: 'L1',
          sourceId: 's1',
          isSynthetic: false,
          retrievedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    } as never,
    reviewHistory: [] as never,
    isSynthetic: false,
    syntheticMethod: null,
    createdBy: creator.id,
    updatedBy: null,
    lastReferencedAt: null,
    retentionDays: null,
  })
}

async function seedBaitedMemory(org: Organization, actor: User) {
  return CopilotMemoryEntry.create({
    organizationId: org.id,
    projectId: null,
    actorId: actor.id,
    entryId: `mem-sec-${Math.random().toString(36).slice(2, 10)}`,
    memoryScope: 'user',
    summary: `${BAITS.memorySummary} ${BAITS.prompt} ${BAITS.secret}`,
    confidence: 0.6,
    confidenceSource: 'single_observation',
    basisSessionDbId: null,
    status: 'candidate',
    validityTier: 'medium',
    observedAt: DateTime.now().minus({ days: 1 }),
    lastConfirmedAt: null,
    retentionExpiresAt: null,
  })
}

async function seedPluginSkillDraft(
  org: Organization,
  creator: User,
  pluginId: string,
  installStatus: 'enabled' | 'installed' | 'uninstalled' | null,
) {
  if (installStatus !== null) {
    await PluginInstallation.create({
      organizationId: org.id,
      pluginId,
      version: '1.0.0',
      releaseId: 1,
      status: installStatus as never,
      packageDigest: 'sha256:p',
      manifestDigest: 'sha256:m',
      compatibilityDigest: 'sha256:c',
      rowVersion: 1,
    })
  }
  const skill = await CompilerSkill.create({
    organizationId: org.id,
    skillKey: `${pluginId}.methodology`,
    name: '插件方法论',
    version: '1.0.0',
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
    baseVersion: '1.0.0',
    status: 'pending' as never,
    aiAssisted: false,
    createdBy: creator.id,
    updatedBy: creator.id,
  })
  return { skill, draft }
}

// ── 7.1 / 7.2 插件内容只沿既有路径 ───────────────────────────────────

test.group('运营层安全 —— 插件边界（§7.1/§7.2）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('enabled 插件的 Skill 草稿经既有 adapter 显示且带 provenance', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { draft } = await seedPluginSkillDraft(org, owner, 'com.vendor.on', 'enabled')
    const token = await login(client, owner.email)

    const res = await client.get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`).bearerToken(token)
    res.assertStatus(200)
    const prov = res.body().data.item.pluginProvenance
    assert.equal(prov.kind, 'plugin')
    assert.equal(prov.pluginId, 'com.vendor.on')
    assert.isFalse(prov.disabled)
  })

  test('停用插件不再供给新内容，但历史 provenance 仍低敏可读且核心对象未删除', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { draft } = await seedPluginSkillDraft(org, owner, 'com.vendor.off', 'installed')
    const token = await login(client, owner.email)

    const res = await client.get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`).bearerToken(token)
    res.assertStatus(200)
    const prov = res.body().data.item.pluginProvenance
    assert.isTrue(prov.disabled)
    // 历史 provenance 可读
    assert.equal(prov.pluginId, 'com.vendor.off')
    // 核心对象仍在库里，没有被删除或重写
    const still = await SkillKnowledgeDraft.find(draft.id)
    assert.isNotNull(still)
    assert.equal(still!.status, 'pending')
  })

  test('已卸载插件 fail closed 成 disabled + uninstalled', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { draft } = await seedPluginSkillDraft(org, owner, 'com.vendor.gone', null)
    const token = await login(client, owner.email)

    const res = await client.get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`).bearerToken(token)
    res.assertStatus(200)
    const prov = res.body().data.item.pluginProvenance
    assert.isTrue(prov.disabled)
    assert.isTrue(prov.uninstalled)
  })

  test('停用插件的 surface 不放行 commit', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { draft } = await seedPluginSkillDraft(org, owner, 'com.vendor.off2', 'installed')
    const token = await login(client, owner.email)

    const res = await client
      .get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}/surfaces/skill_knowledge_authoring`)
      .bearerToken(token)
    // 服务端 resolve 必须拒绝或标 disabled，绝不返回 enabled=true
    if (res.response.status === 200) {
      assert.isFalse(res.body().data.enabled)
    } else {
      assert.equal(res.response.status, 404)
    }
  })

  test('插件 payload 里的组件/脚本/URL/prompt 不会成为运营字段', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const { skill, draft } = await seedPluginSkillDraft(org, owner, 'com.vendor.evil', 'enabled')
    // 插件试图通过 Skill knowledge 字段夹带可执行/任意内容
    skill.knowledge = {
      component: '<script>alert(1)</script>',
      href: 'https://evil.example.com/exfil',
      prompt: BAITS.prompt,
      provider: 'openai',
      model: 'gpt-4',
      permissions: ['*'],
      writeHandler: 'DROP TABLE knowledge_items',
    } as never
    await skill.save()
    const token = await login(client, owner.email)

    const res = await client.get(`${ITEMS}/skill_knowledge_draft/s-${draft.id}`).bearerToken(token)
    res.assertStatus(200)
    const body = JSON.stringify(res.body())
    for (const forbidden of ['<script>', 'evil.example.com', BAITS.prompt, 'DROP TABLE', 'gpt-4']) {
      assert.notInclude(body, forbidden, `插件贡献的 ${forbidden} 不得进入运营投影`)
    }
  })
})

// ── 7.4 静态依赖 ────────────────────────────────────────────────────

test.group('运营层安全 —— 静态依赖（§7.4）', () => {
  test('operating core 不依赖 AI provider / 网络 / 插件 runtime / UI slot', ({ assert }) => {
    const dir = fileURLToPath(
      new URL('../../app/services/knowledge_memory_operating/', import.meta.url),
    )
    const result = scanOperatingPortDependencies(dir)
    assert.deepEqual(result.violations, [], `禁用依赖命中：${JSON.stringify(result.violations)}`)
    assert.doesNotThrow(() => assertNoOperatingPortForbiddenDependency(dir))
  })
})

// ── 7.5 三面跨租 ────────────────────────────────────────────────────

test.group('运营层安全 —— 跨租不泄露（§7.5）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('summary / list / detail / deep-link 四面都不泄露 B 组织对象', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser()
    await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    const bKnowledge = await seedBaitedKnowledge(orgB, ownerB, 'B组织独有标题-SEC')
    const bMemory = await seedBaitedMemory(orgB, ownerB)
    const { draft: bDraft } = await seedPluginSkillDraft(orgB, ownerB, 'com.b.only', 'enabled')

    const tokenA = await login(client, ownerA.email)

    const summary = await client.get(SUMMARY).bearerToken(tokenA)
    const list = await client.get(`${ITEMS}?perPage=100`).bearerToken(tokenA)
    summary.assertStatus(200)
    list.assertStatus(200)

    // A 是空组织：所有 lane 计数必须为 0（而不是看见 B 的对象）
    for (const lane of summary.body().data.lanes) {
      assert.equal(lane.total, 0, `${lane.lane} 不得计入 B 的对象`)
    }
    const combined = JSON.stringify(summary.body()) + JSON.stringify(list.body())
    for (const leak of [
      'B组织独有标题-SEC',
      'com.b.only',
      `k-${bKnowledge.id}`,
      `m-${bMemory.id}`,
    ]) {
      assert.notInclude(combined, leak)
    }

    // deep-link 到 B 的每个对象都必须与「不存在」不可区分
    for (const [kind, ref] of [
      ['knowledge_item', `k-${bKnowledge.id}`],
      ['copilot_memory', `m-${bMemory.id}`],
      ['skill_knowledge_draft', `s-${bDraft.id}`],
    ] as const) {
      const cross = await client.get(`${ITEMS}/${kind}/${ref}`).bearerToken(tokenA)
      const missing = await client.get(`${ITEMS}/${kind}/${kind[0]}-999999`).bearerToken(tokenA)
      assert.equal(cross.response.status, missing.response.status)
      assert.deepEqual(cross.body(), missing.body())
    }
  })

  test('跨租 surface resolve 同样不可区分于不存在', async ({ client, assert }) => {
    const ownerA = await createUser()
    await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)
    const bItem = await seedBaitedKnowledge(orgB, ownerB)
    const tokenA = await login(client, ownerA.email)

    const cross = await client
      .get(`${ITEMS}/knowledge_item/k-${bItem.id}/surfaces/knowledge_review`)
      .bearerToken(tokenA)
    const missing = await client
      .get(`${ITEMS}/knowledge_item/k-999999/surfaces/knowledge_review`)
      .bearerToken(tokenA)
    assert.equal(cross.response.status, missing.response.status)
    assert.deepEqual(cross.body(), missing.body())
  })
})

// ── 7.6 敏感诱饵扫描 ────────────────────────────────────────────────

test.group('运营层安全 —— 低敏诱饵扫描（§7.6）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('summary / list / detail / surface 四类响应都不含任何诱饵', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const knowledge = await seedBaitedKnowledge(org, owner)
    const memory = await seedBaitedMemory(org, owner)
    const token = await login(client, owner.email)

    const responses = [
      await client.get(SUMMARY).bearerToken(token),
      await client.get(`${ITEMS}?perPage=100`).bearerToken(token),
      await client.get(`${ITEMS}/knowledge_item/k-${knowledge.id}`).bearerToken(token),
      await client.get(`${ITEMS}/copilot_memory/m-${memory.id}`).bearerToken(token),
      await client
        .get(`${ITEMS}/knowledge_item/k-${knowledge.id}/surfaces/knowledge_review`)
        .bearerToken(token),
    ]

    for (const res of responses) {
      const body = JSON.stringify(res.body())
      for (const [name, bait] of Object.entries(BAITS)) {
        assert.notInclude(body, bait, `响应泄露了 ${name}`)
      }
    }
  })

  test('错误响应也不回显诱饵', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedBaitedKnowledge(org, owner)
    const token = await login(client, owner.email)

    const bad = [
      `${ITEMS}?status=${encodeURIComponent(BAITS.secret)}`,
      `${ITEMS}/knowledge_item/${encodeURIComponent(BAITS.absPath)}`,
      `${ITEMS}/unknown_kind/k-1`,
    ]
    for (const url of bad) {
      const res = await client.get(url).bearerToken(token)
      const body = JSON.stringify(res.body())
      for (const bait of Object.values(BAITS)) {
        assert.notInclude(body, bait)
      }
    }
  })
})

// ── 7.7 网络与副作用 spy ────────────────────────────────────────────

test.group('运营层安全 —— 零外部副作用（§7.7）', (group) => {
  useAuthDatabase(group)
  group.each.setup(() => {
    enableFlag()
    return () => disableFlag()
  })

  test('全部读路径不发起任何 fetch / 外部 HTTP', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const knowledge = await seedBaitedKnowledge(org, owner)
    const memory = await seedBaitedMemory(org, owner)
    const token = await login(client, owner.email)

    const originalFetch = globalThis.fetch
    const attempted: string[] = []
    // 拦截而不是放行：任何一次外部请求都要被记录下来并使断言失败。
    globalThis.fetch = (async (input: unknown) => {
      attempted.push(String(input))
      throw new Error('network disabled in test')
    }) as typeof fetch

    try {
      await client.get(SUMMARY).bearerToken(token)
      await client.get(`${ITEMS}?perPage=100`).bearerToken(token)
      await client.get(`${ITEMS}?kind=retrieval_signal`).bearerToken(token)
      await client.get(`${ITEMS}/knowledge_item/k-${knowledge.id}`).bearerToken(token)
      await client.get(`${ITEMS}/copilot_memory/m-${memory.id}`).bearerToken(token)
      await client
        .get(`${ITEMS}/knowledge_item/k-${knowledge.id}/surfaces/knowledge_review`)
        .bearerToken(token)
    } finally {
      // 必须在同一用例里还原：留着全局桩会把后续整套测试拖成 network disabled。
      globalThis.fetch = originalFetch
    }

    assert.deepEqual(attempted, [], `读路径发起了外部请求：${attempted.join(', ')}`)
  })
})
