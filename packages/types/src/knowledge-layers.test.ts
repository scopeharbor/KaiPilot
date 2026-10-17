/**
 * knowledge-layers.test.ts —— 四层知识底座共享契约纯函数单元测试。
 *
 * 覆盖：层唯一性、L3 强制 isSynthetic、provenance 非空、状态机合法转换、
 * LAYER_METADATA 预设完整性、KnowledgeItem 约束校验。
 */

import { describe, it, expect } from 'vitest'
import {
  KNOWLEDGE_LAYERS,
  isKnowledgeLayer,
  LAYER_METADATA,
  KNOWLEDGE_LIFECYCLE_STATUSES,
  isKnowledgeLifecycleStatus,
  KNOWLEDGE_LIFECYCLE_TRANSITIONS,
  validateKnowledgeLifecycleTransition,
  getLayerMetadata,
  validateKnowledgeItemConstraints,
} from './knowledge-layers'

// ── 层枚举 ──────────────────────────────────────────────────────────

describe('KNOWLEDGE_LAYERS', () => {
  it('包含且仅包含 L1-L4 四层', () => {
    expect(KNOWLEDGE_LAYERS).toHaveLength(4)
    expect(KNOWLEDGE_LAYERS).toContain('L1')
    expect(KNOWLEDGE_LAYERS).toContain('L2')
    expect(KNOWLEDGE_LAYERS).toContain('L3')
    expect(KNOWLEDGE_LAYERS).toContain('L4')
  })

  it('isKnowledgeLayer 守卫正确区分合法/非法层', () => {
    expect(isKnowledgeLayer('L1')).toBe(true)
    expect(isKnowledgeLayer('L2')).toBe(true)
    expect(isKnowledgeLayer('L3')).toBe(true)
    expect(isKnowledgeLayer('L4')).toBe(true)
    expect(isKnowledgeLayer('L5')).toBe(false)
    expect(isKnowledgeLayer('')).toBe(false)
    expect(isKnowledgeLayer('l1')).toBe(false) // 大小写敏感
  })
})

// ── 分层元数据预设 ──────────────────────────────────────────────────

describe('LAYER_METADATA', () => {
  it('四层均有预设元数据', () => {
    for (const layer of KNOWLEDGE_LAYERS) {
      const meta = LAYER_METADATA[layer]
      expect(meta).toBeDefined()
      expect(meta.layer).toBe(layer)
      expect(meta.trust).toBeTruthy()
      expect(meta.source).toBeTruthy()
      expect(meta.usage).toBeTruthy()
      expect(meta.frequency).toBeTruthy()
      expect(Array.isArray(meta.annotation)).toBe(true)
      expect(meta.annotation.length).toBeGreaterThan(0)
    }
  })

  it('L1 trust 为「高（规范）」', () => {
    expect(LAYER_METADATA.L1.trust).toBe('高（规范）')
  })

  it('L2 trust 为「低到中」', () => {
    expect(LAYER_METADATA.L2.trust).toBe('低到中')
  })

  it('L3 trust 为「仅测试」', () => {
    expect(LAYER_METADATA.L3.trust).toBe('仅测试')
  })

  it('L4 trust 为「高（一手）」', () => {
    expect(LAYER_METADATA.L4.trust).toBe('高（一手）')
  })

  it('L3 usage 为「仅测试」', () => {
    expect(LAYER_METADATA.L3.usage).toBe('仅测试')
  })

  it('L3 annotation 包含合成水印要求', () => {
    const l3Ann = LAYER_METADATA.L3.annotation
    expect(l3Ann.some((a) => a.includes('SYNTHETIC'))).toBe(true)
    expect(l3Ann.some((a) => a.includes('baseKnowledge'))).toBe(true)
    expect(l3Ann.some((a) => a.includes('禁止进入生产检索'))).toBe(true)
  })

  it('L4 annotation 包含去标识化要求', () => {
    const l4Ann = LAYER_METADATA.L4.annotation
    expect(l4Ann.some((a) => a.includes('去标识化'))).toBe(true)
    expect(l4Ann.some((a) => a.includes('90 天'))).toBe(true)
  })

  it('getLayerMetadata 返回正确预设', () => {
    const meta = getLayerMetadata('L1')
    expect(meta).toBe(LAYER_METADATA.L1)
  })
})

