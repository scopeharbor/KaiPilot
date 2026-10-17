import { test } from '@japa/runner'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import GoogleOAuthService from '#services/integrations/google_oauth_service'

const SECRET_VALUE = 'preflight-super-secret-9f8e7d6c'
const TOKEN_VALUE = 'preflight-fake-token-abc123'
const FULL_SECRET_JSON = JSON.stringify({
  web: {
    client_id: 'preflight-client-id.apps.googleusercontent.com',
    client_secret: SECRET_VALUE,
    redirect_uris: ['http://localhost:3333/api/v1/auth/google/callback'],
  },
})

/**
 * 临时目录夹具：写入一个可选的 client JSON，返回 { tmp, jsonPath, cleanup }。
 */
function withTmpJson(content: string | null) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'aiproj-preflight-'))
  const jsonPath = path.join(tmp, 'client_secret.json')
  if (content !== null) writeFileSync(jsonPath, content)
  return {
    tmp,
    jsonPath,
    cleanup() {
      rmSync(tmp, { recursive: true, force: true })
    },
  }
}

/**
 * 测试环境割断：运行时进程 env（apps/backend/.env）可能自带 GOOGLE_OAUTH_* 值；
 * 本帮助函数把三类键显式注入空串（preflight 视为「显式未设置」），保证判定只由夹具驱动。
 */
function hermeticEnv(jsonPath?: string): Record<string, string> {
  return {
    GOOGLE_OAUTH_CLIENT_ID: '',
    GOOGLE_OAUTH_CLIENT_SECRET: '',
    GOOGLE_OAUTH_REDIRECT_URI: '',
    GOOGLE_OAUTH_CLIENT_JSON_PATH: jsonPath ?? '',
    GOOGLE_CLIENT_SECRET_JSON_PATH: jsonPath ?? '',
  }
}

