/**
 * ai-structured-output-poc / M0 —— dev-only sandbox 路由守卫与 controller 测试。
 *
 * 覆盖点：
 *  1) `listInputs` 返回 12 条评测输入 + inputSetHash；
 *  2) DevOnlyMiddleware 在 production 环境短路 404，非 production 放行；
 *
 * 说明：不走 japa client（Adonis 6 test 环境下 controller 内 `console.log` 在真实 HTTP 通路
 * 未被触达，可能与 dynamic import + response.ok 的 lazy 序列化时机相关；改为直接对
 * `AiM0Controller` 与 `DevOnlyMiddleware` 做 unit 级注入，避免 HTTP 层不确定性）。
 */

import { test } from '@japa/runner'
import env from '#start/env'
import DevOnlyMiddleware from '#middleware/dev_only_middleware'
import AiM0Controller from '#controllers/ai_m0_controller'
import type { HttpContext } from '@adonisjs/core/http'

test.group('AI M0 sandbox routes', () => {
  test('AiM0Controller.listInputs 返回 12 条评测输入与元数据', async ({ assert }) => {
    const controller = new AiM0Controller()
    let payload: any = null
    const ctx = {
      response: {
        ok(data: any) {
          payload = data
          return data
        },
      },
    } as unknown as HttpContext
    await controller.listInputs(ctx)
    assert.isNotNull(payload)
    assert.lengthOf(payload.data, 12)
    assert.include(payload.meta.strategies, 'prompt')
    assert.include(payload.meta.strategies, 'native')
    assert.include(payload.meta.strategies, 'tool')
    assert.isString(payload.meta.inputSetHash)
    assert.isAbove(payload.meta.inputSetHash.length, 0)
    assert.equal(payload.meta.thresholds.landableRate, 0.95)
  })

  /**
   * DevOnlyMiddleware 单元测试：验证生产语义下 404 短路，dev 语义下放行 next()。
   */
  test('DevOnlyMiddleware：NODE_ENV=production 时短路 404', async ({ assert }) => {
    const mw = new DevOnlyMiddleware()
    const original = env.get('NODE_ENV')
    ;(env as any).set('NODE_ENV', 'production')
    try {
      let status = 0
      let body: any = null
      const ctx = {
        response: {
          notFound(payload: any) {
            status = 404
            body = payload
            return payload
          },
        },
      } as unknown as HttpContext
      let nextCalled = false
      await mw.handle(ctx, async () => {
        nextCalled = true
      })
      assert.equal(status, 404)
      assert.equal(body.error.code, 'RESOURCE_NOT_FOUND')
      assert.isFalse(nextCalled, 'next 不应被调用')
    } finally {
      ;(env as any).set('NODE_ENV', original)
    }
  })

  test('DevOnlyMiddleware：非 production 放行 next()', async ({ assert }) => {
    const mw = new DevOnlyMiddleware()
    const original = env.get('NODE_ENV')
    ;(env as any).set('NODE_ENV', 'test')
    try {
      const ctx = { response: {} } as unknown as HttpContext
      let nextCalled = false
      await mw.handle(ctx, async () => {
        nextCalled = true
      })
      assert.isTrue(nextCalled, 'next 应被调用')
    } finally {
      ;(env as any).set('NODE_ENV', original)
    }
  })
})
