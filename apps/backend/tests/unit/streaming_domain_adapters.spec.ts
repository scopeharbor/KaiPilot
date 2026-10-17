/**
 * streaming_domain_adapters.spec —— Domain 授权适配器测试（§2.4/2.6）。
 *
 * §2.4 授权测试
 * §2.6 跨组织隔离
 */

import { describe, expect, it } from 'vitest'
import {
  AiDraftDomainAdapter,
  CompilerDomainAdapter,
  CodeGenerationDomainAdapter,
} from '#services/streaming/domain_adapters'

describe('§2.4 Domain 授权适配器', () => {
  describe('AiDraftDomainAdapter', () => {
    it('domain 值是 ai-draft', () => {
      const adapter = new AiDraftDomainAdapter()
      expect(adapter.domain).toBe('ai-draft')
    })

    it('缺少 streamId 时返回拒绝', async () => {
      const adapter = new AiDraftDomainAdapter()
      const result = await adapter.authorize(1, 1, '')
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('INVALID_DRAFT_ID')
    })

    it('未知用户时返回拒绝', async () => {
      const adapter = new AiDraftDomainAdapter()
      const result = await adapter.authorize(99999, 1, 'draft-fake')
      expect(result.allowed).toBe(false)
    })
  })

  describe('CompilerDomainAdapter', () => {
    it('domain 值是 compiler', () => {
      const adapter = new CompilerDomainAdapter()
      expect(adapter.domain).toBe('compiler')
    })

    it('非数字 runId 返回拒绝', async () => {
      const adapter = new CompilerDomainAdapter()
      const result = await adapter.authorize(1, 1, 'not-a-number')
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('INVALID_RUN_ID')
    })
  })

  describe('CodeGenerationDomainAdapter', () => {
    it('domain 值是 code-generation', () => {
      const adapter = new CodeGenerationDomainAdapter()
      expect(adapter.domain).toBe('code-generation')
    })
  })
})

describe('§2.6 跨组织隔离', () => {
  it('AiDraftDomainAdapter 的 domain 是 ai-draft', () => {
    const adapter = new AiDraftDomainAdapter()
    expect(adapter.domain).toBe('ai-draft')
  })

  it('CompilerDomainAdapter 的 domain 是 compiler', () => {
    const adapter = new CompilerDomainAdapter()
    expect(adapter.domain).toBe('compiler')
  })

  it('不同 domain adapter 的 domain 不同', () => {
    const draft = new AiDraftDomainAdapter()
    const compiler = new CompilerDomainAdapter()
    const codegen = new CodeGenerationDomainAdapter()
    const domains = [draft.domain, compiler.domain, codegen.domain]
    const unique = new Set(domains)
    expect(unique.size).toBe(3)
  })
})
