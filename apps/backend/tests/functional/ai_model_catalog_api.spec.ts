import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import AiModelCatalogSnapshot from '#models/ai_model_catalog_snapshot'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'

const BASE = '/api/v1/ai/model-catalog'

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedCatalogSnapshot() {
  await AiModelCatalogSnapshot.create({
    source: 'models.dev',
    sourceUrl: 'https://models.dev/catalog.json',
    sourceHash: 'fixture-hash',
    payload: {
      siliconflow: {
        name: 'SiliconFlow',
        api: 'https://api.siliconflow.cn/v1',
        doc: 'https://docs.siliconflow.cn',
        env: ['SILICONFLOW_API_KEY'],
        npm: '@ai-sdk/openai-compatible',
        models: {
          'Qwen/Qwen3-32B': {
            id: 'Qwen/Qwen3-32B',
            name: 'Qwen3 32B',
            modalities: { input: ['text', 'pdf'], output: ['text'] },
            limit: { context: 32768, input: 30000, output: 8192 },
            cost: { input: 0.4, output: 1.6 },
            knowledge: '2025-04',
            release_date: '2025-04-29',
            last_updated: '2026-06-30',
            structured_output: true,
            tool_call: true,
          },
        },
      },
    },
    providerCount: 1,
    modelCount: 1,
    fetchedAt: DateTime.now(),
    expiresAt: DateTime.now().plus({ hours: 6 }),
    stale: false,
  })
}

test.group('AiModelCatalogController API', (group) => {
  useAiDatabase(group)

  test('GET search requires authentication', async ({ client }) => {
    const res = await client.get(`${BASE}/search?q=硅基流动`)
    res.assertStatus(401)
  })

  test('GET search returns cached Chinese matches and catalog limits', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    await createOrganization(user)
    await seedCatalogSnapshot()
    const token = await login(client, user.email)

    const res = await client.get(`${BASE}/search?q=硅基流动`).bearerToken(token)
    res.assertStatus(200)
    const body = res.body()
    assert.equal(body.data[0].providerId, 'siliconflow')
    assert.equal(body.data[0].limit.context, 32768)
    assert.equal(body.data[0].cost.input, 0.4)
    assert.equal(body.meta.stale, false)
  })

  test('POST refresh requires AI connection manage permission', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.post(`${BASE}/refresh`).bearerToken(token).json({ force: true })
    res.assertStatus(403)
  })
})
