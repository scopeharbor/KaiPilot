import { describe, expect, it } from 'vitest'
import {
  WIKI_MASKED_PLACEHOLDER,
  WIKI_PAGE_TEMPLATES,
  WIKI_PAGE_TYPES,
  WIKI_SOURCE_KINDS,
  classifyWikiRevision,
  maskWikiBody,
  normalizeWikiClaimStatement,
  parseWikiMarkdown,
  removeWikiClaim,
  renderWikiIndex,
  renderWikiLogLine,
  renderWikiMarkdown,
  truncateWikiSummary,
  unlinkWikiSlugs,
  type WikiParsedDocument,
} from './llm-wiki-memory.js'

const SAMPLE = [
  '---',
  'type: concept',
  'title: 灰度发布',
  'summary: 本公司「灰度」的含义',
  'staleAfterDays: 30',
  '---',
  '## 定义',
  '- 灰度指先对 5% 用户分批发布。[^c:gray-def]',
  '- 详见 [[release-process|发布流程]] 与 [[freeze-window]]。',
  '',
  '<!-- derived:release-stats -->',
  '- 近 90 天共灰度 12 次。[^c:gray-count]',
  '[^c:gray-count]: derived_query#release-stats',
  '<!-- /derived -->',
  '',
  '[^c:gray-def]: task#12, risk#3@v2 | valid:2026-09-01.. | kind:rule',
].join('\n')

function parseOk(source: string): WikiParsedDocument {
  const r = parseWikiMarkdown(source)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.doc
}

describe('llm-wiki-memory 枚举', () => {
  it('页面类型与来源类型无重复', () => {
    expect(new Set(WIKI_PAGE_TYPES).size).toBe(WIKI_PAGE_TYPES.length)
    expect(new Set(WIKI_SOURCE_KINDS).size).toBe(WIKI_SOURCE_KINDS.length)
  })
})

