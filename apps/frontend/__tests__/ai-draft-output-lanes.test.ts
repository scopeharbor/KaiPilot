import { describe, expect, it } from 'vitest'
import {
  LANE_LIMIT,
  LANE_TEXT_LIMIT,
  appendOutputPiece,
  closeOutputLanes,
} from '@/lib/ai-draft/output-lanes'

describe('lib/ai-draft/output-lanes', () => {
  it('并发调用按编号分道，不互相穿插', () => {
    let lanes = appendOutputPiece([], { text: '{"a"', callId: '1', label: '拆解：会员' })
    lanes = appendOutputPiece(lanes, { text: '{"b"', callId: '2', label: '拆解：订单' })
    lanes = appendOutputPiece(lanes, { text: ':1}', callId: '1' })
    expect(lanes.map((lane) => [lane.label, lane.text])).toEqual([
      ['拆解：会员', '{"a":1}'],
      ['拆解：订单', '{"b"'],
    ])
  })

  it('旧服务端不带编号时归入同一条道', () => {
    let lanes = appendOutputPiece([], { text: 'ab' })
    lanes = appendOutputPiece(lanes, { text: 'cd' })
    expect(lanes).toHaveLength(1)
    expect(lanes[0]).toMatchObject({ label: '模型输出', text: 'abcd', done: false })
  })

  it('done 标记结束，生成终态时全部收尾', () => {
    let lanes = appendOutputPiece([], { text: 'x', callId: '1', label: 'A' })
    lanes = appendOutputPiece(lanes, { text: '', callId: '1', done: true })
    lanes = appendOutputPiece(lanes, { text: 'y', callId: '2', label: 'B' })
    expect(lanes.map((lane) => lane.done)).toEqual([true, false])
    expect(closeOutputLanes(lanes).every((lane) => lane.done)).toBe(true)
  })

  it('只保留尾部文本，道数超限时先淘汰最早完成的', () => {
    const long = appendOutputPiece([], { text: 'z'.repeat(LANE_TEXT_LIMIT + 50), callId: '1' })
    expect(long[0]?.text).toHaveLength(LANE_TEXT_LIMIT)

    let lanes = appendOutputPiece([], { text: 'first', callId: 'first', done: true })
    for (let i = 0; i < LANE_LIMIT; i++)
      lanes = appendOutputPiece(lanes, { text: 'n', callId: `c${i}` })
    expect(lanes).toHaveLength(LANE_LIMIT)
    expect(lanes.some((lane) => lane.id === 'first')).toBe(false)
  })
})

describe('思考过程分开归道', () => {
  it('reasoning 片段进 reasoning，不混进正文；模型名随开道片段带上', () => {
    let lanes = appendOutputPiece([], { text: '', callId: '1', label: '分析', model: 'deepseek' })
    lanes = appendOutputPiece(lanes, { text: '先想想', callId: '1', kind: 'reasoning' })
    lanes = appendOutputPiece(lanes, { text: '{"a":1}', callId: '1' })
    expect(lanes[0]).toMatchObject({ model: 'deepseek', reasoning: '先想想', text: '{"a":1}' })
  })
})

describe('累计字数与思考 / 回答状态', () => {
  it('显示文本只留尾部，字数按累计算；最近片段决定正在思考还是正在回答', () => {
    let lanes = appendOutputPiece([], { text: '想'.repeat(5000), callId: '1', kind: 'reasoning' })
    lanes = appendOutputPiece(lanes, { text: '想'.repeat(5000), callId: '1', kind: 'reasoning' })
    expect(lanes[0]!.reasoning).toHaveLength(LANE_TEXT_LIMIT)
    expect(lanes[0]!.reasoningChars).toBe(10_000)
    expect(lanes[0]!.phase).toBe('thinking')
    lanes = appendOutputPiece(lanes, { text: '{"a":1}', callId: '1' })
    expect(lanes[0]!.textChars).toBe(7)
    expect(lanes[0]!.phase).toBe('answering')
  })
})
