import { describe, expect, test } from 'vitest'
import {
  PROJECT_DRAFT_MODULES,
  type ProjectDraftStreamEvent,
  type StreamingProgressEnvelope,
} from '@aiproj/types'
import {
  createDraftProgressProjection,
  reduceDraftProgress,
  selectCompletedModuleCount,
  isContractCompatible,
  isKnownEventType,
  projectDraftEventToEnvelope,
  streamingEnvelopeToDraftAction,
  replayResponseToActions,
  computeHealthState,
  withHealthState,
  deriveReasonCode,
  REASON_CODES,
  DEFAULT_STALL_THRESHOLDS,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_LONG_RUNNING_MS,
  DEFAULT_STALE_MS,
} from '@/lib/ai-draft/progress-projection'
import {
  AI_DRAFT_PROGRESS_CURSOR_KEY,
  AI_DRAFT_PROGRESS_CURSOR_TTL_MS,
  clearDraftProgressCursor,
  readDraftProgressCursor,
  writeDraftProgressCursor,
} from '@/lib/ai-draft/progress-cursor'

type EventWithoutScope = ProjectDraftStreamEvent extends infer Event
  ? Event extends ProjectDraftStreamEvent
    ? Omit<Event, 'draftId' | 'version'>
    : never
  : never

function event(value: EventWithoutScope): ProjectDraftStreamEvent {
  return { draftId: 'draft-1', version: 1, ...value } as ProjectDraftStreamEvent
}

function makeEnvelope(
  overrides: Partial<StreamingProgressEnvelope> = {},
): StreamingProgressEnvelope {
  return {
    contractVersion: '1.0',
    eventId: 'draft-1-1',
    streamId: 'draft-1',
    domain: 'ai-draft',
    sequence: 1,
    occurredAt: new Date().toISOString(),
    type: 'started',
    payload: {},
    ...overrides,
  } as StreamingProgressEnvelope
}

describe('AI 草案实时进度投影', () => {
  test('九模块状态机由 pending → generating → completed，完成后不回退', () => {
    let state = createDraftProgressProjection()
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({
        type: 'draft.started',
        sequence: 1,
        projectType: 'software',
        modules: [...PROJECT_DRAFT_MODULES],
      }),
    })
    expect(Object.values(state.modules)).toEqual(PROJECT_DRAFT_MODULES.map(() => 'pending'))

    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.delta', sequence: 2, module: 'charter', status: 'generating' }),
    })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.completed', sequence: 3, module: 'charter' }),
    })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.delta', sequence: 4, module: 'charter', status: 'generating' }),
    })

    expect(state.modules.charter).toBe('completed')
    expect(selectCompletedModuleCount(state)).toBe(1)
  })

  test('重复、乱序事件幂等，heartbeat 只更新连接活性不推进 cursor', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 4 })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.completed', sequence: 4, module: 'tasks' }),
    })
    expect(state.modules.tasks).toBe('pending')

    state = reduceDraftProgress(state, {
      kind: 'event',
      receivedAt: 1234,
      event: event({ type: 'draft.heartbeat', sequence: 4, elapsedMs: 1_000 }),
    })
    expect(state.lastSequence).toBe(4)
    expect(state.lastHeartbeatAt).toBe(1234)
    expect(state.connection).toBe('live')
  })

  test('发现 sequence gap 时冻结投影，按 cursor 重放补齐后再继续', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 2 })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.completed', sequence: 5, module: 'tasks' }),
    })
    expect(state.recovery).toMatchObject({
      state: 'gap',
      expectedSequence: 3,
      targetSequence: 5,
    })
    expect(state.modules.tasks).toBe('pending')
    expect(state.lastSequence).toBe(2)

    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.delta', sequence: 3, module: 'tasks', status: 'generating' }),
    })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'draft.progress', sequence: 4, phase: 'validating', receivedChars: 50 }),
    })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({ type: 'module.completed', sequence: 5, module: 'tasks' }),
    })

    expect(state.recovery.state).toBe('none')
    expect(state.lastSequence).toBe(5)
    expect(state.modules.tasks).toBe('completed')
  })

  test('terminal 事件唯一，后续进度与模块事件不能回退完成态', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 8 })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({
        type: 'draft.completed',
        sequence: 9,
        draft: {} as never,
        meta: {} as never,
        validation: {} as never,
      }),
    })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: event({
        type: 'draft.progress',
        sequence: 10,
        phase: 'receiving',
        receivedChars: 100,
      }),
    })

    expect(state.terminal).toBe('completed')
    expect(state.preparingReview).toBe(true)
    expect(Object.values(state.modules).every((status) => status === 'completed')).toBe(true)
    expect(state.lastSequence).toBe(9)
  })

  test('连接中断只要求显式恢复，不自动把草案判定失败', () => {
    const state = reduceDraftProgress(createDraftProgressProjection(), {
      kind: 'transport.disconnected',
      message: '网络已中断',
    })
    expect(state.connection).toBe('failed')
    expect(state.retryRequired).toBe(true)
    expect(state.terminal).toBe('none')
    expect(state.errorMessage).toBe('网络已中断')
  })
})

