import { describe, expect, it } from 'vitest'
import {
  GENERATION_OUTPUT_FLUSH_CHARS,
  createOutputFlusher,
} from '#services/ai_draft/output_flusher'

describe('createOutputFlusher', () => {
  it('未达阈值时 push 不产出事件文本，缓冲保留', () => {
    const flusher = createOutputFlusher(10)
    expect(flusher.push('abc')).toEqual([])
    expect(flusher.push('defgh')).toEqual([])
    expect(flusher.flush()).toEqual(['abcdefgh'])
    // flush 后缓冲清空
    expect(flusher.flush()).toEqual([])
  })

  it('达到阈值时按阈值切出整段、残余保留', () => {
    const flusher = createOutputFlusher(10)
    // 累积 13 字符：切出 10，残余 3
    expect(flusher.push('abcdefghijk')).toEqual(['abcdefghij'])
    expect(flusher.push('lmnop')).toEqual([]) // 残余 3 + 5 = 8 < 10
    expect(flusher.flush()).toEqual(['klmnop'])
  })

  it('超长 chunk 一次切出多段且顺序正确', () => {
    const flusher = createOutputFlusher(4)
    expect(flusher.push('abcdefghij')).toEqual(['abcd', 'efgh'])
    expect(flusher.flush()).toEqual(['ij'])
  })

  it('空串与空 chunk 不产出事件文本', () => {
    const flusher = createOutputFlusher(4)
    expect(flusher.push('')).toEqual([])
    expect(flusher.push('ab')).toEqual([])
    expect(flusher.push('')).toEqual([])
    expect(flusher.flush()).toEqual(['ab'])
    expect(flusher.flush()).toEqual([])
  })

  it('中文等多字节字符按码元边界切分，拼接后原文完整', () => {
    const flusher = createOutputFlusher(5)
    const text = '项目章程：构建内部审批系统，减少重复录入。'
    const pieces: string[] = []
    // 拆成细碎 chunk 模拟逐 token 到达
    for (const ch of text) pieces.push(...flusher.push(ch))
    pieces.push(...flusher.flush())
    expect(pieces.join('')).toBe(text)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(5)
  })

  it('默认阈值常量为 96 字符', () => {
    expect(GENERATION_OUTPUT_FLUSH_CHARS).toBe(96)
    const flusher = createOutputFlusher()
    const pieces = flusher.push('x'.repeat(96))
    expect(pieces).toEqual(['x'.repeat(96)])
    expect(flusher.flush()).toEqual([])
  })
})
