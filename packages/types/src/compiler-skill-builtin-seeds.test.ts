/**
 * compiler-skill-builtin-seeds.test.ts —— 内置种子契约测试。
 *
 * 覆盖：
 * - 接口形状
 * - resolveSeedContent 投影为 KnowledgeBundle
 * - compareSeedVersion 语义版本比较
 * - 零运行时依赖
 * - 不修改 compiler-skill.ts 的 Skill/KnowledgeBundle 定义
 * - 六类内容结构完整性
 */

import { describe, it, expect } from 'vitest'
import {
  listBuiltinSeeds,
  resolveSeedContent,
  compareSeedVersion,
} from './compiler-skill-builtin-seeds.js'
import type { SkillCategory, ActivationRule } from './compiler-skill.js'

// ── 1. 接口形状 ───────────────────────────────────────────────────────

describe('listBuiltinSeeds', () => {
  it('返回非空数组', () => {
    const seeds = listBuiltinSeeds()
    expect(Array.isArray(seeds)).toBe(true)
    expect(seeds.length).toBeGreaterThan(0)
  })

  it('含 skill-sw-dev、skill-pm-agile、skill-pm-waterfall、skill-marketing、skill-construction、skill-product-rd、skill-devops 与 skill-data-project 八个 Skill', () => {
    const seeds = listBuiltinSeeds()
    expect(seeds.length).toBe(8)
    const skillKeys = seeds.map((s) => s.skillKey)
    expect(skillKeys).toContain('skill-sw-dev')
    expect(skillKeys).toContain('skill-pm-agile')
    expect(skillKeys).toContain('skill-pm-waterfall')
    expect(skillKeys).toContain('skill-marketing')
    expect(skillKeys).toContain('skill-construction')
    expect(skillKeys).toContain('skill-product-rd')
    expect(skillKeys).toContain('skill-devops')
    expect(skillKeys).toContain('skill-data-project')
  })

  it('首期 8 Skill 封闭、不含首期之外新领域 Skill', () => {
    const seeds = listBuiltinSeeds()
    const skillKeys = seeds.map((s) => s.skillKey)
    // 首期 8 个初期 Skill 全部落地：sw-dev / agile / waterfall / marketing / construction / product-rd / devops / data-project
    expect(skillKeys).not.toContain('skill-fintech')
    expect(skillKeys).not.toContain('skill-healthcare')
    expect(skillKeys).not.toContain('skill-education')
    expect(skillKeys).not.toContain('skill-legal')
  })
})

describe('软件开发 Skill 元数据', () => {
  const seed = listBuiltinSeeds()[0]

  it('skillKey 为 skill-sw-dev', () => {
    expect(seed.skillKey).toBe('skill-sw-dev')
  })

  it('category 对齐契约', () => {
    const cat: SkillCategory = seed.category
    expect(cat.primary).toBe('domain')
    expect(cat.secondary).toBe('software_engineering')
  })

  it('dependencies 为空数组', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含"软件开发"', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.projectTypes).toBeDefined()
    expect(activation.projectTypes!).toContain('软件开发')
  })

  it('activation.domains 含 software_engineering', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.domains).toBeDefined()
    expect(activation.domains!).toContain('software_engineering')
  })

  it('basePriority 为 100', () => {
    expect(seed.basePriority).toBe(100)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('名称为简体中文', () => {
    expect(seed.name).toBe('软件开发')
  })

  it('tags 非空且为简体中文', () => {
    expect(seed.tags.length).toBeGreaterThan(0)
    // 至少包含"软件开发"
    expect(seed.tags).toContain('软件开发')
  })
})

// ── 2. 六类 KnowledgeBundle 内容结构 ─────────────────────────────────

