/**
 * 知识检索 query 参数校验（HTTP 契约层）——vitest 风格单测。
 *
 * 契约（openspec/changes/archive/2026-07-24-v3-four-layer-knowledge-system/api-contract.md）：
 * `GET /api/v1/knowledge` 支持 `status` 参数（默认 active 由存储层兜底）、`layer` 枚举、
 * `page` / `perPage` 数字参数。HTTP query 一律是字符串，数字参数必须能 coerce。
 */
import { describe, it, expect } from 'vitest'
import { queryKnowledgeSchema } from '#validators/knowledge_validator'

describe('queryKnowledgeSchema（GET /api/v1/knowledge 参数）', () => {
  it('status 全部合法生命周期值通过', () => {
    for (const status of ['draft', 'pending', 'active', 'deprecated', 'outdated']) {
      const r = queryKnowledgeSchema.safeParse({ status })
      expect(r.success, `status=${status} 应合法`).toBe(true)
    }
  })

  it('status 非法值拒绝（controller 层映射为 400 VALIDATION_ERROR）', () => {
    const r = queryKnowledgeSchema.safeParse({ status: '__nope__' })
    expect(r.success).toBe(false)
  })

  it('缺省：evalContext=false、page=1、perPage=20、status 未指定', () => {
    const r = queryKnowledgeSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.evalContext).toBe(false)
      expect(r.data.page).toBe(1)
      expect(r.data.perPage).toBe(20)
      expect(r.data.status).toBeUndefined()
    }
  })

  it('HTTP 字符串参数 coerce：page/perPage 数字化且 status 透传', () => {
    const r = queryKnowledgeSchema.safeParse({ page: '2', perPage: '50', status: 'pending' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.page).toBe(2)
      expect(r.data.perPage).toBe(50)
      expect(r.data.status).toBe('pending')
    }
  })

  it('layer 白名单外取值拒绝', () => {
    expect(queryKnowledgeSchema.safeParse({ layer: 'L9' }).success).toBe(false)
    expect(queryKnowledgeSchema.safeParse({ layer: 'L1' }).success).toBe(true)
  })
})
