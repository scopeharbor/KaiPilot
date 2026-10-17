/**
 * v3-personal-edition-open-source-export §3.4 —— 未匹配路由返回统一 404 错误体。
 *
 * 个人版没有企业与平台 API，客户端请求它们时必须得到 `404 + { error: { code:
 * 'RESOURCE_NOT_FOUND', message } }`，不能是框架默认的调试错误页（含请求路径与堆栈）。
 * 私有部署里同样适用于任何不存在的接口。
 */
import { test } from '@japa/runner'

test.group('未匹配路由的统一 404', () => {
  test('不存在的接口返回 RESOURCE_NOT_FOUND，不回显路径与堆栈', async ({ client, assert }) => {
    for (const [method, path] of [
      ['get', '/api/v1/organizations/1/not-a-real-endpoint'],
      ['post', '/api/v1/not-a-real-endpoint/x'],
    ] as const) {
      const res = await client[method](path)
      res.assertStatus(404)
      res.assertBody({ error: { code: 'RESOURCE_NOT_FOUND', message: '请求的接口不存在' } })
      assert.notInclude(res.text(), 'not-a-real-endpoint')
    }
  })
})
