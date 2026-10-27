import { describe, expect, it } from 'vitest'
import {
  WIKI_PLAYBOOK_GENERATOR,
  WIKI_REFERENCE_CLASS_GENERATOR,
  cleanWikiDossierName,
  computeWikiReferenceClass,
  parseWikiPlaybookBlock,
  parseWikiReferenceClassBlock,
  renderWikiPlaybookBlock,
  renderWikiReferenceClassBlock,
  replaceWikiDerivedBlock,
  wikiDossierClassFor,
  wikiDossierPageBody,
  wikiDossierTitle,
  wikiPercentile,
  wikiPlaybookHasContent,
} from './llm-wiki-dossier.js'
import {
  classifyWikiRevision,
  isWikiPurelyDerivedDocument,
  parseWikiMarkdown,
  type WikiParsedDocument,
} from './llm-wiki-memory.js'

const REGISTERED = new Set([WIKI_REFERENCE_CLASS_GENERATOR, WIKI_PLAYBOOK_GENERATOR])

function parsed(source: string): WikiParsedDocument {
  const r = parseWikiMarkdown(source)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.doc
}

const samples = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ plannedDays: 2, actualDays: i + 1 }))

describe('参照类统计', () => {
  it('样本不足不产出；过滤非法样本', () => {
    expect(computeWikiReferenceClass(samples(7))).toBeNull()
    expect(computeWikiReferenceClass([...samples(7), { plannedDays: 0, actualDays: 3 }])).toBeNull()
  })

  it('中位数、P80（最近秩）与偏差', () => {
    const stats = computeWikiReferenceClass(samples(10))!
    expect(stats).toEqual({
      samples: 10,
      plannedMedianDays: 2,
      actualP50Days: 5.5,
      actualP80Days: 8,
      bias: 2.75,
    })
    expect(wikiPercentile([], 0.8)).toBe(0)
    expect(wikiPercentile([5], 0.8)).toBe(5)
  })
})

describe('派生段渲染与解析', () => {
  it('参照类往返一致', () => {
    const stats = computeWikiReferenceClass(samples(12))!
    const block = renderWikiReferenceClassBlock(stats)
    expect(parseWikiReferenceClassBlock(block.lines.join('\n'))).toEqual(stats)
    expect(parseWikiReferenceClassBlock('无关内容')).toBeNull()
  })

  it('打法往返一致、空列表省略、名称清洗', () => {
    const stats = {
      drafts: 3,
      removed: ['需求评审', '需求评审', '[[恶意]]、注入'],
      added: [],
      phases: ['规划', '开发'],
    }
    const block = renderWikiPlaybookBlock(stats)
    expect(block.lines.some((l) => l.includes('补上'))).toBe(false)
    expect(block.defs).toHaveLength(3)
    expect(parseWikiPlaybookBlock(block.lines.join('\n'))).toEqual({
      drafts: 3,
      removed: ['需求评审', '恶意/注入'],
      added: [],
      phases: ['规划', '开发'],
    })
    expect(cleanWikiDossierName('x'.repeat(60))).toHaveLength(40)
    expect(wikiPlaybookHasContent({ drafts: 2, removed: [], added: [' '], phases: [] })).toBe(false)
    expect(parseWikiPlaybookBlock('无')).toBeNull()
  })
})

describe('档案页与纯派生判定', () => {
  const rc = renderWikiReferenceClassBlock(computeWikiReferenceClass(samples(9))!)
  const page = wikiDossierPageBody('reference-class', 'software', rc)

  it('新页可解析、是纯派生、系统新建判为簿记，人或 AI 新建仍为知识', () => {
    const doc = parsed(page)
    expect(doc.frontmatter.title).toBe(wikiDossierTitle('reference-class', 'software'))
    expect(doc.claims.every((c) => c.derived)).toBe(true)
    expect(isWikiPurelyDerivedDocument(doc, REGISTERED)).toBe(true)
    expect(
      classifyWikiRevision(null, doc, { authorKind: 'system', registeredGenerators: REGISTERED }),
    ).toBe('bookkeeping')
    expect(
      classifyWikiRevision(null, doc, { authorKind: 'ai', registeredGenerators: REGISTERED }),
    ).toBe('knowledge')
    expect(isWikiPurelyDerivedDocument(doc, new Set())).toBe(false)
  })

  it('派生段外有正文或主张就不是纯派生', () => {
    const prose = parsed(
      page.replace('## 解读（人工补充，经审阅）', '## 解读（人工补充，经审阅）\n一段说明'),
    )
    expect(isWikiPurelyDerivedDocument(prose, REGISTERED)).toBe(false)
    const claim = parsed(
      page.replace(
        '## 解读（人工补充，经审阅）',
        '## 解读（人工补充，经审阅）\n- 返工多。[^c:h1]\n\n[^c:h1]: user_statement#1',
      ),
    )
    expect(isWikiPurelyDerivedDocument(claim, REGISTERED)).toBe(false)
    expect(
      isWikiPurelyDerivedDocument(parsed('---\ntype: concept\ntitle: x\n---\n## 无'), REGISTERED),
    ).toBe(false)
  })

  it('替换派生段保留人写解读，结果可解析且为簿记修改', () => {
    const withHuman = page
      .replace(
        '## 解读（人工补充，经审阅）\n',
        '## 解读（人工补充，经审阅）\n\n- 超期主要来自设计返工。[^c:h1]\n',
      )
      .replace(/\n$/, '\n[^c:h1]: user_statement#1\n')
    const base = parsed(withHuman)
    const next = renderWikiReferenceClassBlock(computeWikiReferenceClass(samples(20))!)
    const replaced = replaceWikiDerivedBlock(
      withHuman,
      WIKI_REFERENCE_CLASS_GENERATOR,
      next,
      'rc-',
    )!
    const doc = parsed(replaced)
    expect(doc.body).toContain('超期主要来自设计返工')
    expect(doc.body).toContain('已完成任务 20 个')
    expect(doc.claims.map((c) => c.key).sort()).toEqual([
      'h1',
      'rc-actual',
      'rc-bias',
      'rc-samples',
    ])
    expect(
      classifyWikiRevision(base, doc, { authorKind: 'system', registeredGenerators: REGISTERED }),
    ).toBe('bookkeeping')
    expect(replaceWikiDerivedBlock(withHuman, 'nope', next, 'rc-')).toBeNull()
    // 统计不变时正文不变
    expect(replaceWikiDerivedBlock(page, WIKI_REFERENCE_CLASS_GENERATOR, rc, 'rc-')).toBe(page)
  })

  it('打法派生段删除旧行的脚注', () => {
    const pb = renderWikiPlaybookBlock({ drafts: 2, removed: ['甲'], added: ['乙'], phases: [] })
    const body = wikiDossierPageBody('playbook', 'all', pb)
    const fewer = renderWikiPlaybookBlock({ drafts: 3, removed: ['甲'], added: [], phases: [] })
    const doc = parsed(replaceWikiDerivedBlock(body, WIKI_PLAYBOOK_GENERATOR, fewer, 'pb-')!)
    expect(doc.claims.map((c) => c.key).sort()).toEqual(['pb-drafts', 'pb-removed'])
  })

  it('项目类型映射到档案类别', () => {
    expect(wikiDossierClassFor('event')).toBe('event')
    expect(wikiDossierClassFor(null)).toBe('all')
  })
})