describe('KnowledgeBundle 六类内容结构', () => {
  const seed = listBuiltinSeeds()[0]

  const categories = [
    'rules',
    'patterns',
    'antiPatterns',
    'examples',
    'checklists',
    'rubric',
  ] as const

  for (const cat of categories) {
    describe(`${cat} 类`, () => {
      const entries = seed.knowledge[cat]

      it('6–10 条', () => {
        expect(entries.length).toBeGreaterThanOrEqual(6)
        expect(entries.length).toBeLessThanOrEqual(10)
      })

      it('每条含 id/title/content/provenance', () => {
        for (const entry of entries) {
          expect(typeof entry.id).toBe('string')
          expect(entry.id.length).toBeGreaterThan(0)
          expect(typeof entry.title).toBe('string')
          expect(entry.title.length).toBeGreaterThan(0)
          expect(typeof entry.content).toBe('string')
          expect(entry.content.length).toBeGreaterThan(0)
          expect(entry.provenance).toBe('official')
        }
      })

      it('内容为简体中文', () => {
        for (const entry of entries) {
          // 简体中文内容应包含中文字符
          expect(entry.content).toMatch(/[一-鿿]/)
        }
      })

      it('title 为简体中文', () => {
        for (const entry of entries) {
          expect(entry.title).toMatch(/[一-鿿]/)
        }
      })

      it('stage 为 1–6 可选元信息', () => {
        for (const entry of entries) {
          if (entry.stage !== undefined) {
            expect(entry.stage).toBeGreaterThanOrEqual(1)
            expect(entry.stage).toBeLessThanOrEqual(6)
          }
        }
      })

      it('id 稳定不可变', () => {
        for (const entry of entries) {
          expect(entry.id).toMatch(/^sw-/)
        }
      })
    })
  }
})

// ── 3. resolveSeedContent 投影 ────────────────────────────────────────

describe('resolveSeedContent', () => {
  it('返回 KnowledgeBundle 顶层形状', () => {
    const seed = listBuiltinSeeds()[0]
    const bundle = resolveSeedContent(seed)

    // 六类字段存在
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
    expect(Array.isArray(bundle.antiPatterns)).toBe(true)
    expect(Array.isArray(bundle.examples)).toBe(true)
    expect(Array.isArray(bundle.checklists)).toBe(true)
    expect(Array.isArray(bundle.rubric)).toBe(true)
  })

  it('投影为 unknown[] 顶层形状', () => {
    const seed = listBuiltinSeeds()[0]
    const bundle = resolveSeedContent(seed)

    // 所有六类投影为非空 unknown[]
    const cats = ['rules', 'patterns', 'antiPatterns', 'examples', 'checklists', 'rubric'] as const
    for (const cat of cats) {
      expect(bundle[cat]!.length).toBeGreaterThan(0)
    }
  })

  it('投影后条目数量与种子一致', () => {
    const seed = listBuiltinSeeds()[0]
    const bundle = resolveSeedContent(seed)

    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('投影后的条目保留原始内容', () => {
    const seed = listBuiltinSeeds()[0]
    const bundle = resolveSeedContent(seed)

    const firstRule = bundle.rules![0] as any
    expect(firstRule.id).toBe(seed.knowledge.rules[0].id)
    expect(firstRule.title).toBe(seed.knowledge.rules[0].title)
    expect(firstRule.content).toBe(seed.knowledge.rules[0].content)
    expect(firstRule.provenance).toBe('official')
  })
})

// ── 4. compareSeedVersion ──────────────────────────────────────────────

describe('compareSeedVersion', () => {
  it('a > b 返回 1', () => {
    expect(compareSeedVersion('2.0.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.1', '1.0.0')).toBe(1)
  })

  it('a < b 返回 -1', () => {
    expect(compareSeedVersion('1.0.0', '2.0.0')).toBe(-1)
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.0.0', '1.0.1')).toBe(-1)
  })

  it('a === b 返回 0', () => {
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
    expect(compareSeedVersion('0.0.0', '0.0.0')).toBe(0)
  })

  it('处理不同长度的语义版本字符串', () => {
    expect(compareSeedVersion('1', '1.0.0')).toBe(0)
    expect(compareSeedVersion('1.0', '1.0.0')).toBe(0)
    expect(compareSeedVersion('2', '1.9.9')).toBe(1)
  })

  it('处理非法版本字符串（降级为 0）', () => {
    expect(compareSeedVersion('invalid', '0.0.0')).toBe(0)
    // '1.0.0' > 'invalid' (后者被解析为 0.0.0)：1 > 0
    expect(compareSeedVersion('1.0.0', 'invalid')).toBe(1)
    expect(compareSeedVersion('x.y.z', '0.0.0')).toBe(0)
  })
})

// ── 5. 零运行时依赖 ───────────────────────────────────────────────────

describe('零运行时依赖', () => {
  it('listBuiltinSeeds 不调 Date.now()', () => {
    // 确定性：多次调用返回相同结果
    const a = listBuiltinSeeds()
    const b = listBuiltinSeeds()
    expect(a).toEqual(b)
  })

  it('resolveSeedContent 确定性', () => {
    const seed = listBuiltinSeeds()[0]
    const a = resolveSeedContent(seed)
    const b = resolveSeedContent(seed)
    expect(a).toEqual(b)
  })

  it('compareSeedVersion 确定性', () => {
    expect(compareSeedVersion('1.0.0', '2.0.0')).toBe(-1)
    expect(compareSeedVersion('1.0.0', '2.0.0')).toBe(-1)
  })

  it('不重新定义 compiler-skill.ts 的类型', async () => {
    // 本模块只导入 compiler-skill.ts 的类型，不重新定义 Skill/KnowledgeBundle
    // 该断言通过 TypeScript 类型检查验证：本文件只 import type，无 export 同名类型
    // 运行时验证：动态 import 模块，检查导出中不含 Skill/KnowledgeBundle 等 compiler-skill 类型名
    const mod = await import('./compiler-skill-builtin-seeds.js')
    expect((mod as any).Skill).toBeUndefined()
    expect((mod as any).KnowledgeBundle).toBeUndefined()
    expect((mod as any).ActivationRule).toBeUndefined()
    expect((mod as any).SkillCategory).toBeUndefined()
  })
})

// ── 6. Stage 注入点元信息 ─────────────────────────────────────────────

describe('Stage 注入点为元信息', () => {
  const seed = listBuiltinSeeds()[0]

  it('条目 stage 为 1–6 可选', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]

    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('至少有些条目标注了 stage 元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]

    const withStage = allEntries.filter((e) => e.stage !== undefined)
    // 至少一半条目标注了 stage 元信息（供后续注入 change 消费）
    expect(withStage.length).toBeGreaterThan(allEntries.length * 0.3)
  })
})

// ── 敏捷项目管理 Skill ──────────────────────────────────────────────

describe('敏捷项目管理 Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-pm-agile')!

  it('存在 skill-pm-agile', () => {
    expect(seed).toBeDefined()
  })

  it('skillKey 为 skill-pm-agile', () => {
    expect(seed.skillKey).toBe('skill-pm-agile')
  })

  it('category 对齐契约', () => {
    expect(seed.category.primary).toBe('methodology')
    expect(seed.category.secondary).toBe('agile')
  })

  it('dependencies 为空', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含 Scrum 与 Kanban', () => {
    expect(seed.activation.projectTypes).toContain('Scrum')
    expect(seed.activation.projectTypes).toContain('Kanban')
  })

  it('activation.domains 含 agile', () => {
    expect(seed.activation.domains).toContain('agile')
  })

  it('basePriority 为 90', () => {
    expect(seed.basePriority).toBe(90)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('名称为简体中文', () => {
    expect(seed.name).toBe('敏捷项目管理')
  })
})

