import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

const BASE = '/api/v1/integrations'

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

test.group('Integrations API', (group) => {
  useAuthDatabase(group)

  test('requires authentication', async ({ client }) => {
    const res = await client.get(BASE)
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('lists lightweight providers for authenticated organization member', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(BASE).bearerToken(token)

    res.assertStatus(200)
    const providers = res.body().data as Array<{ provider: string; status: string }>
    assert.lengthOf(providers, 7)
    assert.sameMembers(
      providers.map((p) => p.provider),
      ['google_calendar', 'outlook_calendar', 'slack', 'feishu', 'dingtalk', 'github', 'gitlab'],
    )
  })

  test('unconfigured provider returns low-sensitive missing env keys', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.post(`${BASE}/feishu/authorize`).bearerToken(token)

    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'not_configured' } })
    const details = res.body().error.details as { missingEnvKeys: string[] }
    assert.includeMembers(details.missingEnvKeys, [
      'FEISHU_APP_ID',
      'FEISHU_APP_SECRET',
      'FEISHU_REDIRECT_URI',
    ])
  })

  test('disconnect placeholder is idempotent', async ({ client }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.post(`${BASE}/slack/disconnect`).bearerToken(token)

    res.assertStatus(200)
    res.assertBodyContains({ data: { provider: 'slack', status: 'disconnected' } })
  })
})
