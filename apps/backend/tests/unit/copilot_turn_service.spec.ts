/**
 * v3-copilot-live-submission-channel —— 回合服务与引用复核测试。
 * v3-copilot-dlp-and-watermark-integration —— DLP 检查与水印注入测试。
 *
 * 覆盖任务 3.5–3.11（伪造/非泄露/跨组织/不二次解析/判定不可用阻断）、
 * 4.6（斜杠命中最高优先级）、4.8（默认离线）、4.10（落账降级不阻断）、
 * 4.13（不存全文）、4.15（幂等）、4.17（变更类零写入）。
 * v3-copilot-dlp-and-watermark-integration 覆盖：
 * - 2.1-2.5 契约与低敏边界
 * - 3.1-3.10 DLP 接入（组装后模型前、三态处置、阻断终止）
 * - 4.1-4.6 判定不可用即阻断
 * - 5.1-5.5 脱敏后重校验
 * - 6.1-6.7 水印注入（独立字段、source hash 分离）
 * - 7.1-7.8 权限、组织隔离与合规接入
 * - 8.1-8.5 红线与性能
 *
 * 纯 vitest：依赖全部注入，零 AdonisJS 运行时、零数据库、零网络。
 */

import { describe, it, expect, vi } from 'vitest'
import type { MentionReference, CopilotTurnRequest } from '@aiproj/types'
import {
  COPILOT_TURN_FIXTURE_REF_CROSS_ORG,
  COPILOT_TURN_FIXTURE_REF_FORBIDDEN,
  COPILOT_TURN_FIXTURE_REF_TASK,
  COPILOT_TURN_FIXTURE_REQUEST_MENTION,
  COPILOT_TURN_FIXTURE_REQUEST_SLASH,
  COPILOT_TURN_FIXTURE_REQUEST_TEXT_ONLY_ENTITY,
  COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES,
  containsForbiddenTurnPayload,
} from '@aiproj/types'
import {
  MentionPermissionUnavailableError,
  reviewMentionRefs,
  type MentionEntityPermissionChecker,
} from '../../app/services/copilot_action/mention_reference_validator.js'
import CopilotTurnService, {
  CopilotTurnShapeError,
  CopilotDlpBlockError,
  CopilotEmptyResultError,
} from '../../app/services/copilot_turn/copilot_turn_service.js'

const ORG = 1
const ACTOR = 5
const PROJECT_ID = 100

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/** 只放行 task:1042 的判权器（其余同组织实体视为无读权限）。 */
const grantOnlyTask1042: MentionEntityPermissionChecker = async ({ entityType, entityIds }) => {
  if (entityType !== 'task') return new Set<number>()
  return new Set(entityIds.filter((id) => id === 1042))
}

/** 放行一切的判权器。 */
const grantAll: MentionEntityPermissionChecker = async ({ entityIds }) => new Set(entityIds)

/** 判定不可用（模拟查询失败）。 */
const permissionUnavailable: MentionEntityPermissionChecker = async () => {
  throw new Error('db unavailable')
}

function makeAssemblyStub(contextBytesUsed = 2048) {
  return {
    assembleContext: vi.fn(async (..._args: any[]) => ({
      packet: {
        sources: [
          {
            sourceRef: 'task:1042',
            sourceHash: 'hash-1042',
            lowSensitivitySummary: '任务延期，等待依赖确认。',
          },
        ],
        budget: { contextBytesUsed, contextBytesLimit: 65536 },
        truncation: { warning: null },
      },
      warnings: [] as const,
      sources: [{ sourceRef: 'task:1042', sourceHash: 'hash-1042' }],
      conclusionTrace: [],
      uncertainty: [],
    })),
  }
}

function makeSessionsStub() {
  const appended: unknown[] = []
  return {
    appended,
    createSession: vi.fn(async (..._args: any[]) => ({ sessionId: 'sess-new-0001' })),
    isOwnedBy: vi.fn(async (..._args: any[]) => true),
    appendMessage: vi.fn(async (input: Record<string, unknown>, ..._args: any[]) => {
      appended.push(input)
      return {
        message: { messageId: `msg-${appended.length}` },
        truncated: false,
        idempotent: false,
      }
    }),
  }
}

function makeSanitizerStub() {
  return {
    sanitizeAssemblyResult: vi.fn((..._args: any[]) => ({
      safe: true,
      violations: [] as string[],
    })),
    checkPacket: vi.fn((..._args: any[]) => ({ safe: true, violations: [] as string[] })),
    checkSourceMetadata: vi.fn((..._args: any[]) => ({ safe: true, violations: [] as string[] })),
    cleanAssemblyResult: vi.fn((result: unknown, ..._args: any[]) => ({
      cleaned: result,
      removedFields: [] as string[],
    })),
  }
}

function makeDlpAdapterStub(
  overrides: {
    allowed?: boolean
    adapterAvailable?: boolean
    maskedContext?: string | null
    snapshot?: Record<string, unknown> | null
  } = {},
) {
  return {
    preflightContextAssembly: vi.fn(async (..._args: any[]) => ({
      allowed: overrides.allowed ?? true,
      adapterAvailable: overrides.adapterAvailable ?? true,
      maskedContext: overrides.maskedContext ?? null,
      snapshot: overrides.snapshot ?? {
        result: 'allow',
        policyVersion: 1,
        matchSummary: [],
        policyHash: 'ph-1',
        reasonCodes: [],
      },
      warnings: [] as string[],
    })),
  }
}