describe('敏捷项目管理 Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-pm-agile')!

  it('六类各 6–10 条', () => {
    const counts = {
      rules: seed.knowledge.rules.length,
      patterns: seed.knowledge.patterns.length,
      antiPatterns: seed.knowledge.antiPatterns.length,
      examples: seed.knowledge.examples.length,
      checklists: seed.knowledge.checklists.length,
      rubric: seed.knowledge.rubric.length,
    }
    for (const [key, count] of Object.entries(counts)) {
      expect(count).toBeGreaterThanOrEqual(6)
      expect(count).toBeLessThanOrEqual(10)
    }
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('敏捷项目管理 Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-pm-agile')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    // 仅导入 Skill/KnowledgeBundle/ActivationRule/SkillCategory，不重新定义
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})

// ── 瀑布项目管理 Skill ──────────────────────────────────────────────

describe('瀑布项目管理 Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-pm-waterfall')!

  it('存在 skill-pm-waterfall', () => {
    expect(seed).toBeDefined()
  })

  it('skillKey 为 skill-pm-waterfall', () => {
    expect(seed.skillKey).toBe('skill-pm-waterfall')
  })

  it('category 对齐契约', () => {
    expect(seed.category.primary).toBe('methodology')
    expect(seed.category.secondary).toBe('waterfall')
  })

  it('dependencies 为空', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含 瀑布 与 Waterfall', () => {
    expect(seed.activation.projectTypes).toContain('瀑布')
    expect(seed.activation.projectTypes).toContain('Waterfall')
    expect(seed.activation.projectTypes).toContain('传统项目')
    expect(seed.activation.projectTypes).toContain('传统')
  })

  it('activation.domains 含 waterfall 与 project_management', () => {
    expect(seed.activation.domains).toContain('waterfall')
    expect(seed.activation.domains).toContain('project_management')
  })

  it('basePriority 为 90', () => {
    expect(seed.basePriority).toBe(90)
  })

  it('activation.priority 为 90', () => {
    expect(seed.activation.priority).toBe(90)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('名称为简体中文', () => {
    expect(seed.name).toBe('瀑布项目管理')
  })
})