describe('AI 草案恢复 cursor', () => {
  test('只保存低敏恢复字段，并按用户/组织隔离', () => {
    clearDraftProgressCursor()
    writeDraftProgressCursor({
      userId: 7,
      organizationId: 9,
      draftId: 'draft-1',
      version: 2,
      lastSequence: 18,
    })

    const raw = sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY) ?? ''
    expect(raw).not.toContain('prompt')
    expect(raw).not.toContain('chunk')
    expect(raw).not.toContain('draftEvents')
    expect(readDraftProgressCursor({ userId: 7, organizationId: 9 })).toMatchObject({
      draftId: 'draft-1',
      lastSequence: 18,
    })
    expect(readDraftProgressCursor({ userId: 8, organizationId: 9 })).toBeNull()
  })

  test('损坏 cursor 被安全忽略并清理', () => {
    sessionStorage.setItem(AI_DRAFT_PROGRESS_CURSOR_KEY, '{broken')
    expect(readDraftProgressCursor({ userId: 7, organizationId: 9 })).toBeNull()
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
  })

  test('过期 cursor 被清理，不跨会话自动恢复', () => {
    sessionStorage.setItem(
      AI_DRAFT_PROGRESS_CURSOR_KEY,
      JSON.stringify({
        userId: 7,
        organizationId: 9,
        draftId: 'draft-old',
        version: 1,
        lastSequence: 2,
        contractVersion: '1.0',
        timestamp: Date.now() - AI_DRAFT_PROGRESS_CURSOR_TTL_MS - 1,
      }),
    )
    expect(readDraftProgressCursor({ userId: 7, organizationId: 9 })).toBeNull()
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
  })
})