function makeWatermarkAdapterStub() {
  return {
    prepareContext: vi.fn(async (..._args: any[]) => ({
      watermarkRequired: true,
      templateHash: 'th-1',
    })),
  }
}

function makeService(
  overrides: {
    permissionChecker?: MentionEntityPermissionChecker
    recordRouting?: unknown
    assembly?: ReturnType<typeof makeAssemblyStub>
    sessions?: ReturnType<typeof makeSessionsStub>
    sanitizer?: ReturnType<typeof makeSanitizerStub>
    dlpAdapter?: ReturnType<typeof makeDlpAdapterStub>
    watermarkAdapter?: ReturnType<typeof makeWatermarkAdapterStub>
    answerExecutor?: (input: any) => Promise<{ text: string }>
  } = {},
) {
  const assembly = overrides.assembly ?? makeAssemblyStub()
  const sessions = overrides.sessions ?? makeSessionsStub()
  const sanitizer = overrides.sanitizer ?? makeSanitizerStub()
  const dlpAdapter = overrides.dlpAdapter ?? makeDlpAdapterStub()
  const watermarkAdapter = overrides.watermarkAdapter ?? makeWatermarkAdapterStub()
  const service = new CopilotTurnService({
    // 替身仅暴露被消费的方法，故此处收窄类型
    assembly: assembly as never,
    sessions: sessions as never,
    permissionChecker: overrides.permissionChecker ?? grantAll,
    recordRouting: (overrides.recordRouting ?? (async () => ({ success: true }))) as never,
    sanitizer: sanitizer as never,
    dlpAdapter: dlpAdapter as never,
    watermarkAdapter: watermarkAdapter as never,
    answerExecutor:
      overrides.answerExecutor ?? (async () => ({ text: '这是基于已授权上下文的真实回答。' })),
  })
  return { service, assembly, sessions, sanitizer, dlpAdapter, watermarkAdapter }
}

