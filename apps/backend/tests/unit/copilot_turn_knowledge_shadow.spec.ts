/**
 * v3-llm-wiki-query-navigation —— Copilot 回合的知识影子观测端口：
 * 装配后调用、只拿到统计输入、结果不注入（影子开 / 关时送给模型的输入全等）、失败不影响回合。
 *
 * 纯 vitest：依赖全部注入，零数据库、零网络。
 */
import { describe, expect, it, vi } from 'vitest'
import { COPILOT_TURN_FIXTURE_REQUEST_MENTION } from '@aiproj/types'
import CopilotTurnService, {
  type CopilotKnowledgeShadowObserver,
} from '../../app/services/copilot_turn/copilot_turn_service.js'

const ORG = 1
const ACTOR = 5
const PROJECT_ID = 100

function deps(
  answerExecutor: (input: unknown) => Promise<{ text: string }>,
  knowledgeShadow?: CopilotKnowledgeShadowObserver,
) {
  const assembly = {
    assembleContext: vi.fn(async () => ({
      packet: {
        sources: [
          {
            sourceRef: 'task:1042',
            sourceHash: 'hash-1042',
            lowSensitivitySummary: '任务延期，等待依赖确认。',
          },
        ],
        budget: { contextBytesUsed: 2048, contextBytesLimit: 65536 },
        truncation: { warning: null },
      },
      warnings: [] as const,
      sources: [{ sourceRef: 'task:1042', sourceHash: 'hash-1042' }],
      contextFacts: [{ factKey: 'wbs.nodes' }, { factKey: 'wbs.leafs' }],
      conclusionTrace: [],
      uncertainty: [],
    })),
  }
  const sessions = {
    createSession: vi.fn(async () => ({ sessionId: 'sess-new-0001' })),
    isOwnedBy: vi.fn(async () => true),
    appendMessage: vi.fn(async () => ({
      message: { messageId: 'msg-1' },
      truncated: false,
      idempotent: false,
    })),
  }
  const ok = { safe: true, violations: [] as string[] }
  const sanitizer = {
    sanitizeAssemblyResult: vi.fn(() => ok),
    checkPacket: vi.fn(() => ok),
    checkSourceMetadata: vi.fn(() => ok),
    cleanAssemblyResult: vi.fn((result: unknown) => ({ cleaned: result, removedFields: [] })),
  }
  const dlpAdapter = {
    preflightContextAssembly: vi.fn(async () => ({
      allowed: true,
      adapterAvailable: true,
      maskedContext: null,
      snapshot: {
        result: 'allow',
        policyVersion: 1,
        matchSummary: [],
        policyHash: 'ph-1',
        reasonCodes: [],
      },
      warnings: [] as string[],
    })),
  }
  const watermarkAdapter = {
    prepareContext: vi.fn(async () => ({ watermarkRequired: true, templateHash: 'th-1' })),
  }
  return new CopilotTurnService({
    assembly: assembly as never,
    sessions: sessions as never,
    permissionChecker: async ({ entityIds }) => new Set(entityIds),
    recordRouting: (async () => ({ success: true })) as never,
    sanitizer: sanitizer as never,
    dlpAdapter: dlpAdapter as never,
    watermarkAdapter: watermarkAdapter as never,
    answerExecutor: answerExecutor as never,
    ...(knowledgeShadow ? { knowledgeShadow } : {}),
  })
}

function input() {
  return {
    request: {
      ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
      text: '证书延误以前怎么处理的',
      mentions: [],
      currentRoute: '/ai-create',
      attribution: { organizationId: String(ORG), projectId: PROJECT_ID },
    } as never,
    organizationId: ORG,
    actorId: ACTOR,
    permissions: ['ai:trigger'] as const,
  }
}

describe('Copilot 回合 · 知识影子观测', () => {
  it('装配后调用一次，只拿到统计输入', async () => {
    const observe = vi.fn(async () => true)
    const service = deps(async () => ({ text: '回答' }), { observe })
    await service.execute(input())
    expect(observe).toHaveBeenCalledTimes(1)
    expect(observe).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: ACTOR,
      projectId: PROJECT_ID,
      query: '证书延误以前怎么处理的',
      legacySourcesCount: 1,
      legacyFactsCount: 2,
    })
  })

  it('影子开与关时送给模型的输入全等（结果不注入）', async () => {
    const withShadow = vi.fn(async (_: unknown) => ({ text: '回答' }))
    const without = vi.fn(async (_: unknown) => ({ text: '回答' }))
    await deps(withShadow, { observe: async () => ({ pages: [{ claims: ['注入？'] }] }) }).execute(
      input(),
    )
    await deps(without).execute(input())
    expect(withShadow).toHaveBeenCalledTimes(1)
    expect(without).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(withShadow.mock.calls[0]![0])).toBe(
      JSON.stringify(without.mock.calls[0]![0]),
    )
    expect(JSON.stringify(withShadow.mock.calls[0]![0])).not.toContain('注入？')
  })

  it('影子抛错不影响回合', async () => {
    const answer = vi.fn(async () => ({ text: '照常回答' }))
    const service = deps(answer, {
      observe: async () => {
        throw new Error('shadow boom')
      },
    })
    const result = await service.execute(input())
    expect(answer).toHaveBeenCalledTimes(1)
    expect(result.response.result?.kind).toBe('answer')
  })
})