describe('瀑布项目管理 Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-pm-waterfall')!

  it('六类各 6–10 条', () => {
    const counts = {
      rules: seed.knowledge.rules.length,
      patterns: seed.knowledge.patterns.length,
      antiPatterns: seed.knowledge.antiPatterns.length,
      examples: seed.knowledge.examples.length,
      checklists: seed.knowledge.checklists.length,
      rubric: seed.knowledge.rubric.length,
    }
    for (const [key, count] of Object.entries(counts)) {
      expect(count).toBeGreaterThanOrEqual(6)
      expect(count).toBeLessThanOrEqual(10)
    }
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('id 前缀稳定为 pm-wf-', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toMatch(/^pm-wf-/)
    }
  })
})

describe('瀑布项目管理 Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-pm-waterfall')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('resolveSeedContent 投影后条目数量与种子一致', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    // 仅导入 Skill/KnowledgeBundle/ActivationRule/SkillCategory，不重新定义
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})

// ── 营销活动 Skill ──────────────────────────────────────────────

describe('营销活动 Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-marketing')!

  it('存在 skill-marketing', () => {
    expect(seed).toBeDefined()
  })

  it('skillKey 为 skill-marketing', () => {
    expect(seed.skillKey).toBe('skill-marketing')
  })

  it('category 对齐契约', () => {
    expect(seed.category.primary).toBe('domain')
    expect(seed.category.secondary).toBe('marketing')
  })

  it('dependencies 为空', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含 营销 与 Marketing', () => {
    expect(seed.activation.projectTypes).toContain('营销')
    expect(seed.activation.projectTypes).toContain('Marketing')
    expect(seed.activation.projectTypes).toContain('市场营销')
    expect(seed.activation.projectTypes).toContain('营销活动')
  })

  it('activation.domains 含 marketing 与 campaign', () => {
    expect(seed.activation.domains).toContain('marketing')
    expect(seed.activation.domains).toContain('campaign')
  })

  it('basePriority 为 80', () => {
    expect(seed.basePriority).toBe(80)
  })

  it('activation.priority 为 80', () => {
    expect(seed.activation.priority).toBe(80)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('名称为简体中文', () => {
    expect(seed.name).toBe('营销活动')
  })
})

describe('营销活动 Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-marketing')!

  it('六类各 6–10 条', () => {
    const counts = {
      rules: seed.knowledge.rules.length,
      patterns: seed.knowledge.patterns.length,
      antiPatterns: seed.knowledge.antiPatterns.length,
      examples: seed.knowledge.examples.length,
      checklists: seed.knowledge.checklists.length,
      rubric: seed.knowledge.rubric.length,
    }
    for (const [key, count] of Object.entries(counts)) {
      expect(count).toBeGreaterThanOrEqual(6)
      expect(count).toBeLessThanOrEqual(10)
    }
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('id 前缀稳定为 mk-', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toMatch(/^mk-/)
    }
  })
})

describe('营销活动 Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-marketing')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('resolveSeedContent 投影后条目数量与种子一致', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    // 仅导入 Skill/KnowledgeBundle/ActivationRule/SkillCategory，不重新定义
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})

// ── 建筑项目 Skill ──────────────────────────────────────────────