describe('parseWikiMarkdown', () => {
  it('解析 frontmatter、主张、链接、标题与派生段', () => {
    const doc = parseOk(SAMPLE)
    expect(doc.frontmatter).toEqual({
      type: 'concept',
      title: '灰度发布',
      summary: '本公司「灰度」的含义',
      staleAfterDays: 30,
    })
    expect(doc.headings).toEqual(['定义'])
    expect(doc.links.map((l) => [l.slug, l.text])).toEqual([
      ['release-process', '发布流程'],
      ['freeze-window', null],
    ])
    expect(doc.claims).toHaveLength(2)
    const def = doc.claims.find((c) => c.key === 'gray-def')!
    expect(def.statement).toBe('灰度指先对 5% 用户分批发布。')
    expect(def.sources).toEqual([
      { kind: 'task', id: '12', version: null },
      { kind: 'risk', id: '3', version: 'v2' },
    ])
    expect(def.validFrom).toBe('2026-09-01')
    expect(def.validTo).toBeNull()
    expect(def.kind).toBe('rule')
    expect(def.line).toBe(8)
    const count = doc.claims.find((c) => c.key === 'gray-count')!
    expect(count.derived).toBe(true)
    expect(count.kind).toBe('derived')
    expect(count.generatorId).toBe('release-stats')
    expect(doc.derivedBlocks).toHaveLength(1)
  })

  it('错误带行号且一次返回全部', () => {
    const r = parseWikiMarkdown(
      ['---', 'title: x', '---', '- 没有定义的主张[^c:a]', '[^c:b]: task#1', '- 坏链接 [[ ]]'].join(
        '\n',
      ),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    const messages = r.errors.map((e) => `${e.line}:${e.message}`)
    expect(messages.some((m) => m.startsWith('4:') && m.includes('缺少脚注定义'))).toBe(true)
    expect(messages.some((m) => m.startsWith('5:') && m.includes('没有在正文中被引用'))).toBe(true)
    expect(messages.some((m) => m.startsWith('6:'))).toBe(true)
  })

  it('非法来源、空来源、重复引用、未闭合派生段与代码块被拒', () => {
    const cases: Array<[string, string]> = [
      ['- a[^c:x]\n[^c:x]: email#1', '无法识别的来源'],
      ['- a[^c:x]\n[^c:x]: ', '至少需要一条来源'],
      ['- a[^c:x]\n- b[^c:x]\n[^c:x]: task#1', '只能出现一次'],
      ['<!-- derived:g -->\n- a', '派生段未闭合'],
      ['```\ncode', '代码块未闭合'],
      ['<!-- /derived -->', '没有对应的开始标记'],
      ['- a[^c:x]\n[^c:x]: task#1 | kind:derived', '不可用'],
      ['- a[^c:x]\n[^c:x]: task#1 | valid:2026/1/1..', '不是 YYYY-MM-DD'],
      ['---\ntitle: a', 'frontmatter 未闭合'],
      ['---\nbad line\n---', '无法解析'],
    ]
    for (const [source, expected] of cases) {
      const r = parseWikiMarkdown(source)
      expect(r.ok, source).toBe(false)
      if (!r.ok) expect(r.errors.map((e) => e.message).join('|'), source).toContain(expected)
    }
  })

  it('代码块中的标记与链接不解析', () => {
    const doc = parseOk('```\n[^c:x] [[nope]]\n```\n正文')
    expect(doc.claims).toHaveLength(0)
    expect(doc.links).toHaveLength(0)
  })

  it('模板全部可解析且不含主张', () => {
    for (const template of Object.values(WIKI_PAGE_TEMPLATES)) {
      const doc = parseOk(template!)
      expect(doc.claims).toHaveLength(0)
      expect(typeof doc.frontmatter.title).toBe('string')
    }
  })
})

describe('renderWikiMarkdown 往返稳定', () => {
  it('parse → render → parse 结果等价（确定性样本）', () => {
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const words = ['发布', '审批', 'API', '5%', '冻结：窗口', 'true', '42', ' 前后空格 ', '#号']
    for (let round = 0; round < 60; round++) {
      const fm: Record<string, string | number | boolean> = {
        type: 'concept',
        title: words[rand(words.length)],
        summary: words[rand(words.length)] + words[rand(words.length)],
      }
      if (rand(2)) fm.staleAfterDays = rand(100)
      if (rand(2)) fm.pinned = rand(2) === 1
      const n = rand(4)
      const lines = ['## 标题']
      const defs: string[] = []
      for (let i = 0; i < n; i++) {
        lines.push(`- ${words[rand(words.length)]}陈述${i}[^c:k${i}]`)
        defs.push(`[^c:k${i}]: task#${rand(50) + 1}`)
      }
      const body = [...lines, '', ...defs].join('\n')
      const first = parseOk(renderWikiMarkdown(fm, body))
      const second = parseOk(renderWikiMarkdown(first.frontmatter, first.body))
      expect(second.frontmatter).toEqual(first.frontmatter)
      expect(second.claims).toEqual(first.claims)
      expect(second.body).toBe(first.body)
      // 含首尾空白、冒号、# 或像数字/布尔的字符串会被加引号，原样往返
      expect(first.frontmatter).toEqual(fm)
    }
  })
})

describe('classifyWikiRevision', () => {
  const base = parseOk(SAMPLE)
  const registered = new Set(['release-stats'])

  it('新页面一律为知识修改', () => {
    expect(
      classifyWikiRevision(null, base, { authorKind: 'human', registeredGenerators: registered }),
    ).toBe('knowledge')
  })

  it('只改格式与链接为簿记修改', () => {
    const next = parseOk(
      SAMPLE.replace('[[release-process|发布流程]]', '发布流程').replace('## 定义', '### 定义'),
    )
    expect(
      classifyWikiRevision(base, next, { authorKind: 'ai', registeredGenerators: registered }),
    ).toBe('bookkeeping')
  })

  it('改了主张文字或来源即为知识修改（冒充簿记被降级）', () => {
    const changedText = parseOk(SAMPLE.replace('5%', '10%'))
    const changedSource = parseOk(SAMPLE.replace('task#12, risk#3@v2', 'task#12'))
    const changedProse = parseOk(SAMPLE.replace('详见', '另见'))
    const changedTitle = parseOk(SAMPLE.replace('title: 灰度发布', 'title: 灰度'))
    for (const next of [changedText, changedSource, changedProse, changedTitle]) {
      expect(
        classifyWikiRevision(base, next, {
          authorKind: 'system',
          registeredGenerators: registered,
        }),
      ).toBe('knowledge')
    }
  })

  it('派生段：系统改已登记生成器为簿记，人工改为知识，未登记生成器为知识', () => {
    const next = parseOk(SAMPLE.replace('共灰度 12 次', '共灰度 13 次'))
    expect(
      classifyWikiRevision(base, next, { authorKind: 'system', registeredGenerators: registered }),
    ).toBe('bookkeeping')
    expect(
      classifyWikiRevision(base, next, { authorKind: 'human', registeredGenerators: registered }),
    ).toBe('knowledge')
    expect(
      classifyWikiRevision(base, next, { authorKind: 'system', registeredGenerators: new Set() }),
    ).toBe('knowledge')
  })

  it('系统页只有系统作者为簿记', () => {
    expect(
      classifyWikiRevision(base, base, {
        authorKind: 'system',
        registeredGenerators: registered,
        systemPage: true,
      }),
    ).toBe('bookkeeping')
    expect(
      classifyWikiRevision(base, base, {
        authorKind: 'human',
        registeredGenerators: registered,
        systemPage: true,
      }),
    ).toBe('knowledge')
  })
})

describe('遮蔽、撤回与断链工具', () => {
  it('遮蔽整行并删去脚注定义，不留来源细节', () => {
    const masked = maskWikiBody(SAMPLE, new Set(['gray-def']))
    expect(masked).toContain(`- ${WIKI_MASKED_PLACEHOLDER}`)
    expect(masked).not.toContain('task#12')
    expect(masked).not.toContain('5% 用户')
    expect(maskWikiBody(SAMPLE, new Set())).toBe(SAMPLE)
  })

  it('removeWikiClaim 删除主张行与定义，结果仍可解析', () => {
    const next = removeWikiClaim(SAMPLE, 'gray-def')
    const doc = parseOk(next)
    expect(doc.claims.map((c) => c.key)).toEqual(['gray-count'])
  })

  it('unlinkWikiSlugs 把断链改为纯文字且语义不变', () => {
    const next = parseOk(unlinkWikiSlugs(SAMPLE, new Set(['freeze-window'])))
    expect(next.links.map((l) => l.slug)).toEqual(['release-process'])
    expect(
      classifyWikiRevision(parseOk(SAMPLE), next, {
        authorKind: 'system',
        registeredGenerators: new Set(),
      }),
    ).toBe('bookkeeping')
  })

  it('撤回指纹规范化：全半角、空白与标点不影响', () => {
    expect(normalizeWikiClaimStatement('灰度指先对５％用户 分批发布。')).toBe(
      normalizeWikiClaimStatement('灰度指先对5%用户分批发布'),
    )
    expect(normalizeWikiClaimStatement('A 1')).not.toBe(normalizeWikiClaimStatement('A 2'))
  })
})

describe('目录与日志', () => {
  const entries = [
    { slug: 'b', title: 'B 乙', summaryLine: '第二', pageType: 'concept' as const },
    { slug: 'a', title: 'A 甲', summaryLine: 'x'.repeat(100), pageType: 'concept' as const },
    { slug: 'o', title: '概览', summaryLine: '', pageType: 'overview' as const },
    { slug: 'idx', title: '目录', summaryLine: '', pageType: 'index' as const },
  ]

  it('确定性：同输入两次输出全等，与输入顺序无关', () => {
    const one = renderWikiIndex(entries)
    const two = renderWikiIndex([...entries].reverse())
    expect(one).toBe(two)
    expect(one).not.toContain('[[idx')
    expect(one.indexOf('## 概览')).toBeLessThan(one.indexOf('## 概念与术语'))
    expect(one.indexOf('[[a|A 甲]]')).toBeLessThan(one.indexOf('[[b|B 乙]]'))
    expect(parseWikiMarkdown(one).ok).toBe(true)
  })

  it('摘要超过 80 字被截断', () => {
    const line = renderWikiIndex(entries)
      .split('\n')
      .find((l) => l.includes('[[a|'))!
    const summary = line.split(' — ')[1]
    expect(Array.from(summary)).toHaveLength(80)
    expect(truncateWikiSummary('短')).toBe('短')
  })

  it('空空间输出占位', () => {
    expect(renderWikiIndex([])).toContain('（暂无页面）')
  })

  it('日志行使用统一前缀', () => {
    expect(renderWikiLogLine(new Date('2026-10-24T08:00:00Z'), 'publish', '发布  灰度发布')).toBe(
      '## [2026-10-24] publish | 发布 灰度发布',
    )
  })
})