describe('StreamingProgressEnvelope 适配器', () => {
  test('isContractCompatible 判断 major 版本兼容性', () => {
    expect(isContractCompatible('1.0')).toEqual({ compatible: true, major: 1 })
    expect(isContractCompatible('1.5')).toEqual({ compatible: true, major: 1 })
    expect(isContractCompatible('2.0')).toEqual({ compatible: false, major: 2 })
    expect(isContractCompatible('0.9')).toEqual({ compatible: false, major: 0 })
  })

  test('isKnownEventType 识别已知旧事件类型', () => {
    expect(isKnownEventType('draft.started')).toBe(true)
    expect(isKnownEventType('module.delta')).toBe(true)
    expect(isKnownEventType('draft.completed')).toBe(true)
    expect(isKnownEventType('draft.telemetry')).toBe(false)
    expect(isKnownEventType('unknown.new_feature')).toBe(false)
  })

  describe('projectDraftEventToEnvelope', () => {
    test('draft.started → started envelope', () => {
      const result = projectDraftEventToEnvelope(
        event({
          type: 'draft.started',
          sequence: 1,
          projectType: 'software',
          modules: [...PROJECT_DRAFT_MODULES],
        }),
      )
      expect(result.type).toBe('started')
      expect(result.domain).toBe('ai-draft')
      expect(result.sequence).toBe(1)
      expect(result.streamId).toBe('draft-1')
    })

    test('module.delta → progress envelope with ai-draft domain payload', () => {
      const result = projectDraftEventToEnvelope(
        event({
          type: 'module.delta',
          sequence: 2,
          module: 'charter',
          status: 'generating',
        }),
      )
      expect(result.type).toBe('progress')
      expect(result._domainPayload?.domain).toBe('ai-draft')
      if (result._domainPayload?.domain === 'ai-draft') {
        expect(result._domainPayload.progress?.module).toBe('charter')
        expect(result._domainPayload.progress?.moduleStatus).toBe('generating')
      }
    })

    test('draft.heartbeat → heartbeat envelope', () => {
      const result = projectDraftEventToEnvelope(
        event({
          type: 'draft.heartbeat',
          sequence: 3,
          elapsedMs: 500,
        }),
      )
      expect(result.type).toBe('heartbeat')
      expect(result.payload).toEqual({})
    })

    test('draft.completed → completed envelope', () => {
      const result = projectDraftEventToEnvelope(
        event({
          type: 'draft.completed',
          sequence: 10,
          draft: {} as never,
          meta: {} as never,
          validation: {} as never,
        }),
      )
      expect(result.type).toBe('completed')
      expect(result.payload).toMatchObject({ summary: expect.any(String) })
    })

    test('draft.failed → failed envelope', () => {
      const result = projectDraftEventToEnvelope(
        event({
          type: 'draft.failed',
          sequence: 10,
          errorCode: 'PARSE_ERROR',
          message: '解析失败',
          consistency: 'failed',
        }),
      )
      expect(result.type).toBe('failed')
      expect(result.payload).toMatchObject({ errorCode: 'PARSE_ERROR' })
    })
  })

  describe('streamingEnvelopeToDraftAction', () => {
    test('AI Draft domain envelope → envelope action', () => {
      const envelope = makeEnvelope({ type: 'progress', sequence: 2 })
      const action = streamingEnvelopeToDraftAction(envelope)
      expect(action).not.toBeNull()
      if (action) {
        expect(action.kind).toBe('envelope')
        if (action.kind === 'envelope') {
          expect(action.envelope.type).toBe('progress')
        }
      }
    })

    test('非 AI Draft domain → null（安全忽略）', () => {
      const action = streamingEnvelopeToDraftAction(makeEnvelope({ domain: 'compiler' }))
      expect(action).toBeNull()
    })

    test('contract major 不兼容 → contract.incompatible action', () => {
      const action = streamingEnvelopeToDraftAction(makeEnvelope({ contractVersion: '2.0' }))
      expect(action).not.toBeNull()
      expect(action!.kind).toBe('contract.incompatible')
    })
  })

  describe('replayResponseToActions', () => {
    test('正常回放事件列表 → envelope actions', () => {
      const actions = replayResponseToActions({
        events: [
          makeEnvelope({ type: 'progress', sequence: 5 }),
          makeEnvelope({ type: 'completed', sequence: 6 }),
        ],
        resetRequired: false,
      })
      expect(actions).toHaveLength(2)
      expect(actions[0]!.kind).toBe('envelope')
      expect(actions[1]!.kind).toBe('envelope')
    })

    test('reset-required → contract.incompatible action', () => {
      const actions = replayResponseToActions({
        events: [],
        resetRequired: true,
        resetMessage: 'retention expired',
      })
      expect(actions).toHaveLength(1)
      expect(actions[0]!.kind).toBe('contract.incompatible')
    })
  })
})

