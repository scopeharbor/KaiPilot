/**
 * 文档搜索索引管理 API 功能测试（v3-document-full-text-search §8.5）
 *
 * 覆盖：
 * - 认证检查（未认证请求返回 400+）
 */
import { test } from '@japa/runner'
import { useAuthDatabase } from './auth/_helpers.js'

test.group('Document search API — 认证检查', (group) => {
  useAuthDatabase(group)

  test('GET /api/v1/projects/:id/document-search/status 需要认证', async ({ client, assert }) => {
    const res = await client.get('/api/v1/projects/1/document-search/status')
    assert.isAtLeast(res.status(), 400, '未认证应返回错误')
  })

  test('POST /api/v1/projects/:id/document-search/reindex 需要认证', async ({ client, assert }) => {
    const res = await client.post('/api/v1/projects/1/document-search/reindex').json({})
    assert.isAtLeast(res.status(), 400, '未认证应返回错误')
  })
})
