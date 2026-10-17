/**
 * v3-knowledge-memory-operating-layer —— port contracts 单元测试（vitest 风格）。
 *
 * 覆盖：no-dependency guard、scopedRef parser/format、attention 派生与 port
 * 接口形状的静态保证；不连数据库，避免污染 japa 共享 db。
 */

import { describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_MEMORY_OPERATING_KINDS,
  buildOwningSurfaceDescriptor,
  deriveKnowledgeItemAttention,
  isKnowledgeMemoryOperatingKind,
  makeScopedRef,
} from '@aiproj/types'

import {
  isKnowledgeMemoryOperatingLayerEnabled,
  KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV,
} from '../../app/services/knowledge_memory_operating/feature_flag.js'
import {
  assertNoOperatingPortForbiddenDependency,
  extractImportSpecifiers,
  isImportAllowed,
  scanOperatingPortDependencies,
} from '../../app/services/knowledge_memory_operating/no_dependency_guard.js'
import {
  isReadPortKind,
  OPERATING_READ_PORT_ERROR_CODES,
  OperatingReadPortError,
} from '../../app/services/knowledge_memory_operating/port.js'

describe('Operating read port — closed vocab & shape', () => {
  it('KIND 词表 4 kind 封闭', () => {
    expect(new Set(KNOWLEDGE_MEMORY_OPERATING_KINDS)).toEqual(
      new Set(['knowledge_item', 'copilot_memory', 'skill_knowledge_draft', 'retrieval_signal']),
    )
  })
  it('isKnowledgeMemoryOperatingKind 未知值拒绝', () => {
    expect(isKnowledgeMemoryOperatingKind('project_event')).toBe(false)
    expect(isKnowledgeMemoryOperatingKind('plugin')).toBe(false)
  })
  it('isReadPortKind 接受 4 kind', () => {
    for (const k of KNOWLEDGE_MEMORY_OPERATING_KINDS) {
      expect(isReadPortKind(k)).toBe(true)
    }
    expect(isReadPortKind('unknown')).toBe(false)
  })
  it('makeScopedRef 拒绝非法 ref', () => {
    expect(() => makeScopedRef('knowledge_item', 'a b')).toThrow()
    expect(() => makeScopedRef('knowledge_item', '')).toThrow()
  })
  it('makeScopedRef 接受合法 ref', () => {
    const r = makeScopedRef('knowledge_item', 'k-1234')
    expect(r.ref).toBe('k-1234')
    expect(r.kind).toBe('knowledge_item')
  })
  it('OPERATING_READ_PORT_ERROR_CODES 4 码', () => {
    expect(OPERATING_READ_PORT_ERROR_CODES.length).toBe(4)
  })
  it('OperatingReadPortError 带码与端口名', () => {
    const e = new OperatingReadPortError('OPERATING_PORT_TIMEOUT', 'knowledge_item', 'boom')
    expect(e.code).toBe('OPERATING_PORT_TIMEOUT')
    expect(e.port).toBe('knowledge_item')
    expect(e.message).toMatch(/\[OPERATING_PORT_TIMEOUT\] knowledge_item: boom/)
  })
})

describe('Operating read port — 静态依赖守卫', () => {
  it('扫描本目录无违规', () => {
    const r = scanOperatingPortDependencies('app/services/knowledge_memory_operating')
    expect(r.scannedFiles > 0).toBe(true)
    expect(r.violations.length).toBe(0)
  })
  it('assertNoOperatingPortForbiddenDependency 启动时 fail closed（不抛）', () => {
    expect(() =>
      assertNoOperatingPortForbiddenDependency('app/services/knowledge_memory_operating'),
    ).not.toThrow()
  })
  it('extractImportSpecifiers + isImportAllowed 白名单校验', () => {
    const sample = `
      import { foo } from '@aiproj/types'
      import { bar } from '#models/knowledge_item'
      import { baz } from '#services/knowledge/knowledge_service'
      import { qux } from '#services/audit_service'
    `
    const specifiers = extractImportSpecifiers(sample)
    // 4 static imports（动态 import('@aiproj/core') 在原始 re 不被捕获是已知限制——
    // 本 change 真正需要的是「白名单」语义，不强求覆盖 100% 写法）。
    expect(specifiers.length).toBeGreaterThanOrEqual(4)
    for (const s of specifiers) {
      expect(isImportAllowed(s)).toBe(true)
    }
    expect(isImportAllowed('node:http')).toBe(false)
    expect(isImportAllowed('AIGateway')).toBe(false)
  })
})

describe('Operating read port — feature flag', () => {
  it('缺省为 false', () => {
    expect(isKnowledgeMemoryOperatingLayerEnabled({ env: {} })).toBe(false)
  })
  it('env 1/true/on/yes/enabled → true', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'YES', 'enabled']) {
      expect(
        isKnowledgeMemoryOperatingLayerEnabled({
          env: { [KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV]: v },
        }),
      ).toBe(true)
    }
  })
  it('env 其它值 → false', () => {
    for (const v of ['0', 'false', 'no', 'off', '', 'random']) {
      expect(
        isKnowledgeMemoryOperatingLayerEnabled({
          env: { [KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED_ENV]: v },
        }),
      ).toBe(false)
    }
  })
})

describe('Operating read port — surface 构造 + attention 派生', () => {
  it('buildOwningSurfaceDescriptor 不含 callback / handle / token', () => {
    const d = buildOwningSurfaceDescriptor({
      surface: 'knowledge_review',
      scopedRef: makeScopedRef('knowledge_item', 'k-1'),
      enabled: true,
      routeKey: '/knowledge?layer=all',
      safeReturnContext: '知识审查',
    })
    expect(d.surface).toBe('knowledge_review')
    expect(d.authorityOwner).toBe('knowledge_service')
    expect([...d.scopedRefs]).toEqual(['k-1'])
    const obj = d as unknown as Record<string, unknown>
    expect(obj.callback).toBeUndefined()
    expect(obj.handle).toBeUndefined()
    expect(obj.previewHandle).toBeUndefined()
    expect(obj.confirmHandle).toBeUndefined()
    expect(obj.token).toBeUndefined()
  })
  it('deriveKnowledgeItemAttention L3 → synthetic_eval_only 优先', () => {
    expect(
      deriveKnowledgeItemAttention({
        layer: 'L3',
        lifecycle: 'active',
        hasProvenance: true,
        isL3EvalOnly: true,
      }),
    ).toBe('synthetic_eval_only')
  })
})