// ── 生命周期状态 ────────────────────────────────────────────────────

describe('知识生命周期状态', () => {
  it('包含五个状态', () => {
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toHaveLength(5)
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toContain('draft')
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toContain('pending')
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toContain('active')
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toContain('deprecated')
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toContain('outdated')
  })

  it('isKnowledgeLifecycleStatus 守卫正确区分合法/非法', () => {
    expect(isKnowledgeLifecycleStatus('draft')).toBe(true)
    expect(isKnowledgeLifecycleStatus('active')).toBe(true)
    expect(isKnowledgeLifecycleStatus('archived')).toBe(false)
    expect(isKnowledgeLifecycleStatus('deleted')).toBe(false)
    expect(isKnowledgeLifecycleStatus('')).toBe(false)
  })
})

// ── 生命周期转移表 ──────────────────────────────────────────────────

describe('知识生命周期转移表', () => {
  it('包含所有合法转移', () => {
    const expected = [
      'draft→pending',
      'pending→active',
      'pending→draft',
      'active→deprecated',
      'active→outdated',
      'deprecated→active',
      'outdated→active',
      'outdated→deprecated',
    ]
    for (const key of expected) {
      expect(KNOWLEDGE_LIFECYCLE_TRANSITIONS[key]).toBe(true)
    }
  })

  it('转移表条目数正确', () => {
    expect(Object.keys(KNOWLEDGE_LIFECYCLE_TRANSITIONS)).toHaveLength(8)
  })
})

// ── 转移校验函数 ────────────────────────────────────────────────────

describe('validateKnowledgeLifecycleTransition', () => {
  it('draft → pending 合法', () => {
    const result = validateKnowledgeLifecycleTransition('draft', 'pending')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('pending')
  })

  it('pending → active 合法（人工确认在 Service 层 enforce）', () => {
    const result = validateKnowledgeLifecycleTransition('pending', 'active')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('active')
  })

  it('pending → draft 合法（退回重新编辑）', () => {
    const result = validateKnowledgeLifecycleTransition('pending', 'draft')
    expect(result.valid).toBe(true)
    expect(result.resultingStatus).toBe('draft')
  })

  it('active → deprecated 合法', () => {
    const result = validateKnowledgeLifecycleTransition('active', 'deprecated')
    expect(result.valid).toBe(true)
  })

  it('active → outdated 合法', () => {
    const result = validateKnowledgeLifecycleTransition('active', 'outdated')
    expect(result.valid).toBe(true)
  })

  it('deprecated → active 合法（重新激活）', () => {
    const result = validateKnowledgeLifecycleTransition('deprecated', 'active')
    expect(result.valid).toBe(true)
  })

  it('outdated → active 合法（复核后恢复）', () => {
    const result = validateKnowledgeLifecycleTransition('outdated', 'active')
    expect(result.valid).toBe(true)
  })

  it('draft → active 跳级非法（必须经 pending 门）', () => {
    const result = validateKnowledgeLifecycleTransition('draft', 'active')
    expect(result.valid).toBe(false)
    expect(result.reasonCode).toBe('KNOWLEDGE_TRANSITION_INVALID')
  })

  it('active → draft 非法（不可回退到草稿）', () => {
    const result = validateKnowledgeLifecycleTransition('active', 'draft')
    expect(result.valid).toBe(false)
  })

  it('draft → deprecated 非法', () => {
    const result = validateKnowledgeLifecycleTransition('draft', 'deprecated')
    expect(result.valid).toBe(false)
  })

  it('pending → deprecated 非法', () => {
    const result = validateKnowledgeLifecycleTransition('pending', 'deprecated')
    expect(result.valid).toBe(false)
  })

  it('deprecated → draft 非法', () => {
    const result = validateKnowledgeLifecycleTransition('deprecated', 'draft')
    expect(result.valid).toBe(false)
  })

  it('非法目标状态被拒', () => {
    const result = validateKnowledgeLifecycleTransition('active', 'nonexistent' as any)
    expect(result.valid).toBe(false)
  })
})

