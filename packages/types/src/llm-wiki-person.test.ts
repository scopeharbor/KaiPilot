import { describe, expect, it } from 'vitest'
import {
  WIKI_PERSON_ESTIMATE_GENERATOR,
  cleanWikiPreferenceStatement,
  computeWikiPersonEstimate,
  parseWikiPersonEstimateBlock,
  planWikiPreferenceImport,
  renderWikiPersonEstimateBlock,
  wikiPersonEstimatePageBody,
  wikiPersonPreferencesSkeleton,
} from './llm-wiki-person.js'
import {
  classifyWikiRevision,
  isWikiPurelyDerivedDocument,
  normalizeWikiClaimStatement,
  parseWikiMarkdown,
} from './llm-wiki-memory.js'

const REGISTERED = new Set([WIKI_PERSON_ESTIMATE_GENERATOR])
const sample = (plannedDays: number, actualDays: number) => ({ plannedDays, actualDays })

describe('个人估算校准', () => {
  it('样本不足 5 个不产出；无效样本不计', () => {
    expect(
      computeWikiPersonEstimate([sample(2, 3), sample(2, 2), sample(1, 1), sample(3, 4)]),
    ).toBeNull()
    expect(
      computeWikiPersonEstimate([
        sample(2, 3),
        sample(2, 2),
        sample(1, 1),
        sample(3, 4),
        sample(0, 3),
        sample(2, Number.NaN),
      ]),
    ).toBeNull()
  })

  it('中位数、P80、偏差与按时比例', () => {
    const stats = computeWikiPersonEstimate([
      sample(2, 2),
      sample(2, 3),
      sample(2, 4),
      sample(4, 4),
      sample(4, 6),
    ])!
    expect(stats).toEqual({
      samples: 5,
      plannedMedianDays: 2,
      actualP50Days: 4,
      actualP80Days: 4,
      bias: 1.5,
      onTimeShare: 40,
    })
  })

  it('渲染与解析往返一致；页面是纯派生、系统作者按簿记发布，且不含他人比较字样', () => {
    const stats = computeWikiPersonEstimate([
      sample(2, 3),
      sample(1, 1),
      sample(3, 5),
      sample(2, 2),
      sample(5, 7),
      sample(1.5, 2),
    ])!
    const block = renderWikiPersonEstimateBlock(stats)
    expect(parseWikiPersonEstimateBlock(block.lines.join('\n'))).toEqual(stats)
    expect(parseWikiPersonEstimateBlock('无关')).toBeNull()
    const body = wikiPersonEstimatePageBody(block)
    expect(block.lines.join('\n')).not.toMatch(/排名|平均|同事|团队|他人/)
    const doc = parseWikiMarkdown(body)
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    expect(doc.doc.frontmatter.type).toBe('person')
    expect(String(doc.doc.frontmatter.summary)).toContain('不用于考核或排名')
    expect(isWikiPurelyDerivedDocument(doc.doc, REGISTERED)).toBe(true)
    expect(
      classifyWikiRevision(null, doc.doc, {
        authorKind: 'system',
        registeredGenerators: REGISTERED,
      }),
    ).toBe('bookkeeping')
  })
})

describe('偏好导入', () => {
  const none = () => false

  it('清洗：去标记与换行、补句号、拒绝禁止类别与超长', () => {
    expect(cleanWikiPreferenceStatement('  周报用表格\n不要 emoji ')).toBe(
      '周报用表格 不要 emoji。',
    )
    expect(cleanWikiPreferenceStatement('喜欢简短回答。[^c:x]')).toBe('喜欢简短回答。')
    expect(cleanWikiPreferenceStatement('   ')).toBeNull()
    expect(cleanWikiPreferenceStatement('长'.repeat(201))).toBeNull()
    expect(cleanWikiPreferenceStatement('password: hunter2')).toBeNull()
    expect(cleanWikiPreferenceStatement('最近身体健康不好，少安排加班')).toBeNull()
    expect(cleanWikiPreferenceStatement('周五要接孩子，下午不排会')).toBeNull()
  })

  it('在骨架上成文：偏好主张、来源为本人陈述、可解析', () => {
    const plan = planWikiPreferenceImport({
      baseSource: wikiPersonPreferencesSkeleton(),
      summaries: ['周报用表格', '回复用中文', '周报用表格。'],
      userId: 7,
      isRetracted: none,
    })
    expect(plan.imported).toEqual(['周报用表格。', '回复用中文。'])
    expect(plan.skipped).toBe(1)
    const doc = parseWikiMarkdown(plan.body!)
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    expect(doc.doc.claims.map((c) => c.kind)).toEqual(['preference', 'preference'])
    expect(doc.doc.claims[0]!.sources).toEqual([{ kind: 'user_statement', id: '7', version: null }])
    expect(doc.doc.headings).toEqual(['偏好'])
  })

  it('已有说法与已撤回的跳过；没有新条目时不成文；键随陈述稳定', () => {
    const first = planWikiPreferenceImport({
      baseSource: wikiPersonPreferencesSkeleton(),
      summaries: ['周报用表格'],
      userId: 7,
      isRetracted: none,
    })
    const again = planWikiPreferenceImport({
      baseSource: first.body!,
      summaries: ['周报用表格', '不要 emoji', '开会前一天提醒'],
      userId: 7,
      isRetracted: (s) =>
        normalizeWikiClaimStatement(s) === normalizeWikiClaimStatement('不要 emoji。'),
    })
    expect(again.imported).toEqual(['开会前一天提醒。'])
    expect(again.skipped).toBe(2)
    const doc = parseWikiMarkdown(again.body!)
    expect(doc.ok && doc.doc.claims.map((c) => c.statement)).toEqual([
      '周报用表格。',
      '开会前一天提醒。',
    ])
    const keyOf = (body: string) =>
      /\[\^c:(mem-[^\]]+)\]/.exec(body.slice(body.indexOf('周报用表格')))![1]
    expect(keyOf(again.body!)).toBe(keyOf(first.body!))
    expect(
      planWikiPreferenceImport({
        baseSource: first.body!,
        summaries: ['周报用表格'],
        userId: 7,
        isRetracted: none,
      }).body,
    ).toBeNull()
  })

  it('页面缺少偏好章节时补上', () => {
    const base =
      '---\ntype: person\ntitle: 我的工作偏好\n---\n## 别的\n- 已有说明。[^c:a]\n\n[^c:a]: user_statement#7\n'
    const plan = planWikiPreferenceImport({
      baseSource: base,
      summaries: ['周报用表格'],
      userId: 7,
      isRetracted: none,
    })
    const doc = parseWikiMarkdown(plan.body!)
    expect(doc.ok && doc.doc.headings).toEqual(['别的', '偏好'])
    expect(doc.ok && doc.doc.claims).toHaveLength(2)
  })
})
