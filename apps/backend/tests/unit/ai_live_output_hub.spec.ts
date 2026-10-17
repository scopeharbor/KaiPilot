import { describe, expect, it } from 'vitest'
import type { GenerateOptions, GenerateResult } from '#services/ai_m0/gateway'
import {
  LiveOutputHub,
  isLiveOutputId,
  liveOutputGateway,
  liveOutputHub,
  liveOutputOwner,
} from '#services/ai_live_output/live_output_hub'

const ID = '5b1f0c1e-3d2a-4c6b-9e8f-0a1b2c3d4e5f'

describe('实时输出频道', () => {
  it('只认 UUID 编号', () => {
    expect(isLiveOutputId(ID)).toBe(true)
    expect(isLiveOutputId('../etc')).toBe(false)
    expect(isLiveOutputId(undefined)).toBe(false)
  })

  it('首个触达者绑定归属，其他人读写都被拒绝', () => {
    const hub = new LiveOutputHub()
    expect(hub.claim(ID, '1:6')).not.toBeNull()
    expect(hub.claim(ID, '1:7')).toBeNull()
    hub.push(ID, { text: 'abc', callId: '1', label: '分析' })
    expect(hub.read(ID, '1:7', 0)).toBeNull()
    expect(hub.read(ID, '1:6', 0)?.pieces.map((piece) => piece.text)).toEqual(['abc'])
  })

  it('按偏移续读，关闭后标记 closed 并唤醒等待者', async () => {
    const hub = new LiveOutputHub()
    hub.claim(ID, 'o')
    hub.push(ID, { text: 'a', callId: '1', label: 'x' })
    const first = hub.read(ID, 'o', 0)!
    hub.push(ID, { text: 'b', callId: '1', label: 'x' })
    expect(hub.read(ID, 'o', first.next)!.pieces.map((piece) => piece.text)).toEqual(['b'])
    const waiting = hub.waitForChange(ID, 5_000)
    hub.close(ID)
    await waiting
    expect(hub.read(ID, 'o', 0)!.closed).toBe(true)
  })

  it('包装后的 gateway：每次 generate 成为一条道，其他方法仍能访问私有字段', async () => {
    class FakeGateway {
      #secret = 'private-ok'
      async generate(options: GenerateOptions): Promise<GenerateResult> {
        options.onText?.('{"a":')
        options.onText?.('1}')
        return {
          rawText: '{"a":1}',
          triggeredErrors: [],
          outputTokens: 3,
          firstTokenMs: 1,
          totalMs: 2,
          usingRealAdapter: false,
        }
      }
      peek() {
        return this.#secret
      }
    }
    const id = '6c2e1d2f-4e3b-4d7c-8f9a-1b2c3d4e5f60'
    const owner = liveOutputOwner(1, 6)
    liveOutputHub.claim(id, owner)
    const gateway = liveOutputGateway(new FakeGateway(), id)
    expect(gateway.peek()).toBe('private-ok')
    const result = await gateway.generate({
      sentence: '分析项目理解与信息缺口',
      strategy: 'prompt',
    })
    expect(result.rawText).toBe('{"a":1}')
    const pieces = liveOutputHub.read(id, owner, 0)!.pieces
    expect(pieces.every((piece) => piece.label === '分析项目理解与信息缺口')).toBe(true)
    expect(pieces.map((piece) => piece.text).join('')).toBe('{"a":1}')
    expect(pieces.at(-1)?.done).toBe(true)
  })
})