// ── KnowledgeItem 约束校验 ───────────────────────────────────────────

describe('validateKnowledgeItemConstraints', () => {
  const validL1Provenance = {
    sources: [
      {
        layer: 'L1' as const,
        sourceId: 'pmbok-7',
        title: 'PMBOK 第 7 版',
        section: '§3.2',
      },
    ],
  }

  it('合法 L1 记录通过所有约束', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L1',
      isSynthetic: false,
      provenance: validL1Provenance,
    })
    expect(errors).toHaveLength(0)
  })

  it('合法 L2 记录通过所有约束', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L2',
      isSynthetic: false,
      provenance: {
        sources: [
          {
            layer: 'L2',
            sourceId: 'project-123',
            title: '某项目复盘报告',
            url: 'https://example.com/report',
          },
        ],
      },
    })
    expect(errors).toHaveLength(0)
  })

  it('L3 缺失 isSynthetic 被拒', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L3',
      isSynthetic: false,
      syntheticMethod: '',
      provenance: validL1Provenance,
    })
    expect(errors.some((e) => e.includes('isSynthetic'))).toBe(true)
  })

  it('L3 缺失 syntheticMethod 被拒', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L3',
      isSynthetic: true,
      provenance: validL1Provenance,
    })
    expect(errors.some((e) => e.includes('syntheticMethod'))).toBe(true)
  })

  it('L3 空 syntheticMethod 被拒', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L3',
      isSynthetic: true,
      syntheticMethod: '   ',
      provenance: validL1Provenance,
    })
    expect(errors.some((e) => e.includes('syntheticMethod'))).toBe(true)
  })

  it('合法 L3 通过所有约束', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L3',
      isSynthetic: true,
      syntheticMethod:
        '由 L1(pmbok-7§3.2) + L2(project-123) 交叉验证生成，model=claude-opus-4-8, t=0.3, seed=42',
      provenance: {
        sources: [
          {
            layer: 'L1',
            sourceId: 'pmbok-7',
            title: 'PMBOK 第 7 版',
            section: '§3.2',
          },
        ],
      },
    })
    expect(errors).toHaveLength(0)
  })

  it('provenance.sources 为空被拒', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L1',
      isSynthetic: false,
      provenance: { sources: [] },
    })
    expect(errors.some((e) => e.includes('provenance.sources'))).toBe(true)
  })

  it('非 L3 的 isSynthetic=true 被拒', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L1',
      isSynthetic: true,
      provenance: validL1Provenance,
    })
    expect(errors.some((e) => e.includes('isSynthetic'))).toBe(true)
  })

  it('合法 L4 记录通过所有约束', () => {
    const errors = validateKnowledgeItemConstraints({
      layer: 'L4',
      isSynthetic: false,
      provenance: {
        sources: [
          {
            layer: 'L4',
            sourceId: 'product-event-456',
            title: '产品运行事件采集',
          },
        ],
      },
    })
    expect(errors).toHaveLength(0)
  })
})

// ── 类型导出完整性（编译时校验，运行时占位） ─────────────────────────

describe('类型导出完整性', () => {
  it('所有导出的常量为数组且长度正确', () => {
    expect(Array.isArray(KNOWLEDGE_LAYERS)).toBe(true)
    expect(KNOWLEDGE_LAYERS).toHaveLength(4)
    expect(Array.isArray(KNOWLEDGE_LIFECYCLE_STATUSES)).toBe(true)
    expect(KNOWLEDGE_LIFECYCLE_STATUSES).toHaveLength(5)
  })
})