describe('Envelope Reducer — heartbeat 与语义进度分离', () => {
  test('heartbeat 只更新连接活性，不更新 lastSemanticProgressAt', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 1 })
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 2,
        payload: { phase: 'charter' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'charter', moduleStatus: 'generating' },
        },
      }),
      receivedAt: 1000,
    })
    expect(state.lastSemanticProgressAt).toBe(1000)

    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({ type: 'heartbeat', sequence: 3, payload: {} }),
      receivedAt: 2000,
    })
    // lastSemanticProgressAt 保持原值（不更新），lastHeartbeatAt 更新
    expect(state.lastSemanticProgressAt).toBe(1000)
    expect(state.lastHeartbeatAt).toBe(2000)
  })

  test('heartbeat 不增加模块完成数、不改变 phase', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 0 })
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 1,
        payload: { phase: 'charter' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'charter', moduleStatus: 'generating' },
        },
      }),
    })
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({ type: 'heartbeat', sequence: 2, payload: {} }),
    })
    expect(state.modules.charter).toBe('generating')
    expect(selectCompletedModuleCount(state)).toBe(0)
  })

  test('contract.incompatible action 进入 failed 状态', () => {
    const state = reduceDraftProgress(createDraftProgressProjection(), {
      kind: 'contract.incompatible',
      message: 'unsupported version 2.0',
      contractVersion: '2.0',
    })
    expect(state.terminal).toBe('failed')
    expect(state.retryRequired).toBe(true)
    expect(state.errorCode).toBe('CONTRACT_INCOMPATIBLE')
  })
})

describe('Envelope Reducer — 回放与 reset-required', () => {
  test('序列 gap 通过 envelope 进入 recovering 状态', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 2 })
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 5,
        payload: { phase: 'charter' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'charter', moduleStatus: 'generating' },
        },
      }),
    })
    expect(state.recovery.state).toBe('gap')
    expect(state.connection).toBe('recovering')
  })

  test('回放收敛后恢复 live 状态', () => {
    let state = createDraftProgressProjection({ draftId: 'draft-1', lastSequence: 1 })
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 4,
        payload: { phase: 'tasks' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'tasks', moduleStatus: 'generating' },
        },
      }),
    })
    expect(state.recovery.state).toBe('gap')
    expect(state.recovery.targetSequence).toBe(4)

    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 2,
        eventId: 'draft-1-2',
        payload: { phase: 'charter' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'charter', moduleStatus: 'completed' },
        },
      }),
    })
    expect(state.recovery.state).toBe('replaying')
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 3,
        eventId: 'draft-1-3',
        payload: { phase: 'wbs' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'wbs', moduleStatus: 'generating' },
        },
      }),
    })
    expect(state.recovery.state).toBe('replaying')
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 4,
        eventId: 'draft-1-4',
        payload: { phase: 'tasks' },
        _domainPayload: {
          domain: 'ai-draft',
          draftId: 'draft-1',
          progress: { module: 'tasks', moduleStatus: 'generating' },
        },
      }),
    })
    expect(state.recovery.state).toBe('none')
    expect(state.connection).toBe('live')
    expect(state.lastSequence).toBe(4)
  })
})

describe('Store — applyDraftEnvelope 集成', () => {
  test('envelope 更新投影和模块状态', async () => {
    const { useAiProjectDraftStore } = await import('@/stores/ai-project-draft-store')
    useAiProjectDraftStore.setState({ userId: 1, organizationId: 1 })
    useAiProjectDraftStore.getState().startDraftGeneration('envelope-draft')

    const envelope = makeEnvelope({
      eventId: 'envelope-draft-1',
      streamId: 'envelope-draft',
      sequence: 1,
      type: 'started',
      payload: {},
      _domainPayload: { domain: 'ai-draft', draftId: 'envelope-draft' },
    })
    useAiProjectDraftStore.getState().applyDraftEnvelope(envelope)

    const state = useAiProjectDraftStore.getState()
    expect(state.progressProjection.lastSequence).toBe(1)
    expect(state.progressProjection.contractVersion).toBe('1.0')
  })

  test('不同 major 版本 → contract incompatible 状态', async () => {
    const { useAiProjectDraftStore } = await import('@/stores/ai-project-draft-store')
    useAiProjectDraftStore.getState().startDraftGeneration('bad-version')
    const envelope = makeEnvelope({ contractVersion: '3.0', eventId: 'bad-3', sequence: 1 })

    useAiProjectDraftStore.getState().applyDraftEnvelope(envelope)
    const state = useAiProjectDraftStore.getState()
    expect(state.progressProjection.terminal).toBe('failed')
    expect(state.progressProjection.errorCode).toBe('CONTRACT_INCOMPATIBLE')
  })
})

// =============================================================================
// V2.5 超时/停滞恢复测试
// =============================================================================

