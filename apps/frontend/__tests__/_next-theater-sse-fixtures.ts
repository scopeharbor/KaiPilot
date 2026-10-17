/**
 * W1 生成剧场 SSE 客户端测试共享夹具（v3-ui-next-theater-generation）。
 * 仅供 `__tests__/next-theater-sse-*.test.*` 使用；不匹配 vitest 测试通配。
 */

import {
  PROJECT_DRAFT_MODULES,
  type ConfirmedProjectContext,
  type DraftCompletedEvent,
  type DraftHeartbeatEvent,
  type DraftModuleCompletedEvent,
  type DraftModuleDeltaEvent,
  type DraftProgressEvent,
  type DraftStartedEvent,
  type DraftValidationIssue,
  type DraftValidationReport,
  type GenerationOutputEvent,
  type ProjectDraft,
  type ProjectDraftConsistency,
  type ProjectDraftDetail,
  type ProjectDraftMeta,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
  type ProgressPhase,
  type ProjectDraftStreamEvent,
} from '@aiproj/types'

export const TEST_DRAFT_ID = 'draft-test-001'

// ---------------------------------------------------------------------------
// 权威载荷夹具（对齐 __tests__/ai-draft-store-sse.test.ts 的既有结构）
// ---------------------------------------------------------------------------

