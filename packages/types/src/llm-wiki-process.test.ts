import { describe, expect, it } from 'vitest'
import { replaceWikiDerivedBlock } from './llm-wiki-dossier.js'
import {
  WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR,
  WIKI_PROCESS_TASK_FLOW_GENERATOR,
  computeWikiChangeApproval,
  computeWikiTaskFlow,
  parseWikiChangeApprovalBlock,
  parseWikiTaskFlowBlock,
  renderWikiChangeApprovalBlock,
  renderWikiTaskFlowBlock,
  wikiProcessKindOfSlug,
  wikiProcessPageBody,
  wikiProcessSlug,
  wikiSectionOfLine,
  type WikiProcessTransition,
} from './llm-wiki-process.js'
import {
  classifyWikiRevision,
  isWikiPurelyDerivedDocument,
  parseWikiMarkdown,
} from './llm-wiki-memory.js'

const DAY = 86_400_000
const REGISTERED = new Set([
  WIKI_PROCESS_TASK_FLOW_GENERATOR,
  WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR,
])

/** 一个任务按给定状态序列流转，每步间隔 stepDays 天。 */
function flow(id: number, statuses: string[], stepDays = 1, start = 0): WikiProcessTransition[] {
  const out: WikiProcessTransition[] = []
  for (let i = 1; i < statuses.length; i++)
    out.push({
      entityId: id,
      at: start + i * stepDays * DAY,
      from: statuses[i - 1]!,
      to: statuses[i]!,
    })
  return out
}

const SIMPLE = ['not_started', 'in_progress', 'completed']
const REOPENED = ['not_started', 'in_progress', 'completed', 'in_progress', 'completed']
const BLOCKED = ['not_started', 'in_progress', 'blocked', 'in_progress', 'completed']

describe('任务流转统计', () => {
  it('样本不足 8 个不产出', () => {
    const events = Array.from({ length: 7 }, (_, i) => flow(i + 1, SIMPLE)).flat()
    expect(computeWikiTaskFlow(events)).toBeNull()
  })

  it('路径频次、返工率、平均轮数、受阻率与停留分位', () => {
    const events = [
      ...Array.from({ length: 7 }, (_, i) => flow(i + 1, SIMPLE, 2)),
      flow(8, REOPENED),
      flow(9, REOPENED),
      flow(10, BLOCKED, 3),
      // 未完成的任务不算样本，但停留区间计入
      flow(11, ['not_started', 'in_progress', 'blocked'], 5),
    ].flat()
    const stats = computeWikiTaskFlow(events)!
    expect(stats.samples).toBe(10)
    expect(stats.paths[0]).toEqual({ label: '未开始 → 进行中 → 已完成', share: 70 })
    expect(stats.paths.map((p) => p.label)).toContain('未开始 → 进行中 → 已完成 → 进行中 → 已完成')
    expect(stats.reworkRate).toBe(20)
    expect(stats.rounds).toBe(1.2)
    expect(stats.blockedRate).toBe(10)
    const inProgress = stats.dwell.find((d) => d.status === 'in_progress')!
    expect(inProgress.p50Days).toBe(2)
    // 受阻区间只有 1 个闭合（任务 11 仍在受阻），不足 3 个不报告
    expect(stats.dwell.some((d) => d.status === 'blocked')).toBe(false)
  })

  it('退回未开始也算返工；长路径截断；同频按文字排序', () => {
    const long = [
      'not_started',
      'in_progress',
      'on_hold',
      'in_progress',
      'blocked',
      'in_progress',
      'on_hold',
      'in_progress',
      'completed',
    ]
    const events = [
      ...Array.from({ length: 7 }, (_, i) => flow(i + 1, SIMPLE)),
      flow(8, ['not_started', 'in_progress', 'not_started', 'in_progress', 'completed']),
      flow(9, long),
    ].flat()
    const stats = computeWikiTaskFlow(events)!
    expect(stats.reworkRate).toBe(Math.round(100 / 9))
    expect(stats.paths.map((p) => p.label)).toContain(
      '未开始 → 进行中 → 暂停 → 进行中 → 受阻 → … → 已完成',
    )
    expect(stats.blockedRate).toBe(Math.round(100 / 9))
    // 多次进出「暂停」：区间 ≥3 才报告，这里只有 2 个
    expect(stats.dwell.map((d) => d.status)).toEqual(['in_progress'])
  })

  it('渲染与解析往返一致；无停留时省略该行', () => {
    const stats = computeWikiTaskFlow(
      [...Array.from({ length: 8 }, (_, i) => flow(i + 1, SIMPLE, 1.5)), flow(9, BLOCKED)].flat(),
    )!
    const block = renderWikiTaskFlowBlock(stats)
    expect(parseWikiTaskFlowBlock(block.lines.join('\n'))).toEqual(stats)
    const noDwell = renderWikiTaskFlowBlock({ ...stats, dwell: [] })
    expect(noDwell.lines.some((l) => l.includes('停留'))).toBe(false)
    expect(noDwell.defs).toHaveLength(4)
    expect(parseWikiTaskFlowBlock(noDwell.lines.join('\n'))!.dwell).toEqual([])
    expect(parseWikiTaskFlowBlock('无关内容')).toBeNull()
  })

  it('乱序与非法时间戳的事件被正确处理', () => {
    const events = Array.from({ length: 8 }, (_, i) => flow(i + 1, SIMPLE))
      .flat()
      .reverse()
    events.push({ entityId: 99, at: Number.NaN, from: 'not_started', to: 'completed' })
    const stats = computeWikiTaskFlow(events)!
    expect(stats.samples).toBe(8)
    expect(stats.paths).toEqual([{ label: '未开始 → 进行中 → 已完成', share: 100 }])
  })
})

