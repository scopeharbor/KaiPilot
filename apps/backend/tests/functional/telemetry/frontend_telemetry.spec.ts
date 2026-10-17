import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import TokenService from '#services/token_service'
import { createTestOrg, createTestUser, setupTest } from '../../helpers/index.js'
import type Organization from '#models/organization'
import type User from '#models/user'

test.group('FrontendTelemetryController', (group) => {
  let user: User
  let org: Organization
  let tokenSvc: TokenService

  group.each.setup(async () => {
    const s = await setupTest()
    org = await createTestOrg(s.db)
    user = await createTestUser(s.db, org)
    tokenSvc = await app.container.make(TokenService)
  })

  /**
   * 测试客户端 loginAs 签发的 token organizationId=null（无租户上下文），
   * 而事件与聚合的组织归属必须来自服务端租户上下文（spec：事件 MUST 按组织隔离），
   * 故用 TokenService 手工签发带组织 claim 的 access token。
   */
  async function orgToken(): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: user.id,
      organizationId: Number(org.id),
      roleVersion: 0,
      permissions: [],
    })
  }

  test('POST /api/v1/frontend-telemetry 接收合规事件', async ({ client, assert }) => {
    const response = await client
      .post('/api/v1/frontend-telemetry')
      .header('Authorization', `Bearer ${await orgToken()}`)
      .json({
        events: [
          {
            eventKind: 'panel_open',
            timestamp: '2026-08-22T10:00:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
          },
        ],
      })

    response.assertStatus(200)
    assert.equal(response.body().received, 1)
  })

  test('POST /api/v1/frontend-telemetry 拒绝含 userInput 的事件', async ({ client, assert }) => {
    const response = await client
      .post('/api/v1/frontend-telemetry')
      .header('Authorization', `Bearer ${await orgToken()}`)
      .json({
        events: [
          {
            eventKind: 'panel_open',
            timestamp: '2026-08-22T10:00:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
            userInput: '用户输入的文本内容',
          },
        ],
      })

    response.assertStatus(200)
    assert.equal(response.body().received, 0)
  })

  test('POST /api/v1/frontend-telemetry 拒绝含 token 的事件', async ({ client, assert }) => {
    const response = await client
      .post('/api/v1/frontend-telemetry')
      .header('Authorization', `Bearer ${await orgToken()}`)
      .json({
        events: [
          {
            eventKind: 'panel_open',
            timestamp: '2026-08-22T10:00:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
            token: 'sk-1234567890abcdef',
          },
        ],
      })

    response.assertStatus(200)
    assert.equal(response.body().received, 0)
  })

  test('POST /api/v1/frontend-telemetry 拒绝含 secret 的事件', async ({ client, assert }) => {
    const response = await client
      .post('/api/v1/frontend-telemetry')
      .header('Authorization', `Bearer ${await orgToken()}`)
      .json({
        events: [
          {
            eventKind: 'panel_open',
            timestamp: '2026-08-22T10:00:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
            secret: 'password: mysecretpassword',
          },
        ],
      })

    response.assertStatus(200)
    assert.equal(response.body().received, 0)
  })

  test('POST /api/v1/frontend-telemetry 混合合规与不合规事件', async ({ client, assert }) => {
    const response = await client
      .post('/api/v1/frontend-telemetry')
      .header('Authorization', `Bearer ${await orgToken()}`)
      .json({
        events: [
          {
            eventKind: 'panel_open',
            timestamp: '2026-08-22T10:00:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
          },
          {
            eventKind: 'panel_close',
            timestamp: '2026-08-22T10:01:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
            hasSubmitted: true,
          },
          {
            eventKind: 'session_turn',
            timestamp: '2026-08-22T10:02:00.000Z',
            sessionId: 'session-001',
            organizationId: 'org-001',
            turnCount: 1,
            userInput: '用户输入的文本内容',
          },
        ],
      })

    response.assertStatus(200)
    // 只有两个事件是合规的
    assert.equal(response.body().received, 2)
  })

  test('POST /api/v1/frontend-telemetry 无租户上下文被拒（不落库）', async ({ client }) => {
    const response = await client.post('/api/v1/frontend-telemetry').json({
      events: [
        {
          eventKind: 'panel_open',
          timestamp: '2026-08-22T10:00:00.000Z',
          sessionId: 'session-001',
          organizationId: 'org-001',
        },
      ],
    })

    // 无认证/无租户上下文：事件不得被接收（组织隔离无从谈起）
    response.assertStatus(401)
  })

  test('POST /api/v1/frontend-telemetry 拒绝非数组请求体', async ({ client }) => {
    const response = await client.post('/api/v1/frontend-telemetry').json({
      events: 'not-an-array',
    })

    response.assertStatus(400)
    response.assertBodyContains({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'events 必须是数组',
      },
    })
  })

  test('GET /api/v1/frontend-telemetry/aggregate 拒绝未认证请求', async ({ client }) => {
    const response = await client.get('/api/v1/frontend-telemetry/aggregate').qs({
      organizationId: 'org-001',
      start: '2026-08-22T00:00:00.000Z',
      end: '2026-08-22T23:59:59.999Z',
    })

    response.assertStatus(401)
    response.assertBodyContains({
      error: {
        code: 'AUTH_REQUIRED',
        message: '需要认证',
      },
    })
  })

  test('GET /api/v1/frontend-telemetry/aggregate 拒绝查询其他组织数据', async ({ client }) => {
    const response = await client
      .get('/api/v1/frontend-telemetry/aggregate')
      .qs({
        organizationId: '99999',
        start: '2026-08-22T00:00:00.000Z',
        end: '2026-08-22T23:59:59.999Z',
      })
      .header('Authorization', `Bearer ${await orgToken()}`)

    response.assertStatus(403)
    response.assertBodyContains({
      error: {
        code: 'PERMISSION_DENIED',
        message: '无权查询其他组织的数据',
      },
    })
  })

  test('GET /api/v1/frontend-telemetry/aggregate 拒绝缺少必要参数', async ({ client }) => {
    const response = await client
      .get('/api/v1/frontend-telemetry/aggregate')
      .qs({
        organizationId: String(org.id),
        // 缺少 start 和 end
      })
      .header('Authorization', `Bearer ${await orgToken()}`)

    response.assertStatus(400)
    response.assertBodyContains({
      error: {
        code: 'VALIDATION_ERROR',
        message: '缺少必要参数：organizationId, start, end',
      },
    })
  })
})
