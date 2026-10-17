import { test } from '@japa/runner'
import { useAuthDatabase } from '../auth/_helpers.js'

const PREFLIGHT_STATUSES = [
  'configured',
  'disabled',
  'missing_file',
  'unreadable_file',
  'invalid_json',
  'invalid_client_shape',
  'redirect_not_configured',
]

/**
 * v3-docker-google-oauth-runtime-wiring —— tasks 1.2/3.1（路由级）
 * googleConfig 结构合同 + callback 失败跳转 typed code（DGO-08）。
 */
test.group('Google OAuth 路由级契约（tasks 1.2/3.1）', (group) => {
  useAuthDatabase(group)

  test('googleConfig 返回闭集 preflight 状态与键名列表，不含任何值', async ({ client, assert }) => {
    const res = await client.get('/api/v1/auth/google/config?next=/projects')
    res.assertStatus(200)
    const data = res.body().data
    assert.isObject(data.preflight)
    assert.isTrue(PREFLIGHT_STATUSES.includes(data.preflight.status))
    assert.equal(data.preflight.status === 'configured', data.configured === true)
    assert.isArray(data.missingEnvKeys)
    for (const key of data.missingEnvKeys) {
      assert.match(key, /^[A-Z0-9_]+$/, 'missingEnvKeys 只允许键名')
    }
    // 响应任何位置不得携带 secret 形态（client_secret/client-id 全值/JSON 字段）
    const serialized = JSON.stringify(res.body())
    assert.notInclude(serialized, 'client_secret')
    assert.notInclude(serialized, 'googleusercontent')
  })

  test('provider error → 302 失败 URL 只带 typed code，无会话凭证（DGO-08）', async ({
    client,
    assert,
  }) => {
    const res = await client
      .get('/api/v1/auth/google/callback?error=access_denied&state=stale')
      .redirects(0)
    assert.equal(res.status(), 302)
    const location = String(res.headers()['location'] ?? '')
    assert.include(location, 'google_error=access_denied')
    assert.notInclude(location, 'access_token')
    assert.notInclude(location, 'refreshToken')
    assert.notInclude(location, 'user=')
  })

  test('state 伪造 → 302 google_error=invalid_state，无 JWT/会话（DGO-08）', async ({
    client,
    assert,
  }) => {
    const res = await client
      .get('/api/v1/auth/google/callback?code=forged-code&state=forged-state')
      .redirects(0)
    assert.equal(res.status(), 302)
    const location = String(res.headers()['location'] ?? '')
    assert.include(location, 'google_error=invalid_state')
    assert.notInclude(location, 'access_token')
    assert.notInclude(location, 'refreshToken')
  })

  test('未配置时 googleConfig 不给出可用的 authorizationUrl（DGO-01 邻域）', async ({
    client,
    assert,
  }) => {
    const res = await client.get('/api/v1/auth/google/config?next=/')
    const data = res.body().data
    if (data.preflight.status !== 'configured') {
      assert.isNull(data.authorizationUrl)
    }
  })
})