test.group('Google OAuth login preflight（1.1/1.2 三态 + 无泄密）', () => {
  test('configured：完整 env 直配', ({ assert }) => {
    const service = new GoogleOAuthService({
      ...hermeticEnv(),
      GOOGLE_OAUTH_CLIENT_ID: 'id',
      GOOGLE_OAUTH_CLIENT_SECRET: SECRET_VALUE,
      GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3333/api/v1/auth/google/callback',
    })
    const preflight = service.loginPreflight()
    assert.equal(preflight.status, 'configured')
    assert.equal(preflight.configured, true)
    assert.deepEqual(preflight.missingEnvKeys, [])
  })

  test('configured：有效 JSON 文件（完整三要素）', ({ assert }) => {
    const { jsonPath, cleanup } = withTmpJson(FULL_SECRET_JSON)
    try {
      const service = new GoogleOAuthService(hermeticEnv(jsonPath))
      assert.equal(service.loginPreflight().status, 'configured')
    } finally {
      cleanup()
    }
  })

  test('disabled：无任何 env 与 JSON 路径', ({ assert }) => {
    const service = new GoogleOAuthService(hermeticEnv())
    const preflight = service.loginPreflight()
    assert.equal(preflight.status, 'disabled')
    assert.equal(preflight.configured, false)
    assert.sameMembers(preflight.missingEnvKeys, [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_OAUTH_REDIRECT_URI',
    ])
  })

  test('missing_file：JSON 路径指向不存在的文件（DGO-03）', ({ assert }) => {
    const service = new GoogleOAuthService(
      hermeticEnv('C:/definitely/not/exists/client_secret.json'),
    )
    const preflight = service.loginPreflight()
    assert.equal(preflight.status, 'missing_file')
    assert.equal(preflight.configured, false)
    // 诊断绝不携带路径本身（用户目录/ENOENT 完整路径）
    const serialized = JSON.stringify(preflight)
    assert.notInclude(serialized, 'client_secret.json')
    assert.notInclude(serialized, 'not/exists')
  })

  test('unreadable_file：路径是目录（读取失败）、invalid_json：内容不是 JSON（DGO-04 邻域）', ({
    assert,
  }) => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'aiproj-preflight-dir-'))
    try {
      const dirPath = path.join(tmp, 'some-dir')
      mkdirSync(dirPath)
      const dirService = new GoogleOAuthService(hermeticEnv(dirPath))
      assert.equal(dirService.loginPreflight().status, 'unreadable_file')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }

    const { jsonPath, cleanup } = withTmpJson('{ not valid json !!!')
    try {
      const service = new GoogleOAuthService(hermeticEnv(jsonPath))
      assert.equal(service.loginPreflight().status, 'invalid_json')
    } finally {
      cleanup()
    }
  })

  test('invalid_client_shape：JSON 缺 client_secret（DGO-04）', ({ assert }) => {
    const { jsonPath, cleanup } = withTmpJson(
      JSON.stringify({ web: { client_id: 'id-only', redirect_uris: [] } }),
    )
    try {
      const service = new GoogleOAuthService(hermeticEnv(jsonPath))
      const preflight = service.loginPreflight()
      assert.equal(preflight.status, 'invalid_client_shape')
      const serialized = JSON.stringify(preflight)
      assert.notInclude(serialized, 'id-only')
      assert.notInclude(serialized, 'client_id')
    } finally {
      cleanup()
    }
  })

  test('redirect_not_configured：JSON 有 id/secret 但无回调', ({ assert }) => {
    const { jsonPath, cleanup } = withTmpJson(
      JSON.stringify({ web: { client_id: 'id', client_secret: SECRET_VALUE } }),
    )
    try {
      const service = new GoogleOAuthService(hermeticEnv(jsonPath))
      const preflight = service.loginPreflight()
      assert.equal(preflight.status, 'redirect_not_configured')
      assert.sameMembers(preflight.missingEnvKeys, ['GOOGLE_OAUTH_REDIRECT_URI'])
    } finally {
      cleanup()
    }
  })

  test('JSON、client secret、token 不会出现在 preflight 输出或任何受控日志输出中', async ({
    assert,
  }) => {
    // 捕获进程级 stdout/stderr 与控制台方法：无论未来哪段代码开始打日志，
    // 只要本用例期间出现 secret/token/JSON 正文即失败（DGO-09 邻域、design D）。
    const chunks: string[] = []
    const stdoutWrite = process.stdout.write.bind(process.stdout)
    const stderrWrite = process.stderr.write.bind(process.stderr)
    const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const
    const consoleRecord = console as unknown as Record<string, unknown>
    const originals = consoleMethods.map((m) => consoleRecord[m])
    ;(process.stdout.write as unknown) = (chunk: unknown, ..._args: unknown[]) => {
      chunks.push(String(chunk))
      return true
    }
    ;(process.stderr.write as unknown) = (chunk: unknown, ..._args: unknown[]) => {
      chunks.push(String(chunk))
      return true
    }
    for (const m of consoleMethods) {
      consoleRecord[m] = (chunk: unknown, ..._args: unknown[]) => {
        chunks.push(String(chunk))
      }
    }
    try {
      // 覆盖全部错误路径：缺失/不可读/坏 JSON/缺字段/配置完整 + 失败回调诊断
      const { jsonPath, cleanup } = withTmpJson(FULL_SECRET_JSON)
      try {
        const service = new GoogleOAuthService({
          ...hermeticEnv(jsonPath),
          GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3333/api/v1/auth/google/callback',
        })
        console.log('preflight-configured', service.loginPreflight().status)
        console.warn('preflight-missing', service.loginPreflight().status)
        assert.equal(service.loginPreflight().status, 'configured')
      } finally {
        cleanup()
      }

      const broken = withTmpJson('{ broken')
      try {
        const service = new GoogleOAuthService(hermeticEnv(broken.jsonPath))
        console.error('preflight-invalid-json', service.loginPreflight().status)
        assert.equal(service.loginPreflight().status, 'invalid_json')
      } finally {
        broken.cleanup()
      }

      const none = withTmpJson(null)
      try {
        const service = new GoogleOAuthService(hermeticEnv(none.jsonPath))
        console.info('preflight-missing-file', service.loginPreflight().status)
        assert.equal(service.loginPreflight().status, 'missing_file')
      } finally {
        none.cleanup()
      }
    } finally {
      for (const [i, consoleMethod] of consoleMethods.entries()) {
        consoleRecord[consoleMethod] = originals[i]
      }
      process.stdout.write = stdoutWrite
      process.stderr.write = stderrWrite
    }

    const captured = chunks.join('\n')
    assert.notInclude(captured, SECRET_VALUE)
    assert.notInclude(captured, TOKEN_VALUE)
    assert.notInclude(captured, 'client_secret')
    assert.notInclude(captured, FULL_SECRET_JSON.slice(0, 64))
    assert.notInclude(captured, 'preflight-client-id.apps.googleusercontent.com')
  })

  test('preflight 输出序列化后不含任何秘密字段', ({ assert }) => {
    const { jsonPath, cleanup } = withTmpJson(FULL_SECRET_JSON)
    try {
      const service = new GoogleOAuthService(hermeticEnv(jsonPath))
      const serialized = JSON.stringify(service.loginPreflight())
      assert.notInclude(serialized, SECRET_VALUE)
      assert.notInclude(serialized, 'preflight-client-id')
      assert.notInclude(serialized, jsonPath)
      assert.notInclude(serialized, 'redirect_uris')
    } finally {
      cleanup()
    }
  })
})