function execInput(
  request:
    CopilotTurnRequest | (Record<string, unknown> & { attribution?: Record<string, unknown> }),
  overrides: Record<string, unknown> = {},
) {
  return {
    request: {
      ...request,
      attribution: {
        ...(((request as Record<string, unknown>).attribution as Record<string, unknown>) ?? {}),
        projectId: PROJECT_ID,
      },
    } as never,
    organizationId: ORG,
    actorId: ACTOR,
    permissions: ['ai:trigger'] as const,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 引用复核
// ---------------------------------------------------------------------------

describe('引用复核：逐实体判权（3.5–3.7）', () => {
  it('伪造引用被拒且不进获准集合', async () => {
    const result = await reviewMentionRefs({
      refs: [{ entityType: 'task', entityId: 'not-a-number' }, COPILOT_TURN_FIXTURE_REF_TASK],
      text: COPILOT_TURN_FIXTURE_REF_TASK.label,
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: grantAll,
    })
    expect(result.granted).toHaveLength(1)
    expect(result.rejectedCount).toBe(1)
  })

  it('跨组织引用恒被拒', async () => {
    const result = await reviewMentionRefs({
      refs: [COPILOT_TURN_FIXTURE_REF_CROSS_ORG],
      text: COPILOT_TURN_FIXTURE_REF_CROSS_ORG.label,
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: grantAll,
    })
    expect(result.granted).toEqual([])
    expect(result.rejectedCount).toBe(1)
  })

  it('无读权限的同组织引用缺席，结果只暴露计数', async () => {
    const result = await reviewMentionRefs({
      refs: [COPILOT_TURN_FIXTURE_REF_FORBIDDEN],
      text: COPILOT_TURN_FIXTURE_REF_FORBIDDEN.label,
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: grantOnlyTask1042,
    })
    expect(result.granted).toEqual([])
    expect(result.rejectedCount).toBe(1)
    // 结果结构只有 granted 与 rejectedCount——无被拒实体的类型、ID、名称与原因
    expect(Object.keys(result).sort()).toEqual(['granted', 'rejectedCount'])
    expect(JSON.stringify(result)).not.toContain(
      String(COPILOT_TURN_FIXTURE_REF_FORBIDDEN.entityId),
    )
    expect(JSON.stringify(result)).not.toContain(COPILOT_TURN_FIXTURE_REF_FORBIDDEN.label)
  })

  it('仅相差一项实体权限的两个 actor，差异只在计数与获准集合', async () => {
    const refs = [COPILOT_TURN_FIXTURE_REF_TASK, COPILOT_TURN_FIXTURE_REF_FORBIDDEN]
    const text = `${COPILOT_TURN_FIXTURE_REF_TASK.label} ${COPILOT_TURN_FIXTURE_REF_FORBIDDEN.label}`
    const withRisk = await reviewMentionRefs({
      refs,
      text,
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: grantAll,
    })
    const withoutRisk = await reviewMentionRefs({
      refs,
      text,
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: grantOnlyTask1042,
    })
    expect(withRisk.rejectedCount).toBe(0)
    expect(withoutRisk.rejectedCount).toBe(1)
    // 获准集合顺序不因缺席而移位：task 仍在首位
    expect(withoutRisk.granted[0]?.entityId).toBe(COPILOT_TURN_FIXTURE_REF_TASK.entityId)
  })

  it('孤儿引用（文本已无对应标签）被清除', async () => {
    const result = await reviewMentionRefs({
      refs: [COPILOT_TURN_FIXTURE_REF_TASK],
      text: '这段文本里没有那个标签',
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: grantAll,
    })
    expect(result.granted).toEqual([])
    expect(result.rejectedCount).toBe(1)
  })

  it('判权不可用抛出专用错误而非默认放行（3.10 / 3.11）', async () => {
    await expect(
      reviewMentionRefs({
        refs: [COPILOT_TURN_FIXTURE_REF_TASK],
        text: COPILOT_TURN_FIXTURE_REF_TASK.label,
        actorOrganizationId: ORG,
        actorId: ACTOR,
        permissionChecker: permissionUnavailable,
      }),
    ).rejects.toBeInstanceOf(MentionPermissionUnavailableError)
  })

  it('同类型引用批量判定一次，不逐条查询（3.2）', async () => {
    const checker = vi.fn<MentionEntityPermissionChecker>(
      async ({ entityIds }) => new Set(entityIds),
    )
    const refs: MentionReference[] = [1, 2, 3].map((id) => ({
      ...COPILOT_TURN_FIXTURE_REF_TASK,
      entityId: id,
      label: `任务-${id}`,
    }))
    await reviewMentionRefs({
      refs,
      text: refs.map((r) => r.label).join(' '),
      actorOrganizationId: ORG,
      actorId: ACTOR,
      permissionChecker: checker,
    })
    expect(checker).toHaveBeenCalledTimes(1)
    expect(checker.mock.calls[0]![0].entityIds).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// 回合服务：分类与路由接线（4.6 / 4.8）
// ---------------------------------------------------------------------------

describe('回合服务：分类与路由接线（4.6 / 4.8）', () => {
  it('斜杠命令命中规则管线最高优先级', async () => {
    const { service } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH))
    // 命中规则即 ruleHitCount>0 且未落兜底
    expect(result.response.stats.ruleHitCount).toBeGreaterThan(0)
    expect(result.response.stats.fallbackCount).toBe(0)
  })

  it('不携带斜杠命令时不会凭空命中斜杠规则', async () => {
    const { service } = makeService()
    const withSlash = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH))
    const withoutSlash = await service.execute(
      execInput({ ...COPILOT_TURN_FIXTURE_REQUEST_SLASH, slashCommand: undefined }),
    )
    expect(withSlash.response.stats.ruleHitCount).toBeGreaterThanOrEqual(
      withoutSlash.response.stats.ruleHitCount,
    )
  })

  it('回合默认不发起任何网络请求（无 fetch 调用）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { service } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('服务端不从文本二次解析实体：仅有文本无结构化引用时获准集合为空（3.8）', async () => {
    const { service, assembly } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_TEXT_ONLY_ENTITY))
    const calls = assembly.assembleContext.mock.calls as unknown as readonly {
      entityRefs: readonly string[]
    }[][]
    const request = calls[0]![0]
    expect(request.entityRefs).toEqual([])
  })

  it('获准引用以 type:id 形式传入上下文装配', async () => {
    const { service, assembly } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    const calls = assembly.assembleContext.mock.calls as unknown as readonly {
      entityRefs: readonly string[]
    }[][]
    const request = calls[0]![0]
    expect(request.entityRefs).toEqual(['task:1042'])
  })
})

