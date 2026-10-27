import { describe, expect, it } from 'vitest'
import {
  WIKI_RETROSPECTIVE_GENERATOR,
  cleanWikiRetrospectiveTaskName,
  computeWikiRetrospective,
  parseWikiRetrospectiveBlock,
  planWikiLessonPromotion,
  recallWikiLessons,
  renderWikiRetrospectiveBlock,
  wikiLessonCore,
  wikiLessonSectionOf,
  wikiLessonsSkeleton,
  wikiRetrospectivePageBody,
  type WikiRetrospectiveInput,
} from './llm-wiki-retrospective.js'
import {
  classifyWikiRevision,
  isWikiPurelyDerivedDocument,
  parseWikiMarkdown,
} from './llm-wiki-memory.js'

const task = (
  name: string,
  plannedEnd: string | null,
  actualEnd: string | null,
  completed = true,
) => ({
  name,
  completed,
  plannedEnd,
  actualEnd,
})

const INPUT: WikiRetrospectiveInput = {
  plannedStart: '2026-09-01',
  plannedEnd: '2026-10-15',
  actualEnd: '2026-10-22T08:00:00.000Z',
  tasks: [
    task('需求评审', '2026-09-05', '2026-09-05'),
    task('支付联调', '2026-09-20', '2026-10-02'),
    task('证书申请', '2026-09-10', '2026-09-19'),
    task('压测', '2026-10-01', '2026-10-04'),
    task('上线', '2026-10-15', null, false),
  ],
  riskStatuses: ['closed', 'resolved', 'identified', 'mitigating'],
  changes: [
    { submitted: true, approved: true },
    { submitted: true, approved: false },
    { submitted: false, approved: false },
  ],
}

describe('复盘统计', () => {
  it('任务为 0 不产出；按期比例、延误中位数与最多的 3 个', () => {
    expect(computeWikiRetrospective({ ...INPUT, tasks: [] })).toBeNull()
    const s = computeWikiRetrospective(INPUT)!
    expect(s).toMatchObject({
      plannedEnd: '2026-10-15',
      actualEnd: '2026-10-22',
      scheduleSlipDays: 7,
      tasksTotal: 5,
      tasksCompleted: 4,
      measured: 4,
      onTimeShare: 25,
      lateCount: 3,
      lateP50Days: 9,
      changesTotal: 2,
      changesApproved: 1,
      risksTotal: 4,
      risksClosed: 2,
    })
    expect(s.topLate).toEqual([
      { name: '支付联调', days: 12 },
      { name: '证书申请', days: 9 },
      { name: '压测', days: 3 },
    ])
  })

  it('渲染与解析往返一致（含提前、无延误、缺日期）', () => {
    const cases: WikiRetrospectiveInput[] = [
      INPUT,
      { ...INPUT, actualEnd: '2026-10-10', tasks: [task('甲', '2026-09-05', '2026-09-04')] },
      {
        ...INPUT,
        plannedStart: null,
        plannedEnd: null,
        actualEnd: null,
        tasks: [task('乙', null, null)],
      },
      { ...INPUT, plannedEnd: '2026-10-15', actualEnd: '2026-10-15' },
    ]
    for (const input of cases) {
      const stats = computeWikiRetrospective(input)!
      const block = renderWikiRetrospectiveBlock(stats)
      expect(parseWikiRetrospectiveBlock(block.lines.join('\n'))).toEqual(stats)
    }
    expect(parseWikiRetrospectiveBlock('无关')).toBeNull()
    const early = renderWikiRetrospectiveBlock(computeWikiRetrospective(cases[1]!)!)
    expect(early.lines[0]).toContain('比计划提前 5 天')
    expect(early.lines[2]).toContain('没有延误的任务')
    const none = renderWikiRetrospectiveBlock(computeWikiRetrospective(cases[2]!)!)
    expect(none.lines[0]).toContain('没有记录计划起止日；没有记录实际结束日')
    expect(none.lines[1]).toContain('没有同时记录计划与实际完成日的任务')
    expect(renderWikiRetrospectiveBlock(computeWikiRetrospective(cases[3]!)!).lines[0]).toContain(
      '，按期。',
    )
  })

  it('页面是纯派生、系统作者按簿记发布；任务名清洗', () => {
    const body = wikiRetrospectivePageBody(
      renderWikiRetrospectiveBlock(computeWikiRetrospective(INPUT)!),
    )
    const doc = parseWikiMarkdown(body)
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    expect(doc.doc.frontmatter.type).toBe('lesson')
    expect(doc.doc.headings).toEqual(['计划与实际（确定性派生，勿手改）', '教训（经审阅）'])
    const registered = new Set([WIKI_RETROSPECTIVE_GENERATOR])
    expect(isWikiPurelyDerivedDocument(doc.doc, registered)).toBe(true)
    expect(
      classifyWikiRevision(null, doc.doc, {
        authorKind: 'system',
        registeredGenerators: registered,
      }),
    ).toBe('bookkeeping')
    expect(cleanWikiRetrospectiveTaskName('「联调」[[x]]\n[^c:k]测试')).toBe('联调x 测试')
    expect(cleanWikiRetrospectiveTaskName('长'.repeat(40))).toHaveLength(30)
    expect(cleanWikiRetrospectiveTaskName('  ')).toBe('未命名任务')
  })
})