export function makeMockDraft(projectType: ProjectDraft['projectType'] = 'software'): ProjectDraft {
  return {
    schemaVersion: '1.0',
    projectType,
    charter: {
      title: {
        value: '测试项目',
        marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      vision: {
        value: '测试愿景',
        marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      scope: {
        value: '测试范围',
        marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      objectives: {
        value: ['目标1'],
        marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      successCriteria: {
        value: ['标准1'],
        marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
      },
      startDate: {
        value: '2026-07-01',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      endDate: {
        value: '2026-09-30',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
    },
    wbs: [],
    tasks: [],
    dependencies: [],
    acceptanceCriteria: [],
    resourceHints: [],
    riskHints: [],
    milestoneHints: [],
    ganttPreview: {
      startDate: {
        value: '2026-07-01',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      endDate: {
        value: '2026-09-30',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      totalDurationDays: {
        value: 90,
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      criticalPathTaskIds: [],
      phaseCount: 3,
    },
  }
}

export function makeMockMeta(): ProjectDraftMeta {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    structuredStrategy: 'native',
    consistency: 'strict',
    fallbackUsed: false,
    provider: 'test',
    model: 'test-model',
    usingRealAdapter: false,
    appliedFixes: [],
    moduleCounts: {
      wbsNodes: 0,
      tasks: 0,
      dependencies: 0,
      acceptanceCriteria: 0,
      resourceHints: 0,
      riskHints: 0,
      milestoneHints: 0,
    },
  }
}

export function makeMockValidation(): DraftValidationReport {
  return {
    overallRiskLevel: 'low',
    confidenceScore: 0.94,
    dimensionScores: {
      factualAccuracy: 100,
      logicalConsistency: 100,
      assumptionClarity: 100,
      completeness: 100,
      numericPlausibility: 100,
    },
    blocking: [],
    warning: [],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: true,
  }
}

export function makeSnapshotDetail(overrides: Partial<ProjectDraftDetail>): ProjectDraftDetail {
  return {
    draftId: TEST_DRAFT_ID,
    version: 1,
    status: 'drafting',
    generationState: 'running',
    projectType: 'software',
    draft: null,
    meta: null,
    validation: null,
    events: [],
    ...overrides,
  }
}

/** 最小可用上下文（客户端只透传，不校验内容）。 */
export function makeContext(): ConfirmedProjectContext {
  return {
    schemaVersion: '1.0',
    rawInput: '一句话生成一个项目',
  } as unknown as ConfirmedProjectContext
}

// ---------------------------------------------------------------------------
// 9 类强类型事件构造器
// ---------------------------------------------------------------------------

export function startedEvent(sequence = 1, draftId = TEST_DRAFT_ID): DraftStartedEvent {
  return {
    type: 'draft.started',
    draftId,
    version: 1,
    sequence,
    projectType: 'software',
    modules: [...PROJECT_DRAFT_MODULES],
  }
}

export function deltaEvent(
  module: ProjectDraftModule,
  sequence: number,
  status: ProjectDraftModuleStatus = 'generating',
  draftId = TEST_DRAFT_ID,
): DraftModuleDeltaEvent {
  return { type: 'module.delta', draftId, version: 1, sequence, module, status }
}

export function moduleCompletedEvent(
  module: ProjectDraftModule,
  sequence: number,
  draftId = TEST_DRAFT_ID,
): DraftModuleCompletedEvent {
  return { type: 'module.completed', draftId, version: 1, sequence, module }
}

export function progressEvent(
  sequence: number,
  phase: ProgressPhase = 'receiving',
  receivedChars = 64,
): DraftProgressEvent {
  return {
    type: 'draft.progress',
    draftId: TEST_DRAFT_ID,
    version: 1,
    sequence,
    phase,
    receivedChars,
  }
}

export function heartbeatEvent(
  sequence = 0,
  elapsedMs = 5_000,
  draftId = TEST_DRAFT_ID,
): DraftHeartbeatEvent {
  return { type: 'draft.heartbeat', draftId, version: 1, sequence, elapsedMs }
}

export function outputEvent(
  text: string,
  sequence = 0,
  draftId = TEST_DRAFT_ID,
): GenerationOutputEvent {
  return { type: 'generation.output', draftId, version: 1, sequence, text }
}

export function warningEvent(
  sequence: number,
  issues: DraftValidationIssue[] = [],
): Extract<ProjectDraftStreamEvent, { type: 'validation.warning' }> {
  return { type: 'validation.warning', draftId: TEST_DRAFT_ID, version: 1, sequence, issues }
}

export function failedEvent(
  sequence: number,
  errorCode: string,
  message = '生成失败',
  consistency: ProjectDraftConsistency = 'failed',
  draftId = TEST_DRAFT_ID,
): Extract<ProjectDraftStreamEvent, { type: 'draft.failed' }> {
  return { type: 'draft.failed', draftId, version: 1, sequence, errorCode, message, consistency }
}

export function completedDraftEvent(
  sequence: number,
  draft: ProjectDraft = makeMockDraft(),
  meta: ProjectDraftMeta = makeMockMeta(),
  validation: DraftValidationReport = makeMockValidation(),
  draftId = TEST_DRAFT_ID,
): DraftCompletedEvent {
  return { type: 'draft.completed', draftId, version: 1, sequence, draft, meta, validation }
}

// ---------------------------------------------------------------------------
// SSE 帧与 Mock ReadableStream（设计 Decision 10）
// ---------------------------------------------------------------------------

export function sseFrame(eventType: string, event: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`
}

/** 构造模拟 SSE 响应体：全部帧一次入队后 close。 */
export function createMockSseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
      controller.close()
    },
  })
}

/** 构造模拟 SSE 响应体：按指定字节边界分块入队（验证增量解码）。 */
export function createChunkedSseStream(
  frames: string[],
  chunkSize: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(frames.join(''))
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.subarray(offset, offset + chunkSize))
      }
      controller.close()
    },
  })
}

/** 静默流：先入队若干帧，随后永不 close 也永不出错（半开连接模拟）。 */
export function createSilentAfterSseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame))
      }
    },
  })
}

/** 入队若干帧后立即报错（网络中断模拟）。用 pull 逐帧交付，
 *  避免在 start 中 enqueue 后立即 error 导致已入队帧被 Node 流实现丢弃。 */
export function createErrorEndingStream(
  frames: string[],
  error: unknown,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index] ?? ''))
        index += 1
      } else {
        controller.error(error)
      }
    },
  })
}

export function responseOf(stream: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: stream,
  } as unknown as Response
}