describe('V2.5 timeout/stall — 健康状态计算', () => {
  const NOW = 50000
  const t = DEFAULT_STALL_THRESHOLDS

  test('healthy — 有活跃 heartbeat 且未超时', () => {
    const state = computeHealthState(NOW, 'live', 'none', NOW - 2000, NOW - 500, 5000, t, 0, false)
    expect(state).toBe('healthy')
  })

  test('long_running — heartbeat 存活但语义进度超过 30s', () => {
    const state = computeHealthState(
      NOW,
      'live',
      'none',
      NOW - 35000,
      NOW - 500,
      36000,
      t,
      0,
      false,
    )
    expect(state).toBe('long_running')
  })

  test('healthy — heartbeat 过期但语义事件仍持续到达', () => {
    const state = computeHealthState(
      NOW,
      'live',
      'none',
      NOW - 2000,
      NOW - t.staleMs - 1000,
      5000,
      t,
      0,
      false,
    )
    expect(state).toBe('healthy')
  })

  test('stale — heartbeat 与语义事件都超过 3 个周期未到', () => {
    const state = computeHealthState(
      NOW,
      'live',
      'none',
      NOW - t.staleMs - 2000,
      NOW - t.staleMs - 1000,
      5000,
      t,
      0,
      false,
    )
    expect(state).toBe('stale')
  })

  test('reconnecting — 连接中', () => {
    const state = computeHealthState(
      NOW,
      'connecting',
      'none',
      NOW - 2000,
      NOW - 500,
      5000,
      t,
      0,
      false,
    )
    expect(state).toBe('reconnecting')
  })

  test('fallback_status — 非 live/closed/connecting 连接状态', () => {
    const state = computeHealthState(
      NOW,
      'recovering',
      'none',
      NOW - 2000,
      NOW - 500,
      5000,
      t,
      0,
      false,
    )
    expect(state).toBe('fallback_status')
  })

  test('user_retry_required — retryRequired 为 true', () => {
    const state = computeHealthState(NOW, 'live', 'none', NOW - 2000, NOW - 500, 5000, t, 0, true)
    expect(state).toBe('user_retry_required')
  })

  test('terminal 非 none → healthy（不计算 health）', () => {
    const state = computeHealthState(
      NOW,
      'closed',
      'completed',
      NOW - 2000,
      NOW - 500,
      5000,
      t,
      0,
      false,
    )
    expect(state).toBe('healthy')
  })

  test('heartbeat alive 只进入 long_running、不进入 failed', () => {
    const state = computeHealthState(
      NOW,
      'live',
      'none',
      NOW - 60000,
      NOW - 1000,
      61000,
      t,
      0,
      false,
    )
    expect(state).toBe('long_running')
    expect(state).not.toBe('failed')
    expect(state).not.toBe('stale')
  })
})

describe('V2.5 timeout/stall — reason code 穷尽性', () => {
  test('REASON_CODES 包含全部 12 个稳定码', () => {
    expect(REASON_CODES).toHaveLength(12)
    expect(REASON_CODES).toContain('STREAM_LONG_RUNNING')
    expect(REASON_CODES).toContain('STREAM_HEARTBEAT_STALE')
    expect(REASON_CODES).toContain('STREAM_RECONNECTING')
    expect(REASON_CODES).toContain('STREAM_REPLAY_RESET_REQUIRED')
    expect(REASON_CODES).toContain('STREAM_RETENTION_MISS')
    expect(REASON_CODES).toContain('STREAM_CONTRACT_INCOMPATIBLE')
    expect(REASON_CODES).toContain('STREAM_PROVIDER_TIMEOUT')
    expect(REASON_CODES).toContain('STREAM_PROXY_TIMEOUT')
    expect(REASON_CODES).toContain('STREAM_STATUS_UNAVAILABLE')
    expect(REASON_CODES).toContain('STREAM_ORPHANED_RUNNER')
    expect(REASON_CODES).toContain('STREAM_UPSTREAM_FAILED')
    expect(REASON_CODES).toContain('STREAM_USER_RETRY_REQUIRED')
  })

  test('deriveReasonCode maps long_running health to STREAM_LONG_RUNNING', () => {
    expect(deriveReasonCode('long_running', 'live', 'none', null)).toBe('STREAM_LONG_RUNNING')
  })

  test('deriveReasonCode maps stale to STREAM_HEARTBEAT_STALE', () => {
    expect(deriveReasonCode('stale', 'live', 'none', null)).toBe('STREAM_HEARTBEAT_STALE')
  })

  test('deriveReasonCode maps terminal failed to STREAM_UPSTREAM_FAILED if no current reason', () => {
    expect(deriveReasonCode('healthy', 'failed', 'failed', null)).toBe('STREAM_UPSTREAM_FAILED')
  })

  test('deriveReasonCode preserves current reason on terminal failed', () => {
    expect(deriveReasonCode('healthy', 'failed', 'failed', 'STREAM_CONTRACT_INCOMPATIBLE')).toBe(
      'STREAM_CONTRACT_INCOMPATIBLE',
    )
  })
})

