/**
 * ai-structured-output-poc / M0 —— 前端 SSE buffer / schema / measure 单元测试。
 *
 * 覆盖：
 *  - parseSseFrames：普通 chunk + tail pending；跨调用拼帧；
 *  - applySseEvent：rawText 累积 + lastEventId 更新；
 *  - parseDraft：合法草案 ok；缺 marker → 失败并返回路径 issues；
 *  - percentile / summarizeOutcomes / assertBucketInvariant：分位与桶不变式。
 */

import { describe, expect, it } from 'vitest'
import { applySseEvent, initialSseBufferState, parseSseFrames } from '@/lib/ai-m0/sse-buffer'
import { parseDraft } from '@/lib/ai-m0/schema'
import { assertBucketInvariant, percentile, summarizeOutcomes } from '@/lib/ai-m0/measure'
import type { AiM0GenerationOutcome, AiProjectDraft } from '@aiproj/types'

const validDraft: AiProjectDraft = {
  charter: {
    title: { value: 't', marker: mkr() },
    vision: { value: 'v', marker: mkr() },
    scope: { value: 's', marker: mkr() },
    successCriteria: { value: ['a'], marker: mkr() },
    startDate: { value: '2026-01-01', marker: mkr(true) },
    endDate: { value: '2026-06-30', marker: mkr(true) },
  },
  wbs: [
    {
      id: 'w1',
      parentId: null,
      outlineCode: '1',
      name: { value: 'x', marker: mkr() },
      description: { value: '', marker: mkr() },
      children: [],
    },
  ],
  tasks: [
    {
      id: 't1',
      wbsNodeId: 'w1',
      name: { value: 'x', marker: mkr() },
      description: { value: '', marker: mkr() },
      status: 'not_started',
      durationDays: { value: 3, marker: mkr(true) },
      startDate: { value: '2026-01-01', marker: mkr(true) },
      endDate: { value: '2026-01-04', marker: mkr(true) },
      dependencies: [],
      assigneeHint: { value: '-', marker: mkr() },
    },
  ],
  acceptanceCriteria: [
    { id: 'a1', statement: { value: 'ok', marker: mkr() }, linkedSuccessIndex: 0 },
  ],
}

function mkr(needs = false) {
  return {
    confidence: 0.8,
    source: 'inferred' as const,
    reason: 'r',
    needsConfirmation: needs,
  }
}

describe('sse-buffer.parseSseFrames', () => {
  it('解析一个完整 chunk 帧', () => {
    const raw = 'id: 1\nevent: chunk\ndata: {"text":"hello"}\n\n'
    const { events, pending } = parseSseFrames(raw, '')
    expect(events).toHaveLength(1)
    const evt = events[0]!
    expect(evt.kind).toBe('chunk')
    if (evt.kind === 'chunk') {
      expect(evt.text).toBe('hello')
      expect(evt.eventId).toBe('1')
    }
    expect(pending).toBe('')
  })

  it('半帧留给 pending', () => {
    const half = 'id: 2\nevent: chunk\ndata: {"text":"ha'
    const { events, pending } = parseSseFrames(half, '')
    expect(events).toHaveLength(0)
    expect(pending).toBe(half)
  })

  it('跨调用拼接', () => {
    const first = 'id: 3\nevent: chunk\ndata: {"tex'
    const second = 't":"halo"}\n\n'
    const r1 = parseSseFrames(first, '')
    expect(r1.events).toHaveLength(0)
    const r2 = parseSseFrames(second, r1.pending)
    expect(r2.events).toHaveLength(1)
    const evt = r2.events[0]!
    if (evt.kind === 'chunk') {
      expect(evt.text).toBe('halo')
    }
  })
})

describe('sse-buffer.applySseEvent', () => {
  it('chunk 累积 rawText 并更新 lastEventId', () => {
    let s = { ...initialSseBufferState }
    s = applySseEvent(s, { kind: 'chunk', eventId: '1', text: 'a' })
    s = applySseEvent(s, { kind: 'chunk', eventId: '2', text: 'b' })
    expect(s.rawText).toBe('ab')
    expect(s.lastEventId).toBe('2')
    expect(s.finished).toBe(false)
  })
  it('done 置 finished', () => {
    const s = applySseEvent(initialSseBufferState, {
      kind: 'done',
      eventId: '9',
      meta: {},
    })
    expect(s.finished).toBe(true)
    expect(s.lastEventId).toBe('9')
  })
})

describe('schema.parseDraft', () => {
  it('合法草案 → ok', () => {
    const r = parseDraft(validDraft)
    expect(r.ok).toBe(true)
  })

  it('缺 marker → 失败并返回 issue 路径', () => {
    const bad = JSON.parse(JSON.stringify(validDraft))
    delete bad.charter.title.marker
    const r = parseDraft(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues.some((i) => i.startsWith('charter.title'))).toBe(true)
    }
  })
})

describe('measure.percentile / summarizeOutcomes / invariant', () => {
  it('percentile 空数组返回 0', () => {
    expect(percentile([], 0.5)).toBe(0)
  })
  it('percentile 单值', () => {
    expect(percentile([10], 0.95)).toBe(10)
  })
  it('percentile 线性内插', () => {
    // [1..5]，P50 = 3；P95 = 4.8
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 6)
  })

  it('summarizeOutcomes 桶总和不变式', () => {
    const outcomes: AiM0GenerationOutcome[] = [
      mkOutcome('prompt', 'strict'),
      mkOutcome('prompt', 'repaired'),
      mkOutcome('native', 'failed'),
      mkOutcome('tool', 'strict'),
    ]
    const summary = summarizeOutcomes(outcomes)
    expect(summary.totalRuns).toBe(4)
    expect(summary.perStrategy.prompt.runs).toBe(2)
    expect(summary.perStrategy.prompt.landableRate).toBe(1)
    expect(summary.perStrategy.native.landableRate).toBe(0)
    expect(() => assertBucketInvariant(summary)).not.toThrow()
  })
})

function mkOutcome(
  strategy: AiM0GenerationOutcome['strategy'],
  bucket: AiM0GenerationOutcome['bucket'],
): AiM0GenerationOutcome {
  return {
    inputId: 'sw-01',
    strategy,
    bucket,
    firstTokenMs: 100,
    totalMs: 500,
    retries: 0,
    triggeredErrors: [],
    markerCoverage: bucket === 'failed' ? 0 : 1,
    outputTokens: null,
  }
}