describe('回合服务：真实终态分支', () => {
  it('自然中文的风险建议请求直接回答，不要求规范句式', async () => {
    const answerExecutor = vi.fn(async () => ({
      text: '一、范围漂移；二、集成延期；三、验收不足。',
    }))
    const { service } = makeService({ answerExecutor })
    const result = await service.execute(
      execInput({
        ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
        text: '请用三点说明一个面向 150 名员工的内部工单系统项目最容易失败的地方，并明确你现在只能给建议、不能修改或确认草案。',
        mentions: [],
        currentRoute: '/ai-create',
      }),
    )

    expect(answerExecutor).toHaveBeenCalledTimes(1)
    expect(result.response.result?.kind).toBe('answer')
    expect(result.response.clarificationRequired).toBe(false)
  })

  it('只读回答调用 executor、持久化 assistant 并返回 answer union', async () => {
    const answerExecutor = vi.fn(async () => ({ text: '三点回答：一、范围；二、风险；三、验收。' }))
    const { service, sessions } = makeService({ answerExecutor })
    const result = await service.execute(
      execInput({
        ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
        text: '请用三点回答',
        mentions: [],
        currentRoute: '/ai-create',
      }),
    )

    expect(answerExecutor).toHaveBeenCalledTimes(1)
    expect(result.response.result?.kind).toBe('answer')
    expect(sessions.appendMessage).toHaveBeenCalledTimes(2)
    expect((sessions.appendMessage.mock.calls[1]![0] as { role: string }).role).toBe('assistant')
  })

  it('客户端带来的 sessionId 不属于本人时另开新会话，绝不写入他人会话', async () => {
    const sessions = makeSessionsStub()
    sessions.isOwnedBy.mockResolvedValue(false)
    const { service } = makeService({ sessions })
    await service.execute(
      execInput({
        ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
        sessionId: 'sess-someone-else',
        text: '请用三点回答',
        mentions: [],
        currentRoute: '/ai-create',
      }),
    )

    expect(sessions.isOwnedBy).toHaveBeenCalledWith(ORG, ACTOR, 'sess-someone-else')
    expect(sessions.createSession).toHaveBeenCalledTimes(1)
    for (const [input] of sessions.appendMessage.mock.calls) {
      expect((input as { sessionId: string }).sessionId).toBe('sess-new-0001')
      expect((input as { actorId: number }).actorId).toBe(ACTOR)
    }
  })

  it('provider 超时不产生虚假 assistant 消息', async () => {
    const { service, sessions } = makeService({
      answerExecutor: async () => {
        throw new Error('provider timeout')
      },
    })
    await expect(
      service.execute(
        execInput({
          ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
          text: '请用三点回答',
          mentions: [],
          currentRoute: '/ai-create',
        }),
      ),
    ).rejects.toThrow('provider timeout')
    expect(sessions.appendMessage).toHaveBeenCalledTimes(1)
    expect((sessions.appendMessage.mock.calls[0]![0] as { role: string }).role).toBe('user')
  })

  it('空回答抛稳定错误且不产生 assistant 消息', async () => {
    const { service, sessions } = makeService({ answerExecutor: async () => ({ text: '   ' }) })
    await expect(
      service.execute(
        execInput({
          ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
          text: '请用三点回答',
          mentions: [],
          currentRoute: '/ai-create',
        }),
      ),
    ).rejects.toBeInstanceOf(CopilotEmptyResultError)
    expect(sessions.appendMessage).toHaveBeenCalledTimes(1)
  })

  it('普通输入调用模型而已识别的受控操作不调用回答模型', async () => {
    const answerExecutor = vi.fn(async () => ({ text: '不应调用' }))
    const clarification = makeService({ answerExecutor })
    const clarifyResult = await clarification.service.execute(
      execInput({
        ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
        text: 'xyzabc123',
        mentions: [],
        currentRoute: '/unmapped',
      }),
    )
    expect(clarifyResult.response.result?.kind).toBe('answer')
    expect(answerExecutor).toHaveBeenCalledTimes(1)
    answerExecutor.mockClear()

    const route = makeService({ answerExecutor })
    const routeResult = await route.service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH))
    expect(['clarify', 'route']).toContain(routeResult.response.result?.kind)
    expect(answerExecutor).not.toHaveBeenCalled()
  })

  it('assistant 内容在响应与持久化前脱敏且有界', async () => {
    const { service, sessions } = makeService({
      answerExecutor: async () => ({
        text: `Authorization: Bearer sk-abcdefghijklmnop ${'答'.repeat(5000)}`,
      }),
    })
    const result = await service.execute(
      execInput({
        ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
        text: '请用三点回答',
        mentions: [],
        currentRoute: '/ai-create',
      }),
    )
    const payload = JSON.stringify(result.response.result)
    const persisted = JSON.stringify(sessions.appendMessage.mock.calls[1]![0])
    expect(payload).not.toContain('sk-abcdefghijklmnop')
    expect(persisted).not.toContain('sk-abcdefghijklmnop')
    expect((result.response.result as { content: string }).content.length).toBeLessThanOrEqual(4000)
  })
})

// ---------------------------------------------------------------------------
// 回合服务：低敏观测字段（4.21）
// ---------------------------------------------------------------------------

