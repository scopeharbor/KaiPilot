/**
 * v3-skill-knowledge-authoring —— 纯函数引擎单测（P0）。
 *
 * 穷尽覆盖：
 * - assembleBundle（投影/空 bundle/确定性）
 * - validateBundleStructure（合法/非法 kind/重复 id/sourceRefs 形状）
 * - diffBundles（增改删/确定性）
 * - generateFixtureAiAssistSections（advisory 标记/确定性/零模型）
 */
import { describe, it, expect } from 'vitest'
import {
  assembleBundle,
  validateBundleStructure,
  diffBundles,
  generateFixtureAiAssistSections,
  isKnowledgeSectionKind,
  KNOWLEDGE_SECTION_KINDS,
  type KnowledgeSection,
  type KnowledgeSectionKind,
  type AiAssistHint,
} from './skill-knowledge-authoring.js'

// ── 测试夹具 ────────────────────────────────────────────────────────────

function makeSection(overrides: Partial<KnowledgeSection> = {}): KnowledgeSection {
  return {
    id: 'sec-001',
    kind: 'rules',
    title: '测试规则',
    content: { summary: '规则摘要', detail: '规则详细信息' },
    sourceRefs: [{ manual: true }],
    status: 'draft',
    ...overrides,
  }
}

function makeSixSections(): KnowledgeSection[] {
  const kinds: KnowledgeSectionKind[] = [...KNOWLEDGE_SECTION_KINDS]
  return kinds.map((kind, i) => ({
    id: `sec-${String(i + 1).padStart(3, '0')}`,
    kind,
    title: `${kind} 测试条目`,
    content: makeContentForKind(kind),
    sourceRefs: [{ manual: true }],
    status: 'draft' as const,
  }))
}

function makeContentForKind(kind: KnowledgeSectionKind): Record<string, unknown> {
  switch (kind) {
    case 'rules':
    case 'patterns':
    case 'antiPatterns':
      return { summary: `${kind} 摘要`, detail: `${kind} 详情` }
    case 'examples':
      return { input: '输入', output: '输出', note: '备注' }
    case 'checklists':
      return { item: '检查项', required: true }
    case 'rubric':
      return { criterion: '标准', weight: 50 }
  }
}

// ── assembleBundle ──────────────────────────────────────────────────────

describe('assembleBundle', () => {
  it('投影 sections 按 kind 分组到 KnowledgeBundle 顶层形状', () => {
    const sections: KnowledgeSection[] = [
      makeSection({ id: 'r-1', kind: 'rules', content: { summary: '规则1', detail: '详情1' } }),
      makeSection({ id: 'r-2', kind: 'rules', content: { summary: '规则2', detail: '详情2' } }),
      makeSection({
        id: 'e-1',
        kind: 'examples',
        content: { input: '输入1', output: '输出1', note: '备注1' },
      }),
    ]

    const bundle = assembleBundle(sections)

    expect(bundle.rules).toHaveLength(2)
    expect(bundle.rules![0]).toEqual({ summary: '规则1', detail: '详情1' })
    expect(bundle.rules![1]).toEqual({ summary: '规则2', detail: '详情2' })
    expect(bundle.examples).toHaveLength(1)
    expect(bundle.patterns).toBeUndefined()
    expect(bundle.antiPatterns).toBeUndefined()
  })

  it('六类全投影', () => {
    const sections = makeSixSections()
    const bundle = assembleBundle(sections)

    for (const kind of KNOWLEDGE_SECTION_KINDS) {
      expect(bundle[kind]).toHaveLength(1)
    }
  })

  it('空 sections 产出空 bundle（无任何 kind 数组）', () => {
    const bundle = assembleBundle([])

    // 空 bundle 不应该有顶层 kind 键
    for (const kind of KNOWLEDGE_SECTION_KINDS) {
      expect(bundle[kind]).toBeUndefined()
    }
  })

  it('确定性——相同输入产出相同输出', () => {
    const sections = makeSixSections()

    const b1 = assembleBundle(sections)
    const b2 = assembleBundle(sections)

    expect(b1).toEqual(b2)
  })
})