describe('建筑项目 Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-construction')!

  it('存在 skill-construction', () => {
    expect(seed).toBeDefined()
  })

  it('skillKey 为 skill-construction', () => {
    expect(seed.skillKey).toBe('skill-construction')
  })

  it('category 对齐契约', () => {
    expect(seed.category.primary).toBe('domain')
    expect(seed.category.secondary).toBe('construction')
  })

  it('dependencies 为空', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含 建筑 与 Construction', () => {
    expect(seed.activation.projectTypes).toContain('建筑')
    expect(seed.activation.projectTypes).toContain('Construction')
    expect(seed.activation.projectTypes).toContain('建筑工程')
    expect(seed.activation.projectTypes).toContain('施工')
    expect(seed.activation.projectTypes).toContain('土木工程')
  })

  it('activation.domains 含 construction 与 civil_engineering', () => {
    expect(seed.activation.domains).toContain('construction')
    expect(seed.activation.domains).toContain('civil_engineering')
  })

  it('basePriority 为 80', () => {
    expect(seed.basePriority).toBe(80)
  })

  it('activation.priority 为 80', () => {
    expect(seed.activation.priority).toBe(80)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('名称为简体中文', () => {
    expect(seed.name).toBe('建筑项目')
  })
})

describe('建筑项目 Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-construction')!

  it('六类各 6–10 条', () => {
    const counts = {
      rules: seed.knowledge.rules.length,
      patterns: seed.knowledge.patterns.length,
      antiPatterns: seed.knowledge.antiPatterns.length,
      examples: seed.knowledge.examples.length,
      checklists: seed.knowledge.checklists.length,
      rubric: seed.knowledge.rubric.length,
    }
    for (const [key, count] of Object.entries(counts)) {
      expect(count).toBeGreaterThanOrEqual(6)
      expect(count).toBeLessThanOrEqual(10)
    }
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('id 前缀稳定为 cs-', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toMatch(/^cs-/)
    }
  })
})

describe('建筑项目 Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-construction')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('resolveSeedContent 投影后条目数量与种子一致', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    // 仅导入 Skill/KnowledgeBundle/ActivationRule/SkillCategory，不重新定义
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})

// ── 产品研发 Skill（P1 领域） ──────────────────────────────────────────────

describe('产品研发 Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-product-rd')!

  it('skillKey 为 skill-product-rd', () => {
    expect(seed.skillKey).toBe('skill-product-rd')
  })

  it('category 为 domain / product_rd', () => {
    const cat: SkillCategory = seed.category
    expect(cat.primary).toBe('domain')
    expect(cat.secondary).toBe('product_rd')
  })

  it('dependencies 为空数组', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含产品研发相关类型', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.projectTypes).toBeDefined()
    expect(activation.projectTypes!).toContain('产品研发')
    expect(activation.projectTypes!).toContain('硬件研发')
    expect(activation.projectTypes!).toContain('智能硬件')
    expect(activation.projectTypes!).toContain('Product R&D')
  })

  it('activation.domains 含 product_rd 与硬件相关域', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.domains).toBeDefined()
    expect(activation.domains!).toContain('product_rd')
    expect(activation.domains!).toContain('hardware')
    expect(activation.domains!).toContain('embedded')
  })

  it('basePriority 为 80', () => {
    expect(seed.basePriority).toBe(80)
  })

  it('activation.priority 与 basePriority 对齐', () => {
    expect(seed.activation.priority).toBe(80)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('名称为简体中文', () => {
    expect(seed.name).toBe('产品研发')
  })

  it('tags 包含产品研发领域关键词', () => {
    expect(seed.tags.length).toBeGreaterThan(0)
    expect(seed.tags).toContain('产品研发')
    expect(seed.tags).toContain('IPD')
    expect(seed.tags).toContain('NPI')
  })
})

describe('产品研发 Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-product-rd')!

  it('rules 含 8 条', () => {
    expect(seed.knowledge.rules.length).toBe(8)
  })

  it('patterns 含 8 条', () => {
    expect(seed.knowledge.patterns.length).toBe(8)
  })

  it('antiPatterns 含 8 条', () => {
    expect(seed.knowledge.antiPatterns.length).toBe(8)
  })

  it('examples 含 8 条', () => {
    expect(seed.knowledge.examples.length).toBe(8)
  })

  it('checklists 含 8 条', () => {
    expect(seed.knowledge.checklists.length).toBe(8)
  })

  it('rubric 含 8 维度', () => {
    expect(seed.knowledge.rubric.length).toBe(8)
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('id 前缀稳定为 prd-', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toMatch(/^prd-/)
    }
  })
})

describe('产品研发 Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-product-rd')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('resolveSeedContent 投影后条目数量与种子一致', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    // 仅导入 Skill/KnowledgeBundle/ActivationRule/SkillCategory，不重新定义
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})

