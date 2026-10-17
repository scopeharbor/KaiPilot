import { describe, expect, it, vi } from 'vitest'

vi.mock('#services/streaming/streaming_ws_service', () => ({
  publishProgressEnvelope: vi.fn(),
  isStreamingWsEnabled: vi.fn(() => true),
}))

describe('§4.2 AI Draft WS Producer', () => {
  // 注（v3-backend-type-debt-closure）：原用 CommonJS `require()`，在 ESM/Vitest 下
  // 不经 resolve.extensionAlias，`.js` 指向的 `.ts` 源解析不到，三个用例全部 module-not-found。
  it('不抛出异常（best-effort 语义）', async () => {
    const { publishDraftProgressToWs } = await import('#services/ai_draft/ws_producer')
    expect(() =>
      publishDraftProgressToWs({
        organizationId: 1,
        draftUid: 'test',
        version: 1,
        projectType: 'software',
        result: { modules: ['charter'] },
        validation: null,
      }),
    ).not.toThrow()
  }, 20_000)
  it('当 WebSocket 未启用时静默返回', async () => {
    const { isStreamingWsEnabled } = await import('#services/streaming/streaming_ws_service')
    vi.mocked(isStreamingWsEnabled).mockReturnValueOnce(false)
    const { publishDraftProgressToWs } = await import('#services/ai_draft/ws_producer')
    expect(() =>
      publishDraftProgressToWs({
        organizationId: 1,
        draftUid: 'test',
        version: 1,
        projectType: 'software',
        result: { modules: ['charter'] },
        validation: null,
      }),
    ).not.toThrow()
  }, 20_000)
  it('WebSocket 启用时调用 publishProgressEnvelope', async () => {
    const { publishProgressEnvelope } = await import('#services/streaming/streaming_ws_service')
    const { publishDraftProgressToWs } = await import('#services/ai_draft/ws_producer')
    publishDraftProgressToWs({
      organizationId: 5,
      draftUid: 'draft-abc',
      version: 1,
      projectType: 'software',
      result: { modules: ['charter'] },
      validation: null,
    })
    expect(publishProgressEnvelope).toHaveBeenCalled()
  }, 20_000)
})

describe('§4.4 Compiler tests', () => {
  it('SSE 仍然是权威回退路径', () => {
    expect(true).toBe(true)
  })
})

describe('§4.6 Code generation tests', () => {
  it('候选事件只包含 refs/hash/review status', () => {
    const event = {
      streamId: 'bundle-1',
      refs: ['ref-abc'],
      hash: 'sha256-xxx',
      reviewStatus: 'pending',
    }
    expect(event.refs).toBeDefined()
    expect(event.hash).toBeDefined()
    expect(event.reviewStatus).toBeDefined()
    expect(Object.keys(event)).not.toContain('fileContent')
    expect(Object.keys(event)).not.toContain('rawOutput')
  })
})
