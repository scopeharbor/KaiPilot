import { describe, expect, it } from 'vitest'
import {
  buildWikiAnswerPage,
  extractWikiSection,
  sanitizeWikiAnswerText,
  scoreWikiPageForQuery,
  wikiQueryTerms,
} from './llm-wiki-query.js'
import { parseWikiMarkdown } from './llm-wiki-memory.js'

describe('wikiQueryTerms', () => {
  it('ASCII 词 + 中文二元组，去重保序', () => {
    expect(wikiQueryTerms('API 证书延误？证书')).toEqual(['api', '证书', '书延', '延误'])
  })

  it('单字与单字符 ASCII 不成词；最多 40 个', () => {
    expect(wikiQueryTerms('a 我')).toEqual([])
    expect(wikiQueryTerms('一二三四五六七八九十'.repeat(10)).length).toBeLessThanOrEqual(40)
  })
})

describe('scoreWikiPageForQuery', () => {
  const page = {
    title: '证书教训',
    summary: '第三方证书相关经验',
    headings: ['教训', '应对'],
    claims: ['联调前先确认证书有效期。'],
  }

  it('标题 ×3、摘要 ×2、小标题 ×2、主张 ×1', () => {
    expect(scoreWikiPageForQuery(['证书'], page)).toBe(3 + 2 + 1)
    expect(scoreWikiPageForQuery(['教训'], page)).toBe(3 + 2)
    expect(scoreWikiPageForQuery(['有效'], page)).toBe(1)
  })

  it('零分不加项目简报加成；无词得零', () => {
    expect(scoreWikiPageForQuery(['无关'], page, { projectBrief: true })).toBe(0)
    expect(scoreWikiPageForQuery(['证书'], page, { projectBrief: true })).toBe(7)
    expect(scoreWikiPageForQuery([], page)).toBe(0)
  })
})

describe('extractWikiSection', () => {
  const body = '## 背景\n甲\n### 细节\n乙\n## 决定\n丙\n'
  it('取到下一个同级标题为止，含子标题', () => {
    expect(extractWikiSection(body, '背景')).toBe('## 背景\n甲\n### 细节\n乙')
    expect(extractWikiSection(body, '## 决定')).toBe('## 决定\n丙')
    expect(extractWikiSection(body, '细节')).toBe('### 细节\n乙')
  })
  it('找不到或空标题返回 null', () => {
    expect(extractWikiSection(body, '不存在')).toBeNull()
    expect(extractWikiSection(body, '  ')).toBeNull()
  })
})

describe('归档回答', () => {
  it('清除伪造的主张标记、脚注、维基链接与注释', () => {
    const dirty =
      '结论：见 [[cert]][^c:fake]。\n<!-- derived:x -->\n\n\n\n[^c:fake]: task#1 | kind:rule\n收尾'
    expect(sanitizeWikiAnswerText(dirty)).toBe('结论：见 cert。\n\n收尾')
  })

  it('成页可解析、无主张、类型为 answer、问题成引用块', () => {
    const source = buildWikiAnswerPage({
      title: '证书延误怎么办',
      question: '证书延误怎么办？\n第二行',
      answer: '## 小结\n- 提前两周申请[^c:x]\n\n[^c:x]: task#9 | kind:rule',
    })
    const r = parseWikiMarkdown(source)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc.frontmatter.type).toBe('answer')
    expect(r.doc.frontmatter.title).toBe('证书延误怎么办')
    expect(r.doc.claims).toHaveLength(0)
    expect(r.doc.links).toHaveLength(0)
    expect(r.doc.body).toContain('> 证书延误怎么办？\n> 第二行')
    expect(r.doc.headings).toEqual(['问题', '回答', '小结'])
  })

  it('标题为空时给默认标题', () => {
    const r = parseWikiMarkdown(buildWikiAnswerPage({ title: '  ', question: '问', answer: '答' }))
    expect(r.ok && r.doc.frontmatter.title).toBe('归档回答')
  })
})

describe('wikiPageHref', () => {
  it('组织 / 项目 / 个人有地址，部门暂无', async () => {
    const { wikiPageHref } = await import('./llm-wiki-query.js')
    expect(wikiPageHref('organization', 1, 5)).toBe('/next/wiki?page=5')
    expect(wikiPageHref('project', 9, 5)).toBe('/next/projects/9/wiki?page=5')
    expect(wikiPageHref('user', 3, 5)).toBe('/next/me/wiki?page=5')
    expect(wikiPageHref('department', 2, 5)).toBeNull()
  })
})