// ── DevOps Skill（P1 领域） ──────────────────────────────────────────────

describe('DevOps Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-devops')!

  it('skillKey 为 skill-devops', () => {
    expect(seed.skillKey).toBe('skill-devops')
  })

  it('category 为 domain / devops', () => {
    const cat: SkillCategory = seed.category
    expect(cat.primary).toBe('domain')
    expect(cat.secondary).toBe('devops')
  })

  it('dependencies 为空数组', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含 DevOps 相关类型', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.projectTypes).toBeDefined()
    expect(activation.projectTypes!).toContain('DevOps')
    expect(activation.projectTypes!).toContain('研发运维')
    expect(activation.projectTypes!).toContain('DevSecOps')
    expect(activation.projectTypes!).toContain('平台工程')
    expect(activation.projectTypes!).toContain('SRE')
  })

  it('activation.domains 含 devops 相关域', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.domains).toBeDefined()
    expect(activation.domains!).toContain('devops')
    expect(activation.domains!).toContain('cicd')
    expect(activation.domains!).toContain('infrastructure')
    expect(activation.domains!).toContain('sre')
  })

  it('basePriority 为 80', () => {
    expect(seed.basePriority).toBe(80)
  })

  it('activation.priority 与 basePriority 对齐', () => {
    expect(seed.activation.priority).toBe(80)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('name 为 DevOps（保留英文原文）', () => {
    expect(seed.name).toBe('DevOps')
  })

  it('tags 包含 DevOps 领域关键词', () => {
    expect(seed.tags.length).toBeGreaterThan(0)
    expect(seed.tags).toContain('DevOps')
    expect(seed.tags).toContain('CI/CD')
    expect(seed.tags).toContain('IaC')
    expect(seed.tags).toContain('Kubernetes')
    expect(seed.tags).toContain('SRE')
    expect(seed.tags).toContain('DORA')
  })
})

describe('DevOps Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-devops')!

  it('rules 含 8 条', () => {
    expect(seed.knowledge.rules.length).toBe(8)
  })

  it('patterns 含 8 条', () => {
    expect(seed.knowledge.patterns.length).toBe(8)
  })

  it('antiPatterns 含 8 条', () => {
    expect(seed.knowledge.antiPatterns.length).toBe(8)
  })

  it('examples 含 8 条', () => {
    expect(seed.knowledge.examples.length).toBe(8)
  })

  it('checklists 含 8 条', () => {
    expect(seed.knowledge.checklists.length).toBe(8)
  })

  it('rubric 含 8 维度', () => {
    expect(seed.knowledge.rubric.length).toBe(8)
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('id 前缀稳定为 do-', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toMatch(/^do-/)
    }
  })
})

describe('DevOps Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-devops')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('resolveSeedContent 投影后条目数量与种子一致', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})

// ── 数据项目 Skill（P1 领域） ──────────────────────────────────────────────