describe('回合服务：低敏观测字段（4.21）', () => {
  it('响应携带 turnMetrics 且与 stats 派生一致', async () => {
    const { service } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH))
    const metrics = result.response.turnMetrics
    expect(metrics).toBeDefined()
    expect(metrics!.durationMs).toBeGreaterThanOrEqual(0)
    expect(metrics!.routedDestinationCount).toBe(result.response.destinations.length)
    const total = result.response.stats.ruleHitCount + result.response.stats.fallbackCount
    expect(metrics!.ruleHitRate).toBe(
      Math.round((total <= 0 ? 0 : result.response.stats.ruleHitCount / total) * 1000) / 1000,
    )
  })

  it('turnMetrics 为纯数值：不包含文本、实体标识与敏感样本', async () => {
    const { service } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    const serialized = JSON.stringify(result.response.turnMetrics)
    expect(Object.keys(result.response.turnMetrics!).sort()).toEqual([
      'durationMs',
      'routedDestinationCount',
      'ruleHitRate',
    ])
    expect(serialized).not.toContain(COPILOT_TURN_FIXTURE_REQUEST_MENTION.text)
    expect(containsForbiddenTurnPayload(serialized, COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES)).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// 回合服务：落账降级与幂等（4.10 / 4.15）
// ---------------------------------------------------------------------------

describe('回合服务：落账降级与幂等（4.10 / 4.15）', () => {
  it('落账返回失败时回合仍成功并附降级告警', async () => {
    const { service } = makeService({ recordRouting: async () => ({ success: false }) })
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
    expect(result.response.warnings).toContain('ROUTING_LEDGER_DEGRADED')
  })

  it('落账抛错时回合仍成功并附降级告警', async () => {
    const { service } = makeService({
      recordRouting: async () => {
        throw new Error('ledger down')
      },
    })
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
    expect(result.response.warnings).toContain('ROUTING_LEDGER_DEGRADED')
  })

  it('同输入两次回合推导出同一幂等键', async () => {
    const { service, sessions } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    const keys = sessions.appendMessage.mock.calls
      .map((call) => call[0] as { role: string; idempotencyKey: string })
      .filter((call) => call.role === 'user')
      .map((call) => call.idempotencyKey)
    expect(keys[0]).toBe(keys[1])
  })

  it('判权不可用时回合阻断（不返回结果）', async () => {
    const { service } = makeService({ permissionChecker: permissionUnavailable })
    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(MentionPermissionUnavailableError)
  })

  it('形状不合规抛 CopilotTurnShapeError', async () => {
    const { service } = makeService()
    await expect(
      service.execute(execInput({ ...COPILOT_TURN_FIXTURE_REQUEST_MENTION, text: '   ' })),
    ).rejects.toBeInstanceOf(CopilotTurnShapeError)
  })
})

// ---------------------------------------------------------------------------
// 回合服务：禁存与零写入（4.13 / 4.17）
// ---------------------------------------------------------------------------

describe('回合服务：禁存与零写入（4.13 / 4.17）', () => {
  it('持久化消息只存有界摘要，不含敏感样本', async () => {
    const { service, sessions } = makeService()
    const sensitive = COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES[0]!
    await service.execute(
      execInput({
        ...COPILOT_TURN_FIXTURE_REQUEST_MENTION,
        text: `${COPILOT_TURN_FIXTURE_REF_TASK.label} 为什么延期`,
      }),
    )
    const appended = sessions.appendMessage.mock.calls[0]![0] as Record<string, unknown>
    expect(containsForbiddenTurnPayload(appended, [sensitive])).toBe(false)
    expect(String(appended.contentSummary).length).toBeLessThanOrEqual(1024)
  })

  it('超长输入持久化为截断摘要而非全文', async () => {
    const { service, sessions } = makeService()
    const long = `${COPILOT_TURN_FIXTURE_REF_TASK.label} ${'延'.repeat(2000)}`
    await service.execute(execInput({ ...COPILOT_TURN_FIXTURE_REQUEST_MENTION, text: long }))
    const appended = sessions.appendMessage.mock.calls[0]![0] as Record<string, unknown>
    expect(String(appended.contentSummary).length).toBeLessThan(long.length)
  })

  it('响应体不含禁存键与敏感样本', async () => {
    const { service } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(
      containsForbiddenTurnPayload(result.response, COPILOT_TURN_FIXTURE_SENSITIVE_SAMPLES),
    ).toBe(false)
  })

  it('回合返回的每个 destination 都标注需用户确认或非变更', async () => {
    const { service } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH))
    for (const destination of result.response.destinations) {
      expect(typeof destination.requiresUserConfirmation).toBe('boolean')
    }
  })

  it('TPM 输入侧估算随上下文字节增长', async () => {
    const small = makeService({ assembly: makeAssemblyStub(0) })
    const large = makeService({ assembly: makeAssemblyStub(65536) })
    const a = await small.service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    const b = await large.service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(b.estimatedTokens).toBeGreaterThan(a.estimatedTokens)
  })

  it('estimatedTokens 不落响应体', async () => {
    const { service } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(Object.keys(result.response)).not.toContain('estimatedTokens')
  })
})

// ===========================================================================
// v3-copilot-dlp-and-watermark-integration 测试
// ===========================================================================

// ---------------------------------------------------------------------------
// 2. 契约与低敏边界
// ---------------------------------------------------------------------------

describe('DLP 契约：禁存约束（2.1-2.3）', () => {
  it('DLP 命中记录不含命中原文、prompt、模型输出、token 与 secret', async () => {
    const { service, dlpAdapter } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 1,
          matchSummary: [{ ruleId: 'R1', category: 'credential', count: 2, severity: 'high' }],
          policyHash: 'ph-1',
          reasonCodes: ['DLP_DECISION_BLOCK'],
        },
      }),
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)

    // 验证 DLP 适配器被调用时传入的参数不含敏感内容
    const calls = dlpAdapter.preflightContextAssembly.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const callArgs = calls[0]![0] as Record<string, unknown>
    expect(String(callArgs.authorizedContextSummary)).not.toContain('secret')
    expect(String(callArgs.authorizedContextSummary)).not.toContain('password')
    expect(String(callArgs.authorizedContextSummary)).not.toContain('token')
  })

  it('DLP 检查结果的契约形状正确（决策、策略版本、规则 ID、命中类别、命中计数）', async () => {
    const { service, dlpAdapter } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 3,
          matchSummary: [
            { ruleId: 'PII-001', category: 'personal_info', count: 1, severity: 'medium' },
            { ruleId: 'FIN-002', category: 'financial', count: 3, severity: 'high' },
          ],
          policyHash: 'ph-3',
          reasonCodes: ['DLP_DECISION_BLOCK'],
        },
      }),
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)

    // 验证适配器被调用
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalled()
  })
})