describe('V2.5 timeout/stall — 阈值常量', () => {
  test('long running 阈值默认 30s', () => {
    expect(DEFAULT_LONG_RUNNING_MS).toBe(30_000)
  })

  test('stale 阈值默认 3 个 heartbeat 周期', () => {
    expect(DEFAULT_STALE_MS).toBe(DEFAULT_HEARTBEAT_CADENCE_MS * 3)
  })

  test('阈值可通过配置覆盖', () => {
    expect(DEFAULT_STALL_THRESHOLDS.heartbeatCadenceMs).toBe(5_000)
    expect(DEFAULT_STALL_THRESHOLDS.longRunningMs).toBe(30_000)
    expect(DEFAULT_STALL_THRESHOLDS.staleMs).toBe(15_000)
    expect(DEFAULT_STALL_THRESHOLDS.maxReconnectAttempts).toBe(3)
    expect(DEFAULT_STALL_THRESHOLDS.reconnectBackoffMaxMs).toBe(10_000)
    expect(DEFAULT_STALL_THRESHOLDS.statusTimeoutMs).toBe(10_000)
    expect(DEFAULT_STALL_THRESHOLDS.runnerTtlMs).toBe(15 * 60 * 1000)
  })
})

describe('V2.5 timeout/stall — withHealthState 集成', () => {
  test('transport.connecting → 设置 reconnecting health state', () => {
    let state = createDraftProgressProjection()
    state = reduceDraftProgress(state, { kind: 'transport.connecting' })
    expect(state.healthState).toBe('reconnecting')
    expect(state.reasonCode).toBe('STREAM_RECONNECTING')
  })

  test('transport.live → 重置为 healthy', () => {
    let state = createDraftProgressProjection()
    state = reduceDraftProgress(state, { kind: 'transport.connecting' })
    state = reduceDraftProgress(state, { kind: 'transport.live' })
    expect(state.healthState).toBe('healthy')
    expect(state.reasonCode).toBeNull()
  })

  test('transport.disconnected → proxy timeout reason', () => {
    let state = createDraftProgressProjection()
    state = reduceDraftProgress(state, { kind: 'transport.disconnected', message: '网络断开' })
    expect(state.healthState).toBe('user_retry_required')
    expect(state.reasonCode).toBe('STREAM_PROXY_TIMEOUT')
    expect(state.retryRequired).toBe(true)
  })

  test('transport.replaying → reconnecting reason + attempt 递增', () => {
    let state = createDraftProgressProjection()
    state = reduceDraftProgress(state, { kind: 'transport.replaying' })
    expect(state.healthState).toBe('fallback_status')
    expect(state.reasonCode).toBe('STREAM_RECONNECTING')
    expect(state.reconnectAttempt).toBe(1)
  })

  test('contract.incompatible → CONTRACT_INCOMPATIBLE reason', () => {
    let state = createDraftProgressProjection()
    state = reduceDraftProgress(state, {
      kind: 'contract.incompatible',
      message: 'major 2.0',
      contractVersion: '2.0',
    })
    expect(state.healthState).toBe('user_retry_required')
    expect(state.reasonCode).toBe('STREAM_CONTRACT_INCOMPATIBLE')
    expect(state.terminal).toBe('failed')
  })
})