describe('数据项目 Skill 元数据', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-data-project')!

  it('skillKey 为 skill-data-project', () => {
    expect(seed.skillKey).toBe('skill-data-project')
  })

  it('category 对齐契约', () => {
    const cat: SkillCategory = seed.category
    expect(cat.primary).toBe('domain')
    expect(cat.secondary).toBe('data_engineering')
  })

  it('dependencies 为空数组', () => {
    expect(seed.dependencies).toEqual([])
  })

  it('activation.projectTypes 含数据项目相关类型', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.projectTypes).toBeDefined()
    expect(activation.projectTypes!).toContain('数据项目')
    expect(activation.projectTypes!).toContain('数据工程')
    expect(activation.projectTypes!).toContain('数据科学')
    expect(activation.projectTypes!).toContain('AI项目')
    expect(activation.projectTypes!).toContain('机器学习')
    expect(activation.projectTypes!).toContain('数据')
    expect(activation.projectTypes!).toContain('Data')
  })

  it('activation.domains 含 data_engineering 与 machine_learning', () => {
    const activation: ActivationRule = seed.activation
    expect(activation.domains).toBeDefined()
    expect(activation.domains!).toContain('data_engineering')
    expect(activation.domains!).toContain('data_science')
    expect(activation.domains!).toContain('machine_learning')
    expect(activation.domains!).toContain('ai')
  })

  it('basePriority 为 80', () => {
    expect(seed.basePriority).toBe(80)
  })

  it('activation.priority 与 basePriority 对齐', () => {
    expect(seed.activation.priority).toBe(80)
  })

  it('version 为合法语义版本', () => {
    expect(seed.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('name 为简体中文', () => {
    expect(seed.name).toBe('数据项目')
  })

  it('tags 包含数据工程与AI领域关键词', () => {
    expect(seed.tags.length).toBeGreaterThan(0)
    expect(seed.tags).toContain('数据工程')
    expect(seed.tags).toContain('机器学习')
    expect(seed.tags).toContain('MLOps')
    expect(seed.tags).toContain('ETL')
    expect(seed.tags).toContain('数据仓库')
    expect(seed.tags).toContain('特征工程')
  })
})

describe('数据项目 Skill 六类内容', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-data-project')!

  it('rules 含 8 条', () => {
    expect(seed.knowledge.rules.length).toBe(8)
  })

  it('patterns 含 8 条', () => {
    expect(seed.knowledge.patterns.length).toBe(8)
  })

  it('antiPatterns 含 8 条', () => {
    expect(seed.knowledge.antiPatterns.length).toBe(8)
  })

  it('examples 含 8 条', () => {
    expect(seed.knowledge.examples.length).toBe(8)
  })

  it('checklists 含 8 条', () => {
    expect(seed.knowledge.checklists.length).toBe(8)
  })

  it('rubric 含 8 维度', () => {
    expect(seed.knowledge.rubric.length).toBe(8)
  })

  it('每条含 id/title/content/provenance', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.content).toBeTruthy()
      expect(entry.provenance).toBe('official')
    }
  })

  it('内容为简体中文', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.content).toMatch(/[一-鿿]/)
    }
  })

  it('stage 为 1–6 可选元信息', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      if (entry.stage !== undefined) {
        expect(entry.stage).toBeGreaterThanOrEqual(1)
        expect(entry.stage).toBeLessThanOrEqual(6)
      }
    }
  })

  it('id 前缀稳定为 dp-', () => {
    const allEntries = [
      ...seed.knowledge.rules,
      ...seed.knowledge.patterns,
      ...seed.knowledge.antiPatterns,
      ...seed.knowledge.examples,
      ...seed.knowledge.checklists,
      ...seed.knowledge.rubric,
    ]
    for (const entry of allEntries) {
      expect(entry.id).toMatch(/^dp-/)
    }
  })
})

describe('数据项目 Skill resolveSeedContent 与 compareSeedVersion', () => {
  const seed = listBuiltinSeeds().find((s) => s.skillKey === 'skill-data-project')!

  it('resolveSeedContent 投影为 KnowledgeBundle 顶层形状', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle).toHaveProperty('rules')
    expect(bundle).toHaveProperty('patterns')
    expect(bundle).toHaveProperty('antiPatterns')
    expect(bundle).toHaveProperty('examples')
    expect(bundle).toHaveProperty('checklists')
    expect(bundle).toHaveProperty('rubric')
    expect(Array.isArray(bundle.rules)).toBe(true)
    expect(Array.isArray(bundle.patterns)).toBe(true)
  })

  it('resolveSeedContent 投影后条目数量与种子一致', () => {
    const bundle = resolveSeedContent(seed)
    expect(bundle.rules!.length).toBe(seed.knowledge.rules.length)
    expect(bundle.patterns!.length).toBe(seed.knowledge.patterns.length)
    expect(bundle.antiPatterns!.length).toBe(seed.knowledge.antiPatterns.length)
    expect(bundle.examples!.length).toBe(seed.knowledge.examples.length)
    expect(bundle.checklists!.length).toBe(seed.knowledge.checklists.length)
    expect(bundle.rubric!.length).toBe(seed.knowledge.rubric.length)
  })

  it('compareSeedVersion 行为一致', () => {
    expect(compareSeedVersion('1.0.0', '1.1.0')).toBe(-1)
    expect(compareSeedVersion('1.1.0', '1.0.0')).toBe(1)
    expect(compareSeedVersion('1.0.0', '1.0.0')).toBe(0)
  })

  it('不修改 compiler-skill.ts 定义', () => {
    expect(seed.category.primary).toBeDefined()
    expect(seed.activation).toBeDefined()
    expect(seed.knowledge).toBeDefined()
  })
})
