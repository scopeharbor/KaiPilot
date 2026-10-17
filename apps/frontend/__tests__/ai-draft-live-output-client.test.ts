import { describe, expect, it } from 'vitest'
import { newLiveOutputId, parseLiveOutputFrame } from '@/lib/ai-draft/live-output-client'

describe('lib/ai-draft/live-output-client', () => {
  it('解析 output 帧为分道片段', () => {
    expect(
      parseLiveOutputFrame(
        'event: output\ndata: {"text":"{\\"a\\"","callId":"1","label":"分析项目理解与信息缺口"}',
      ),
    ).toEqual({
      event: 'output',
      piece: { text: '{"a"', callId: '1', label: '分析项目理解与信息缺口' },
    })
  })

  it('识别 end 帧，忽略保活注释与坏数据', () => {
    expect(parseLiveOutputFrame('event: end\ndata: {}')).toEqual({ event: 'end' })
    expect(parseLiveOutputFrame(': keep-alive')).toBeNull()
    expect(parseLiveOutputFrame('event: output\ndata: not-json')).toBeNull()
  })

  it('频道编号是 UUID', () => {
    expect(newLiveOutputId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