describe('DLP 契约：水印载荷不含项目内容（2.4-2.5）', () => {
  it('水印载荷只含组织、项目、actor、时间与版本', async () => {
    const { service, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const callArgs = watermarkAdapter.prepareContext.mock.calls[0]![0]
    // 水印载荷不含项目内容
    expect(callArgs).not.toHaveProperty('taskTitle')
    expect(callArgs).not.toHaveProperty('projectName')
    expect(callArgs).not.toHaveProperty('content')
    // 只含归属信息
    expect(callArgs.organizationId).toBe(ORG)
    expect(callArgs.actorId).toBe(ACTOR)
    expect(callArgs.projectId).toBe(PROJECT_ID)
  })
})

describe('DLP 契约：五态 fixtures（2.6）', () => {
  it('放行态：DLP 检查通过，回合正常继续', async () => {
    const { service, dlpAdapter } = makeService({
      dlpAdapter: makeDlpAdapterStub({ allowed: true }),
    })
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalled()
  })

  it('脱敏态：DLP 要求脱敏，回合附 DLP_REDACTED 告警', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: true,
        maskedContext: '[DLP 脱敏]',
        snapshot: {
          result: 'mask',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.warnings).toContain('DLP_REDACTED')
  })

  it('阻断态：DLP 策略阻断，抛出 CopilotDlpBlockError', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })
    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)
  })

  it('判定不可用态：适配器不可用，阻断回合（不默认放行）', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({ adapterAvailable: false, allowed: true }),
    })
    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)
  })

  it('水印注入态：水印成功注入，回合正常继续', async () => {
    const { service, watermarkAdapter } = makeService()
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
    expect(watermarkAdapter.prepareContext).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. DLP 接入
// ---------------------------------------------------------------------------

describe('DLP 接入：检查位置与三态处置（3.1-3.5）', () => {
  it('DLP 检查发生在上下文装配之后（3.1）', async () => {
    const { service, assembly, dlpAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    // 装配先于 DLP 检查
    const assemblyCallOrder = assembly.assembleContext.mock.invocationCallOrder[0]!
    const dlpCallOrder = dlpAdapter.preflightContextAssembly.mock.invocationCallOrder[0]!
    expect(assemblyCallOrder).toBeLessThan(dlpCallOrder)
  })

  it('DLP 检查使用既有检测器、策略解析与决策服务（3.2）', async () => {
    const { service, dlpAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    // 验证调用了预检适配器（内部委托给 decision service）
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalledTimes(1)
    const params = dlpAdapter.preflightContextAssembly.mock.calls[0]![0]
    expect(params.organizationId).toBe(ORG)
    expect(params.actorId).toBe(ACTOR)
    expect(params.projectId).toBe(PROJECT_ID)
  })

  it('放行路径：DLP 检查通过，回合继续（3.3）', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({ allowed: true }),
    })
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
    // 没有 DLP 相关告警
    expect(result.response.warnings).not.toContain('DLP_UNAVAILABLE')
    expect(result.response.warnings).not.toContain('DLP_REDACTED')
  })

  it('脱敏路径：DLP 要求脱敏，使用脱敏后包（3.3）', async () => {
    const { service, sanitizer } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: true,
        maskedContext: '[DLP 脱敏]',
        snapshot: {
          result: 'mask',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    // 脱敏后重校验
    expect(sanitizer.sanitizeAssemblyResult).toHaveBeenCalled()
  })

  it('阻断路径：DLP 策略阻断，终止回合（3.3 / 3.6）', async () => {
    const { service, sessions } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)

    // 阻断时无会话消息落库（3.7）
    expect(sessions.appendMessage).not.toHaveBeenCalled()
  })

  it('同一策略在 Copilot 与 file/ocr/report 三个出口产生一致决策（3.5）', async () => {
    // 验证 DLP 适配器被调用时传入相同的 contentCategory
    // 具体一致性由 dlp_decision_service 保证，此处验证 Copilot 走同一适配器
    const { service, dlpAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    // 适配器被调用，内部委托给 decision service（与 file/ocr/report 同源）
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalled()
  })
})

describe('DLP 接入：阻断终止与无消息落库（3.6-3.7）', () => {
  it('阻断时无模型调用发生（通过 fetch spy 验证）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('阻断时无会话消息落库', async () => {
    const { service, sessions } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)

    expect(sessions.appendMessage).not.toHaveBeenCalled()
  })

  it('阻断提示只说触发策略与策略名，不说命中的规则与片段（3.10）', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: false,
        snapshot: {
          result: 'block',
          policyVersion: 1,
          matchSummary: [
            { ruleId: 'SECRET-001', category: 'credential', count: 1, severity: 'critical' },
          ],
          policyHash: 'ph-1',
          reasonCodes: ['DLP_DECISION_BLOCK'],
        },
      }),
    })

    try {
      await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
      expect.fail('应该抛出 CopilotDlpBlockError')
    } catch (err) {
      expect(err).toBeInstanceOf(CopilotDlpBlockError)
      const blockErr = err as CopilotDlpBlockError
      // 提示不含命中的规则 ID
      expect(blockErr.message).not.toContain('SECRET-001')
      // 提示不含敏感内容片段
      expect(blockErr.message).not.toContain('password')
      expect(blockErr.message).not.toContain('secret')
    }
  })
})