// ── validateBundleStructure ─────────────────────────────────────────────

describe('validateBundleStructure', () => {
  it('合法 sections 通过校验——返回空清单', () => {
    const issues = validateBundleStructure(makeSixSections())
    expect(issues).toHaveLength(0)
  })

  it('单个合法 section 通过校验', () => {
    const issues = validateBundleStructure([makeSection()])
    expect(issues).toHaveLength(0)
  })

  it('非法 kind 被拒', () => {
    const sections = [makeSection({ kind: 'invalid_kind' as any })]
    const issues = validateBundleStructure(sections)

    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('INVALID_KIND')
    expect(issues[0].sectionId).toBe('sec-001')
  })

  it('重复 id 检测', () => {
    const sections = [
      makeSection({ id: 'dup-id', kind: 'rules' }),
      makeSection({ id: 'dup-id', kind: 'patterns' }),
    ]
    const issues = validateBundleStructure(sections)

    const dupIssues = issues.filter((i) => i.code === 'DUPLICATE_ID')
    expect(dupIssues).toHaveLength(1)
  })

  it('content 不是对象时拒绝', () => {
    const sections = [makeSection({ content: null as any })]
    const issues = validateBundleStructure(sections)

    expect(issues.some((i) => i.code === 'INVALID_CONTENT_TYPE')).toBe(true)
  })

  it('content 缺少 required keys 时检测', () => {
    const sections = [makeSection({ kind: 'examples', content: { input: '仅输入' } })]
    const issues = validateBundleStructure(sections)

    const missingKeyIssues = issues.filter((i) => i.code === 'MISSING_CONTENT_KEY')
    expect(missingKeyIssues.length).toBeGreaterThan(0)
  })

  it('每种 kind 的最小结构 key 各自独立校验', () => {
    for (const kind of KNOWLEDGE_SECTION_KINDS) {
      const sections = [
        makeSection({ id: `test-${kind}`, kind, content: makeContentForKind(kind) }),
      ]
      const issues = validateBundleStructure(sections)
      expect(issues).toHaveLength(0)
    }
  })

  it('sourceRefs 不是数组时被拒', () => {
    const sections = [makeSection({ sourceRefs: 'not-an-array' as any })]
    const issues = validateBundleStructure(sections)

    expect(issues.some((i) => i.code === 'INVALID_SOURCE_REFS')).toBe(true)
  })

  it('sourceRef 既无 sourceId 又 manual 不为 true 时被拒', () => {
    const sections = [makeSection({ sourceRefs: [{ manual: false }] })]
    const issues = validateBundleStructure(sections)

    expect(issues.some((i) => i.code === 'INVALID_SOURCE_REF_SHAPE')).toBe(true)
  })

  it('sourceRef 有 layer + sourceId 时通过', () => {
    const sections = [
      makeSection({ sourceRefs: [{ layer: 'L1', sourceId: 'src-1', manual: false }] }),
    ]
    const issues = validateBundleStructure(sections)
    expect(issues).toHaveLength(0)
  })

  it('sourceRef manual:true 且无 sourceId 时通过', () => {
    const sections = [makeSection({ sourceRefs: [{ manual: true }] })]
    const issues = validateBundleStructure(sections)
    expect(issues).toHaveLength(0)
  })

  it('确定性问题清单——相同输入相同输出', () => {
    const sections = [
      makeSection({ id: 'bad', kind: 'invalid' as any }),
      makeSection({ id: 'bad' }),
    ]

    const r1 = validateBundleStructure(sections)
    const r2 = validateBundleStructure(sections)

    expect(r1).toEqual(r2)
  })
})

// ── diffBundles ─────────────────────────────────────────────────────────

