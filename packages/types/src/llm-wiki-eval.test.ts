import { describe, expect, it } from 'vitest'
import {
  computeWikiEvalBacktest,
  parseWikiEvalQuestions,
  scoreWikiEvalContext,
  summarizeWikiEvalQa,
  wikiEvalGate,
  type WikiEvalBacktestSummary,
  type WikiEvalQaSummary,
} from './llm-wiki-eval.js'

const q = (expect: string[], forbid: string[] = []) => ({
  question: '上线要几个人审批？',
  expect,
  forbid,
})

describe('问答集解析', () => {
  it('合法输入；forbid 可省略；projectId 可选', () => {
    const out = parseWikiEvalQuestions([
      { question: ' 上线要几个人审批？ ', expect: ['双人审批'] },
      { question: '证书', expect: ['三周'], forbid: ['薪资'], projectId: 9 },
    ])
    expect(out).toEqual({
      ok: true,
      questions: [
        { question: '上线要几个人审批？', expect: ['双人审批'], forbid: [] },
        { question: '证书', expect: ['三周'], forbid: ['薪资'], projectId: 9 },
      ],
    })
  })

  it('逐项给出不合规原因', () => {
    const reason = (input: unknown) => {
      const r = parseWikiEvalQuestions(input)
      return r.ok ? null : r.reason
    }
    expect(reason({})).toBe('问答集必须是非空数组')
    expect(reason([])).toBe('问答集必须是非空数组')
    expect(reason(Array.from({ length: 51 }, () => q(['a'])))).toContain('最多 50 题')
    expect(reason([1])).toBe('第 1 题格式不对')
    expect(reason([{ question: '', expect: ['a'] }])).toContain('question')
    expect(reason([{ question: '长'.repeat(301), expect: ['a'] }])).toContain('question')
    expect(reason([{ question: 'x', expect: [] }])).toContain('expect')
    expect(reason([{ question: 'x', expect: [''] }])).toContain('expect')
    expect(reason([{ question: 'x', expect: ['a'], forbid: 'b' }])).toContain('forbid')
    expect(reason([{ question: 'x', expect: ['a'], projectId: 1.5 }])).toContain('projectId')
    expect(parseWikiEvalQuestions([{ question: 'x', expect: ['a'], projectId: null }]).ok).toBe(
      true,
    )
  })
})

describe('打分与汇总', () => {
  it('忽略大小写与空白；全部要点出现才算命中；禁止内容即泄露', () => {
    expect(
      scoreWikiEvalContext('上线需 双人 审批，API Gateway', q(['双人审批', 'api gateway'])),
    ).toEqual({
      hit: true,
      leaked: false,
      recall: 1,
    })
    expect(scoreWikiEvalContext('上线需双人审批', q(['双人审批', '周五']))).toEqual({
      hit: false,
      leaked: false,
      recall: 0.5,
    })
    expect(scoreWikiEvalContext('双人审批；薪资按季调', q(['双人审批'], ['薪资']))).toMatchObject({
      hit: true,
      leaked: true,
    })
  })

  it('两条路径分别汇总：泄露的命中不计为正确', () => {
    const s = summarizeWikiEvalQa([
      {
        legacy: { hit: false, leaked: false, recall: 0, bytes: 100 },
        wiki: { hit: true, leaked: false, recall: 1, bytes: 300 },
      },
      {
        legacy: { hit: true, leaked: true, recall: 1, bytes: 200 },
        wiki: { hit: true, leaked: false, recall: 1, bytes: 500 },
      },
      {
        legacy: { hit: true, leaked: false, recall: 1, bytes: 0 },
        wiki: { hit: false, leaked: false, recall: 0.5, bytes: 100 },
      },
    ])
    expect(s).toEqual({
      questions: 3,
      legacy: { correct: 1, correctRate: 0.33, avgRecall: 0.67, leaks: 1, avgBytes: 100 },
      wiki: { correct: 2, correctRate: 0.67, avgRecall: 0.83, leaks: 0, avgBytes: 300 },
    })
    expect(summarizeWikiEvalQa([]).wiki).toEqual({
      correct: 0,
      correctRate: 0,
      avgRecall: 0,
      leaks: 0,
      avgBytes: 0,
    })
  })
})

describe('计划回测', () => {
  it('三种方法的 MAPE 与 P80 覆盖；没有系数视为 1；无效任务与空项目不计', () => {
    const s = computeWikiEvalBacktest([
      {
        tasks: [
          { plannedDays: 2, actualDays: 3 },
          { plannedDays: 4, actualDays: 6 },
          { plannedDays: 0, actualDays: 3 },
        ],
        legacy: { factor: 1.5, p80Ratio: null },
        wiki: { factor: 1.25, p80Ratio: 2 },
      },
      {
        tasks: [],
        legacy: { factor: null, p80Ratio: null },
        wiki: { factor: null, p80Ratio: null },
      },
    ])
    expect(s.projects).toBe(1)
    expect(s.tasks).toBe(2)
    expect(s.methods.baseline).toEqual({ mape: 0.33, p80Coverage: 0 })
    expect(s.methods.legacy).toEqual({ mape: 0, p80Coverage: 100 })
    expect(s.methods.wiki).toEqual({ mape: 0.17, p80Coverage: 100 })
    expect(computeWikiEvalBacktest([]).methods.wiki).toEqual({ mape: 0, p80Coverage: 0 })
  })
})

describe('门禁', () => {
  const path = (correctRate: number, leaks = 0) => ({
    correct: 0,
    correctRate,
    avgRecall: 0,
    leaks,
    avgBytes: 0,
  })
  const qa = (questions: number, legacy: number, wiki: number, leaks = 0): WikiEvalQaSummary => ({
    questions,
    legacy: path(legacy),
    wiki: path(wiki, leaks),
  })
  const bt = (projects: number, legacyMape: number, wikiMape: number): WikiEvalBacktestSummary => ({
    projects,
    tasks: projects * 3,
    methods: {
      baseline: { mape: 0.5, p80Coverage: 40 },
      legacy: { mape: legacyMape, p80Coverage: 70 },
      wiki: { mape: wikiMape, p80Coverage: 70 },
    },
  })

  it('通过', () => {
    expect(wikiEvalGate(qa(5, 0.4, 0.6), bt(3, 0.2, 0.2))).toEqual({
      status: 'passed',
      reasons: ['维基路径无泄露，问答正确率与回测工期误差都不劣于旧路径'],
    })
  })

  it('泄露、正确率退步、回测误差退步都不通过，并附上数据不足原因', () => {
    const g = wikiEvalGate(qa(4, 0.6, 0.4, 1), bt(2, 0.2, 0.3))
    expect(g.status).toBe('failed')
    expect(g.reasons).toEqual([
      '维基路径有 1 题出现了不该出现的内容（泄露）',
      '维基路径问答正确率 40% 低于旧检索 60%',
      '维基参照类的回测工期误差 30% 高于现场计算 20%',
      '问答集只有 4 题，至少需要 5 题',
      '可回测的已完成项目只有 2 个，至少需要 3 个',
    ])
  })

  it('数据不足', () => {
    expect(wikiEvalGate(qa(4, 0.4, 0.6), bt(3, 0.2, 0.1)).status).toBe('insufficient')
    expect(wikiEvalGate(qa(5, 0.4, 0.6), bt(0, 0, 0))).toEqual({
      status: 'insufficient',
      reasons: ['可回测的已完成项目只有 0 个，至少需要 3 个'],
    })
  })
})