describe('V2.5 timeout/stall — 投影与恢复集成', () => {
  function makeEnvelope(
    overrides: Partial<StreamingProgressEnvelope> = {},
  ): StreamingProgressEnvelope {
    return {
      contractVersion: '1.0',
      eventId: 'draft-1-1',
      streamId: 'draft-1',
      domain: 'ai-draft',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      type: 'started',
      payload: {},
      ...overrides,
    } as StreamingProgressEnvelope
  }

  test('long-running 状态由 projection elapsedMs 触发', () => {
    let state = createDraftProgressProjection({ draftId: 'long-1', lastSequence: 2 })
    state = {
      ...state,
      connection: 'live',
      lastSemanticProgressAt: 0,
      lastHeartbeatReceivedAt: Date.now(),
      elapsedMs: 35_000,
    }
    const withHealth = withHealthState(state)
    expect(withHealth.healthState).toBe('long_running')
    expect(withHealth.reasonCode).toBe('STREAM_LONG_RUNNING')
  })

  test('stale 状态只在 heartbeat 与语义进度都过期时触发', () => {
    let state = createDraftProgressProjection({ draftId: 'stale-1', lastSequence: 2 })
    state = {
      ...state,
      connection: 'live',
      lastHeartbeatReceivedAt: Date.now() - 20_000,
      lastSemanticProgressAt: Date.now() - 20_000,
    }
    const withHealth = withHealthState(state)
    expect(withHealth.healthState).toBe('stale')
    expect(withHealth.reasonCode).toBe('STREAM_HEARTBEAT_STALE')
  })

  test('heartbeat 事件更新 lastHeartbeatReceivedAt', () => {
    let state = createDraftProgressProjection({ draftId: 'hb-1' })
    expect(state.lastHeartbeatReceivedAt).toBeNull()

    state = reduceDraftProgress(state, {
      kind: 'event',
      event: {
        draftId: 'hb-1',
        version: 1,
        type: 'draft.heartbeat',
        sequence: 1,
        elapsedMs: 100,
      },
    })
    expect(state.lastHeartbeatReceivedAt).not.toBeNull()
    expect(state.healthState).toBe('healthy')
  })

  test('envelope gap → recovering 状态', () => {
    let state = createDraftProgressProjection({ draftId: 'gap-1', lastSequence: 2 })
    state = reduceDraftProgress(state, {
      kind: 'envelope',
      envelope: makeEnvelope({
        type: 'progress',
        sequence: 5,
        eventId: 'gap-1-5',
        payload: { phase: 'charter' },
        _domainPayload: { domain: 'ai-draft', draftId: 'gap-1', progress: undefined },
      }),
    })
    expect(state.connection).toBe('recovering')
    expect(state.recovery.state).toBe('gap')
  })
})

describe('pending 占位 draftId 采纳（heartbeat 保活前提）', () => {
  test('draftId=pending 时 draft.started 采纳真实 ID，之后 heartbeat 更新活性', () => {
    let state = createDraftProgressProjection({ draftId: 'pending' })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: {
        draftId: 'real-1',
        version: 1,
        type: 'draft.started',
        sequence: 1,
        projectType: 'software',
        modules: [],
      },
    })
    expect(state.draftId).toBe('real-1')
    expect(state.lastEventAt).not.toBeNull()

    state = reduceDraftProgress(state, {
      kind: 'event',
      event: {
        draftId: 'real-1',
        version: 1,
        type: 'draft.heartbeat',
        sequence: 2,
        elapsedMs: 100,
      },
    })
    expect(state.lastHeartbeatReceivedAt).not.toBeNull()
    expect(state.healthState).toBe('healthy')
  })

  test('pending 下非 started 的真实事件不会误接管连接', () => {
    let state = createDraftProgressProjection({ draftId: 'pending' })
    state = reduceDraftProgress(state, {
      kind: 'event',
      event: {
        draftId: 'real-1',
        version: 1,
        type: 'draft.heartbeat',
        sequence: 1,
        elapsedMs: 100,
      },
    })
    expect(state.draftId).toBe('pending')
    expect(state.lastHeartbeatReceivedAt).toBeNull()
  })
})