describe('diffBundles', () => {
  it('新增 section', () => {
    const base = [makeSection({ id: 'a' })]
    const draft = [makeSection({ id: 'a' }), makeSection({ id: 'b' })]

    const diff = diffBundles(base, draft)

    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].id).toBe('b')
    expect(diff.modified).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('修改 section', () => {
    const base = [makeSection({ id: 'a', title: '旧标题' })]
    const draft = [makeSection({ id: 'a', title: '新标题' })]

    const diff = diffBundles(base, draft)

    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].title).toBe('新标题')
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('删除 section', () => {
    const base = [makeSection({ id: 'a' }), makeSection({ id: 'b' })]
    const draft = [makeSection({ id: 'a' })]

    const diff = diffBundles(base, draft)

    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0].id).toBe('b')
    expect(diff.added).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('混合增改删', () => {
    const base = [
      makeSection({ id: 'keep' }),
      makeSection({ id: 'mod', title: '旧' }),
      makeSection({ id: 'del' }),
    ]
    const draft = [
      makeSection({ id: 'keep' }),
      makeSection({ id: 'mod', title: '新' }),
      makeSection({ id: 'add' }),
    ]

    const diff = diffBundles(base, draft)

    expect(diff.added).toHaveLength(1)
    expect(diff.added[0].id).toBe('add')
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].id).toBe('mod')
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0].id).toBe('del')
  })

  it('空 base 空 draft', () => {
    const diff = diffBundles([], [])

    expect(diff.added).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('确定性——相同输入相同输出', () => {
    const base = [makeSection({ id: 'a', title: 'A' })]
    const draft = [makeSection({ id: 'a', title: 'A2' })]

    const d1 = diffBundles(base, draft)
    const d2 = diffBundles(base, draft)

    expect(d1).toEqual(d2)
  })
})

// ── generateFixtureAiAssistSections ─────────────────────────────────────

describe('generateFixtureAiAssistSections', () => {
  it('默认 kind=rules 生成 advisory section', () => {
    const result = generateFixtureAiAssistSections({})

    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].kind).toBe('rules')
    expect(result.sections[0].sourceRefs).toEqual([{ manual: true }])
    expect(result.sections[0].provenance?.source).toBe('ai_assisted')
    expect(result.sections[0].status).toBe('draft')
    expect(result.tokensUsed).toBe(0)
  })

  it('指定 kind 生成对应种类 section', () => {
    for (const kind of KNOWLEDGE_SECTION_KINDS) {
      const result = generateFixtureAiAssistSections({ targetKind: kind })
      expect(result.sections[0].kind).toBe(kind)
    }
  })

  it('确定性——相同 hint 产出相同结果', () => {
    const hint: AiAssistHint = { domain: 'test', purpose: 'verify', complexity: 3 }
    const r1 = generateFixtureAiAssistSections(hint)
    const r2 = generateFixtureAiAssistSections(hint)

    expect(r1).toEqual(r2)
  })

  it('零真实模型调用——tokensUsed = 0', () => {
    const result = generateFixtureAiAssistSections({
      domain: 'security',
      purpose: 'audit',
    })

    expect(result.tokensUsed).toBe(0)
  })

  it('不同 hint 产出不同结果（确定性差异）', () => {
    const r1 = generateFixtureAiAssistSections({ domain: 'backend' })
    const r2 = generateFixtureAiAssistSections({ domain: 'frontend' })

    // 确定性但不同输入 => 不同输出
    expect(r1.sections[0].content).not.toEqual(r2.sections[0].content)
  })
})

// ── isKnowledgeSectionKind ──────────────────────────────────────────────

describe('isKnowledgeSectionKind', () => {
  it('六类合法 kind 返回 true', () => {
    for (const kind of KNOWLEDGE_SECTION_KINDS) {
      expect(isKnowledgeSectionKind(kind)).toBe(true)
    }
  })

  it('非法 kind 返回 false', () => {
    expect(isKnowledgeSectionKind('unknown')).toBe(false)
    expect(isKnowledgeSectionKind('')).toBe(false)
    expect(isKnowledgeSectionKind('RULE')).toBe(false)
  })
})