describe('组织教训库晋升', () => {
  it('按类型归入章节、注明来源；同一教训再次晋升返回 null', () => {
    const first = planWikiLessonPromotion({
      baseSource: wikiLessonsSkeleton(),
      statement: '证书申请要预留 3 周。',
      promotedBy: 9,
      projectName: '支付改造',
      section: wikiLessonSectionOf('software'),
    })!
    const doc = parseWikiMarkdown(first)
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    expect(doc.doc.headings).toEqual(['软件类'])
    expect(doc.doc.claims[0]!.statement).toBe('证书申请要预留 3 周（来自「支付改造」复盘）。')
    expect(doc.doc.claims[0]!.sources).toEqual([{ kind: 'user_statement', id: '9', version: null }])
    expect(doc.doc.claims[0]!.kind).toBe('inference')

    expect(
      planWikiLessonPromotion({
        baseSource: first,
        statement: '证书申请要预留 3 周',
        promotedBy: 12,
        projectName: '别的项目',
        section: '软件类',
      }),
    ).toBeNull()

    const second = planWikiLessonPromotion({
      baseSource: first,
      statement: '活动物料提前两周下单。',
      promotedBy: 12,
      projectName: '年会',
      section: wikiLessonSectionOf('event'),
    })!
    const doc2 = parseWikiMarkdown(second)
    expect(doc2.ok && doc2.doc.headings).toEqual(['软件类', '活动类'])
    expect(doc2.ok && doc2.doc.claims.map((c) => c.statement)).toEqual([
      '证书申请要预留 3 周（来自「支付改造」复盘）。',
      '活动物料提前两周下单（来自「年会」复盘）。',
    ])
    const third = planWikiLessonPromotion({
      baseSource: second,
      statement: '接口文档先于开发冻结。',
      promotedBy: 9,
      projectName: '支付改造',
      section: '软件类',
    })!
    const doc3 = parseWikiMarkdown(third)
    expect(doc3.ok && doc3.doc.claims.map((c) => c.statement.slice(0, 4))).toEqual([
      '证书申请',
      '接口文档',
      '活动物料',
    ])
    expect(wikiLessonSectionOf(null)).toBe('全组织')
    expect(
      planWikiLessonPromotion({
        baseSource: wikiLessonsSkeleton(),
        statement: '。',
        promotedBy: 1,
        projectName: 'x',
        section: '全组织',
      }),
    ).toBeNull()
    expect(() =>
      planWikiLessonPromotion({
        baseSource: '---\n坏',
        statement: '甲',
        promotedBy: 1,
        projectName: 'x',
        section: '全组织',
      }),
    ).toThrow()
  })
})

describe('教训召回', () => {
  const lessons = [
    { claimId: 1, statement: '证书申请要预留 3 周（来自「支付改造」复盘）。', section: '软件类' },
    { claimId: 2, statement: '活动物料提前两周下单。', section: '活动类' },
    { claimId: 3, statement: '第三方证书续期要提前确认负责人。', section: '全组织' },
    { claimId: 4, statement: 'API 网关 timeout 要压测验证。', section: '软件类' },
  ]

  it('关键词重合达到阈值才召回；同类型与全组织加分；来源后缀不参与匹配', () => {
    const hits = recallWikiLessons(lessons, { query: '第三方证书申请延误', section: '软件类' })
    expect(hits.map((h) => h.claimId)).toEqual([3, 1])
    expect(recallWikiLessons(lessons, { query: '支付改造', section: null })).toEqual([])
    expect(recallWikiLessons(lessons, { query: 'gateway timeout API', section: '软件类' })).toEqual(
      [expect.objectContaining({ claimId: 4, score: 3 })],
    )
    expect(recallWikiLessons(lessons, { query: '   ', section: null })).toEqual([])
    expect(
      recallWikiLessons(lessons, {
        query: '证书申请 证书续期 第三方证书',
        section: null,
        limit: 1,
      }),
    ).toHaveLength(1)
    expect(wikiLessonCore('教训（来自「甲」复盘）。')).toBe('教训')
  })
})