/** 变更请求：提交后 waitDays 天得出结论。 */
function cr(id: number, steps: Array<[string, number]>): WikiProcessTransition[] {
  let at = 0
  let prev: string | null = 'draft'
  return steps.map(([to, after]) => {
    at += after * DAY
    const t = { entityId: id, at, from: prev, to }
    prev = to
    return t
  })
}

describe('变更审批统计', () => {
  it('样本不足 5 个不产出', () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      cr(i + 1, [
        ['submitted', 0],
        ['approved', 2],
      ]),
    ).flat()
    expect(computeWikiChangeApproval(events)).toBeNull()
  })

  it('退回再提交计两轮；批准率、退回率、等待与实施分位', () => {
    const events = [
      ...[1, 2, 3].map((id) =>
        cr(id, [
          ['submitted', 0],
          ['under_review', 1],
          ['approved', 1],
          ['implemented', 3],
        ]),
      ),
      cr(4, [
        ['submitted', 0],
        ['under_review', 1],
        ['returned', 3],
        ['submitted', 1],
        ['approved', 2],
      ]),
      cr(5, [
        ['submitted', 0],
        ['rejected', 5],
      ]),
      cr(6, [['submitted', 0]]), // 尚无结论：不算样本
    ].flat()
    const stats = computeWikiChangeApproval(events)!
    expect(stats.samples).toBe(5)
    expect(stats.approvalRate).toBe(80)
    expect(stats.returnRate).toBe(20)
    expect(stats.rounds).toBe(1.2)
    // 等待：2,2,2,4,2,5 → P50 2、P80 4
    expect(stats.waitP50Days).toBe(2)
    expect(stats.waitP80Days).toBe(4)
    expect(stats.implement).toEqual({ p50Days: 3, p80Days: 3 })
  })

  it('批准到实施不足 3 个时不报告；往返一致', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      cr(i + 1, [
        ['submitted', 0],
        ['approved', i + 1],
      ]),
    ).flat()
    const stats = computeWikiChangeApproval(events)!
    expect(stats.implement).toBeNull()
    const block = renderWikiChangeApprovalBlock(stats)
    expect(block.lines).toHaveLength(3)
    expect(parseWikiChangeApprovalBlock(block.lines.join('\n'))).toEqual(stats)
    const withImpl = { ...stats, implement: { p50Days: 1.5, p80Days: 4 } }
    expect(
      parseWikiChangeApprovalBlock(renderWikiChangeApprovalBlock(withImpl).lines.join('\n')),
    ).toEqual(withImpl)
    expect(parseWikiChangeApprovalBlock('无关')).toBeNull()
  })

  it('只有驳回与退回、没有闭合等待时不产出', () => {
    const events = Array.from({ length: 5 }, (_, i) => [
      { entityId: i + 1, at: DAY, from: 'under_review', to: 'rejected' },
    ]).flat()
    expect(computeWikiChangeApproval(events)).toBeNull()
  })
})

describe('流程页', () => {
  const stats = computeWikiTaskFlow(
    Array.from({ length: 8 }, (_, i) => flow(i + 1, SIMPLE)).flat(),
  )!

  it('新建页是三段且为纯派生，系统作者按簿记发布', () => {
    const body = wikiProcessPageBody('task-flow', renderWikiTaskFlowBlock(stats))
    const doc = parseWikiMarkdown(body)
    expect(doc.ok).toBe(true)
    if (!doc.ok) return
    expect(doc.doc.headings).toEqual([
      '声明的流程（制度怎么写）',
      '实际的流程（数据怎么说）',
      '差异与解读',
    ])
    expect(doc.doc.frontmatter.type).toBe('process')
    expect(isWikiPurelyDerivedDocument(doc.doc, REGISTERED)).toBe(true)
    expect(
      classifyWikiRevision(null, doc.doc, {
        authorKind: 'system',
        systemPage: false,
        registeredGenerators: REGISTERED,
      }),
    ).toBe('bookkeeping')
  })

  it('刷新只替换派生段，保留人写声明与解读', () => {
    const body = wikiProcessPageBody('task-flow', renderWikiTaskFlowBlock(stats))
      .replace(
        '## 声明的流程（制度怎么写）\n',
        '## 声明的流程（制度怎么写）\n\n- 评审一天内完成。[^c:d1]\n',
      )
      .replace('## 差异与解读\n', '## 差异与解读\n\n- 实际很少返工。[^c:i1]\n')
      .concat('[^c:d1]: user_statement#1\n[^c:i1]: user_statement#1\n')
    const next = replaceWikiDerivedBlock(
      body,
      WIKI_PROCESS_TASK_FLOW_GENERATOR,
      renderWikiTaskFlowBlock({ ...stats, reworkRate: 40 }),
      'pf-',
    )!
    expect(next).toContain('评审一天内完成')
    expect(next).toContain('实际很少返工')
    expect(next).toContain('返工：40%')
    expect(parseWikiMarkdown(next).ok).toBe(true)
  })

  it('slug 与类型互转；章节定位', () => {
    expect(wikiProcessSlug('change-approval')).toBe('process-change-approval')
    expect(wikiProcessKindOfSlug('process-task-flow')).toBe('task-flow')
    expect(wikiProcessKindOfSlug('reference-class-all')).toBeNull()
    const src = '---\ntype: process\n---\n前言\n## 甲\n- a\n## 乙\n- b\n'
    expect(wikiSectionOfLine(src, 4)).toBeNull()
    expect(wikiSectionOfLine(src, 6)).toBe('甲')
    expect(wikiSectionOfLine(src, 8)).toBe('乙')
    expect(wikiSectionOfLine(src, 100)).toBe('乙')
  })
})