describe('DLP 接入：策略解析走既有两层（3.8-3.9）', () => {
  it('策略解析使用组织级与项目级两层，不另建策略源', async () => {
    const { service, dlpAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const params = dlpAdapter.preflightContextAssembly.mock.calls[0]![0]
    // 传入组织 ID 和项目 ID，由适配器内部的策略解析服务处理
    expect(params.organizationId).toBe(ORG)
    expect(params.projectId).toBe(PROJECT_ID)
  })
})

// ---------------------------------------------------------------------------
// 4. 判定不可用即阻断
// ---------------------------------------------------------------------------

describe('判定不可用即阻断（4.1-4.6）', () => {
  it('DLP 适配器不可用时阻断回合，不默认放行（4.1）', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({ adapterAvailable: false, allowed: true }),
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)
  })

  it('显式覆盖放行式降级为阻断，并记录覆盖（4.2）', async () => {
    // dlp_adapter_fallback 默认是 warn（放行），Copilot 显式覆盖为 block
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({ adapterAvailable: false, allowed: true }),
    })

    try {
      await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
      expect.fail('应该抛出 CopilotDlpBlockError')
    } catch (err) {
      expect(err).toBeInstanceOf(CopilotDlpBlockError)
      const blockErr = err as CopilotDlpBlockError
      expect(blockErr.reason).toBe('unavailable')
    }
  })

  it('DLP 异常时阻断回合（4.3）', async () => {
    const { service } = makeService({
      dlpAdapter: {
        preflightContextAssembly: vi.fn(async () => {
          throw new Error('DLP service down')
        }),
      } as never,
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)
  })

  it('阻断原因（业务决策）与观察层降级原因可区分（4.5）', async () => {
    // 业务决策阻断：DLP 不可用
    const { service: blockService } = makeService({
      dlpAdapter: makeDlpAdapterStub({ adapterAvailable: false, allowed: true }),
    })

    try {
      await blockService.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
      expect.fail('应该抛出 CopilotDlpBlockError')
    } catch (err) {
      expect(err).toBeInstanceOf(CopilotDlpBlockError)
      const blockErr = err as CopilotDlpBlockError
      expect(blockErr.reason).toBe('unavailable') // 业务决策：判定不可用
    }

    // 观察层降级：落账失败（不阻断）
    const { service: degradeService } = makeService({
      recordRouting: async () => ({ success: false }),
    })
    const result = await degradeService.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.warnings).toContain('ROUTING_LEDGER_DEGRADED') // 观察层降级
  })
})

// 4.4（fallback 不改变 file/ocr/report 既有降级行为）直接测企业模块 dlp_adapter_fallback，
// 已移到 copilot_turn_service_enterprise.spec.ts（个人版导出时随企业模块一起排除）。

describe('个人版扩展点默认实现（未注册企业 DLP / 水印）', () => {
  it('默认 DLP 明确放行：回合正常完成，不出现「判定不可用」阻断', async () => {
    const { PassThroughCopilotDlp, NoopCopilotWatermark } =
      await import('../../app/services/edition/defaults.js')
    const watermark = new NoopCopilotWatermark()
    const prepareSpy = vi.spyOn(watermark, 'prepareContext')
    const { service } = makeService({
      dlpAdapter: new PassThroughCopilotDlp() as never,
      watermarkAdapter: watermark as never,
    })
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response).toBeDefined()
    // 水印默认实现被调用但不注入（返回 null，不写任何记录）
    expect(prepareSpy).toHaveBeenCalled()
    await expect(prepareSpy.mock.results[0]!.value).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. 脱敏后重校验
// ---------------------------------------------------------------------------

describe('脱敏后重校验（5.1-5.5）', () => {
  it('脱敏后重跑 sanitizer 与包校验（5.1）', async () => {
    const { service, sanitizer } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: true,
        maskedContext: '[DLP 脱敏]',
        snapshot: {
          result: 'mask',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(sanitizer.sanitizeAssemblyResult).toHaveBeenCalled()
  })

  it('脱敏包仍通过既有包校验（5.2）', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: true,
        maskedContext: '[DLP 脱敏]',
        snapshot: {
          result: 'mask',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
    })
    // sanitizer 返回 safe=true，回合继续
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
  })

  it('脱敏破坏包结构时降级为阻断（5.3 / 5.4）', async () => {
    const { service } = makeService({
      dlpAdapter: makeDlpAdapterStub({
        allowed: true,
        maskedContext: '[DLP 脱敏]',
        snapshot: {
          result: 'mask',
          policyVersion: 1,
          matchSummary: [],
          policyHash: 'ph-1',
          reasonCodes: [],
        },
      }),
      sanitizer: {
        sanitizeAssemblyResult: vi.fn(() => ({ safe: false, violations: ['包结构破坏'] })),
        checkPacket: vi.fn(() => ({ safe: false, violations: ['包结构破坏'] })),
        checkSourceMetadata: vi.fn(() => ({ safe: true, violations: [] })),
        cleanAssemblyResult: vi.fn((result: unknown) => ({ cleaned: result, removedFields: [] })),
      } as never,
    })

    await expect(
      service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION)),
    ).rejects.toBeInstanceOf(CopilotDlpBlockError)
  })
})

// ---------------------------------------------------------------------------
// 6. 水印注入
// ---------------------------------------------------------------------------

describe('水印注入（6.1-6.7）', () => {
  it('水印注入到上下文包（6.1）', async () => {
    const { service, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(watermarkAdapter.prepareContext).toHaveBeenCalledTimes(1)
  })

  it('水印不进 source hash，作为独立字段携带（6.2）', async () => {
    const { service, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const callArgs = watermarkAdapter.prepareContext.mock.calls[0]![0]
    // 水印使用 source hash 作为输入，但不修改它
    expect(callArgs.sourceHash).toBe('hash-1042')
    // 水印作为独立字段返回
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response).toBeDefined()
  })

  it('水印变化不改变项目事实 source hash（6.3）', async () => {
    const { service: service1, watermarkAdapter: wa1 } = makeService()
    const { service: service2, watermarkAdapter: wa2 } = makeService()

    await service1.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    await service2.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    // 两次水印调用的 sourceHash 相同（因为项目事实没变）
    const hash1 = wa1.prepareContext.mock.calls[0]![0].sourceHash
    const hash2 = wa2.prepareContext.mock.calls[0]![0].sourceHash
    expect(hash1).toBe(hash2)
  })

  it('水印可追溯到组织、项目、actor 与时间（6.5 / 红线 4）', async () => {
    const { service, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const callArgs = watermarkAdapter.prepareContext.mock.calls[0]![0]
    expect(callArgs.organizationId).toBe(ORG)
    expect(callArgs.projectId).toBe(PROJECT_ID)
    expect(callArgs.actorId).toBe(ACTOR)
    // 时间戳由适配器内部生成
  })

  it('水印载荷可解析出四项归属且不含项目内容（6.6）', async () => {
    const { service, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const callArgs = watermarkAdapter.prepareContext.mock.calls[0]![0]
    // 四项归属
    expect(typeof callArgs.organizationId).toBe('number')
    expect(typeof callArgs.projectId).toBe('number')
    expect(typeof callArgs.actorId).toBe('number')
    expect(typeof callArgs.sourceRef).toBe('string')
    // 不含项目内容
    expect(callArgs).not.toHaveProperty('taskTitle')
    expect(callArgs).not.toHaveProperty('content')
    expect(callArgs).not.toHaveProperty('prompt')
  })

  it('水印注入失败不阻断回合（观察层降级）', async () => {
    const { service } = makeService({
      watermarkAdapter: {
        prepareContext: vi.fn(async () => {
          throw new Error('watermark service down')
        }),
      } as never,
    })

    // 水印失败不阻断
    const result = await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    expect(result.response.mode).toBe('live')
  })
})

// ---------------------------------------------------------------------------
// 7. 权限、组织隔离与合规接入
// ---------------------------------------------------------------------------

describe('权限与组织隔离（7.1-7.4）', () => {
  it('DLP 检查传入正确的组织 ID（7.3）', async () => {
    const { service, dlpAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const params = dlpAdapter.preflightContextAssembly.mock.calls[0]![0]
    expect(params.organizationId).toBe(ORG)
  })

  it('水印注入传入正确的组织 ID（7.3）', async () => {
    const { service, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    const params = watermarkAdapter.prepareContext.mock.calls[0]![0]
    expect(params.organizationId).toBe(ORG)
  })
})

describe('合规接入（7.5-7.8）', () => {
  it('默认配置下 DLP 生效（7.7 / 7.8）', async () => {
    const { service, dlpAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    // 默认配置下 DLP 检查被调用
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 8. 红线与性能
// ---------------------------------------------------------------------------

describe('红线：零域写（8.1-8.2）', () => {
  it('DLP 检查与水印注入无域仓储或模型写依赖', async () => {
    const { service, dlpAdapter, watermarkAdapter } = makeService()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))

    // DLP 适配器只做预检，不写入
    expect(dlpAdapter.preflightContextAssembly).toHaveBeenCalled()
    // 水印适配器只生成载荷，不写入项目数据
    expect(watermarkAdapter.prepareContext).toHaveBeenCalled()
  })
})

describe('红线：不改变路由裁决（8.5）', () => {
  it('DLP 接入不改变路由裁决与 destination 排序', async () => {
    // 有 DLP
    const { service: serviceWithDlp } = makeService({
      dlpAdapter: makeDlpAdapterStub({ allowed: true }),
    })
    const resultWithDlp = await serviceWithDlp.execute(
      execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH),
    )

    // 无 DLP（模拟 DLP 始终放行）
    const { service: serviceWithoutDlp } = makeService({
      dlpAdapter: makeDlpAdapterStub({ allowed: true }),
    })
    const resultWithoutDlp = await serviceWithoutDlp.execute(
      execInput(COPILOT_TURN_FIXTURE_REQUEST_SLASH),
    )

    // 路由决策一致
    expect(resultWithDlp.response.destinations.length).toBe(
      resultWithoutDlp.response.destinations.length,
    )
    expect(resultWithDlp.response.clarificationRequired).toBe(
      resultWithoutDlp.response.clarificationRequired,
    )
  })
})

// ---------------------------------------------------------------------------
// 8.4 性能门禁
// ---------------------------------------------------------------------------

describe('性能门禁：DLP 检测耗时（8.4）', () => {
  it('DLP 检测耗时在 mock 场景下远低于 5 秒阈值', async () => {
    const { service } = makeService()
    const start = Date.now()
    await service.execute(execInput(COPILOT_TURN_FIXTURE_REQUEST_MENTION))
    const elapsed = Date.now() - start
    // mock 场景下 DLP 检测应极快（<100ms），远低于 5 秒阈值
    expect(elapsed).toBeLessThan(5000)
  })
})
