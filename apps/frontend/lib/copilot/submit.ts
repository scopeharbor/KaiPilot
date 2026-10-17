'use client'

/**
 * v3-copilot-live-submission-channel —— 面板提交编排（任务 5.3–5.9）。
 *
 * v3-copilot-productized-operating-entry 修订（任务 4.3–4.5）：
 * 原实现的 `catch` 把**任意**错误（含权限、校验、限流、冲突）统一降级为演示成功，
 * 并追加一段 fixture 回答——用户刚被拒绝，却看到一条"成功"的答复。
 * 现在改为：生产错误按共享分类保持真实 live 状态，保留有界 retry envelope；
 * 演示态只能由「宿主显式声明 + 用户显式选择」进入。
 *
 * 红线：
 * - 生产错误**绝不**产生 demonstration success，也不追加 fixture 回复；
 * - 生产态与演示态共用同一渲染面，切换不改变 DOM 锚点；
 * - 变更类 destination 只作为待确认动作呈现，本模块不做任何域写入。
 */

import type {
  CopilotAttachmentReference,
  CopilotEntryFailureOutcome,
  CopilotMessage,
  CopilotPageContextDescriptorV1,
  CopilotScope,
  CopilotSessionAttribution,
  CopilotTurnResponse,
  MentionReference,
} from '@aiproj/types'
import {
  classifyCopilotEntryFailure,
  copilotEntryFailureOutcome,
  generateCopilotMessageId,
  pruneOrphanMentionRefs,
} from '@aiproj/types'
import { buildCopilotRetryEnvelope, useCopilotStore } from '@/stores/copilot-store'
import { copilotApi } from '@/lib/api/copilot'
import { boundedCopilotSummary } from '@/components/copilot/copilot-fixtures'
import { startCopilotDemoStream } from '@/lib/copilot/demo'
import { useCopilotOperatingEntry } from './operating-entry'
import { useAuthStore } from '@/stores/auth-store'

/** 由流式终态的分类键构造一个供 classify 消费的稳定错误对象。 */
function copilotStreamFailureToError(kind: CopilotEntryFailureOutcome['kind']): { code: string } {
  const codeByKind: Record<string, string> = {
    auth: 'AUTH_REQUIRED',
    permission: 'PERMISSION_DENIED',
    validation: 'VALIDATION_ERROR',
    'rate-limit': 'RATE_LIMIT_EXCEEDED',
    stale: 'SNAPSHOT_STALE',
    conflict: 'RESOURCE_CONFLICT',
    'retryable-service': 'AI_SERVICE_ERROR',
    unknown: 'UNKNOWN',
  }
  return { code: codeByKind[kind] ?? 'AI_SERVICE_ERROR' }
}

export interface SubmitCopilotTurnInput {
  readonly text: string
  readonly mentions: readonly MentionReference[]
  /** 附件引用（可选）。回合只携带引用，不接收 multipart（v3-copilot-attachment-and-ocr-input D1）。 */
  readonly attachments?: readonly CopilotAttachmentReference[]
  readonly slashCommand?: string
  readonly currentRoute: string
  /**
   * 版本化页面语境描述符（v3-copilot-authoritative-page-context）。
   *
   * 提交时冻结快照：页面切换后重试默认沿用本快照；「使用当前页面重试」才
   * 传入新派生的 descriptor（design Decision 5 / §F-4）。
   */
  readonly pageContext?: CopilotPageContextDescriptorV1
  /**
   * 本次回合是否允许外部网页搜索（按次同意，缺省 false；v3-copilot-optional-web-search-configuration）。
   * 组织未启用 / 场景未允许 / router 认为不需要时，服务端仍不会发起任何外部请求。
   */
  readonly webSearchConsent?: boolean
}

/** 由当前路由推导 scope 与归属（项目路由带 projectId）。 */
export function deriveScopeAndAttribution(currentRoute: string): {
  scope: CopilotScope
  attribution: CopilotSessionAttribution
} {
  const projectMatch = /^\/projects\/(\d+)/.exec(currentRoute)
  if (projectMatch) {
    return { scope: 'project', attribution: { projectId: projectMatch[1] } }
  }
  return { scope: 'global', attribution: {} }
}

/**
 * 提交一次回合。
 *
 * 成功 → 写入 live 回合结果；失败 → 按共享分类保持 live 失败态并保留有界可恢复输入。
 * **不再**在任何错误路径上进入演示。
 *
 * 存在未确认的 scope 变更提示时直接拒绝提交（spec: 变更 scope 后必须先确认或重选）。
 */
export async function submitCopilotTurn(input: SubmitCopilotTurnInput): Promise<void> {
  const store = useCopilotStore.getState()
  if (store.streaming) return
  if (store.scopeNotice !== null) return

  const text = input.text.trim()
  if (text.length === 0) return
  const auth = useAuthStore.getState()
  useCopilotOperatingEntry.setState({
    input: text,
    route: input.currentRoute,
    userId: auth.user ? String(auth.user.id) : null,
    organizationId: auth.currentOrganizationId,
  })

  // quick start 的插件绑定必须与当前资格快照 revision 一致（任务 5.6）。
  // 快照整体被替换（安装/权限/兼容性变化）即 stale —— fail closed，且**零网络**。
  if (isQuickStartSelectionStale(store.quickStartSelection, store.toolSnapshotRevision)) {
    store.setQuickStartSelection(null)
    store.setFailure(copilotEntryFailureOutcome('stale'))
    store.setStreamError(describeCopilotFailure(copilotEntryFailureOutcome('stale')))
    store.setStreaming(false, 'error')
    return
  }

  // 提交前清除孤儿引用：与服务端 `pruneOrphanRefs` 同语义（任务 5.4）
  const mentions = pruneOrphanMentionRefs(text, input.mentions)

  const { scope, attribution } = deriveScopeAndAttribution(input.currentRoute)

  // 先落用户消息（有界低敏摘要），使生产与演示两态渲染面一致
  const userMessage: CopilotMessage = {
    messageId: generateCopilotMessageId(),
    sessionId: store.liveSessionId ?? store.sessionId,
    role: 'user',
    messageSummary: boundedCopilotSummary(text),
    sourceRefs: [],
    createdAt: new Date().toISOString(),
  }

  store.setStreamError(null)
  store.setDegradeReason(null)
  store.setFailure(null)
  store.setWebSearchStatus(null)
  store.appendMessage(userMessage)
  store.clearDraft()

  // 显式演示态：走本机 fixture 流式，零网络、零业务写入。
  // 只有「宿主声明 + 用户选择」才可能处于该状态（store.enterExplicitDemonstration 保证）。
  // 必须在 setStreaming 之前分流——`startCopilotDemoStream` 见到 streaming=true 会直接返回。
  if (store.mode === 'demonstration' && store.demoSelected) {
    startCopilotDemoStream()
    return
  }

  store.clearDemonstrationArtifacts()
  store.setStreaming(true, 'understanding')

  const request: Parameters<typeof copilotApi.submitTurnStream>[0] = {
    sessionId: store.liveSessionId,
    scope,
    attribution,
    text,
    mentions,
    attachments: input.attachments,
    slashCommand: input.slashCommand,
    currentRoute: input.currentRoute,
    // 版本化页面语境（结构化可见状态；服务端重新授权解析——客户端 ID 只作候选）
    pageContext: input.pageContext,
    // 带上当前已累积的澄清轮次：后端在达到 MAX 时强制放行调真实 AI
    //（`copilot-intent-router.ts` evaluateSlotCompleteness 的上界兜底）。
    // 前端此前从不传此字段，导致简单问候被判定需要澄清后无限卡死。
    clarificationRounds: store.clarificationRounds,
    // 按次同意（v3-copilot-optional-web-search-configuration）：缺省 false = 不联网。
    webSearchConsent: input.webSearchConsent ?? false,
  }

  // 提交时冻结页面语境快照（spec REQ：回合绑定已提交的授权快照，不混入新页面状态）。
  // 会话态快照不持久化；页面切换不改变它（由「使用当前页面重试」显式换绑）。
  if (input.pageContext) {
    store.setTurnContextSnapshot({
      pageContext: input.pageContext,
      submittedAt: new Date().toISOString(),
    })
  }

  // 流式占位：创建 assistant 占位气泡，answer-delta 增量追加。
  // 终态 answer-done → 转正为正式消息；turn-error/中断 → 保留已累积文本 + 失败态。
  const streamingMessageId = generateCopilotMessageId()
  const sessionStillCurrent = () => useCopilotStore.getState().sessionId === store.sessionId
  let turnResponse: CopilotTurnResponse | null = null
  let failureOutcome: CopilotEntryFailureOutcome | null = null
  let terminalReached = false

  try {
    await copilotApi.submitTurnStream(request, {
      onOpen: () => {
        if (!sessionStillCurrent()) return
        store.setStreamingAssistant({ messageId: streamingMessageId, content: '' })
      },
      onEvent: (event) => {
        if (!sessionStillCurrent()) return
        switch (event.type) {
          case 'turn-meta': {
            // 服务端会话已确定（新建或续接）；低敏元数据 + 页面语境披露
            //（v3-copilot-authoritative-page-context：服务端权威解析结果）。
            turnResponse = {
              sessionId: event.sessionId,
              messageId: streamingMessageId,
              destinations: [],
              clarificationRequired: false,
              clarificationItems: [],
              assumptionEntries: [],
              ambiguity: null,
              warnings: [],
              degradedReason: null,
              rejectedReferenceCount: 0,
              scope: event.scope,
              intentSummary: event.intentSummary,
              stats: { ruleHitCount: 0, fallbackCount: 1 },
              mode: 'live',
              ...(event.pageContextDisclosure !== undefined
                ? { pageContextDisclosure: event.pageContextDisclosure }
                : {}),
            }
            break
          }
          case 'answer-delta': {
            store.appendStreamingDelta(event.delta)
            break
          }
          case 'answer-done': {
            // 转正：占位气泡替换为正式 assistant 消息（服务端已 sanitize/摘要）。
            const content = useCopilotStore.getState().streamingAssistant?.content ?? ''
            const finalContent = content || event.contentSummary
            store.setStreamingAssistant(null)
            // 网页搜索门状态（v3-copilot-optional-web-search-configuration）
            store.setWebSearchStatus(event.webSearchStatus ?? null)
            store.appendMessage({
              messageId: event.assistantMessageId,
              sessionId: turnResponse?.sessionId ?? store.liveSessionId ?? '',
              role: 'assistant',
              messageSummary: boundedCopilotSummary(finalContent, 4_000),
              sourceRefs: [],
              createdAt: new Date().toISOString(),
            })
            turnResponse = {
              ...(turnResponse ?? {
                sessionId: store.liveSessionId ?? '',
                messageId: streamingMessageId,
                destinations: [],
                clarificationRequired: false,
                clarificationItems: [],
                assumptionEntries: [],
                ambiguity: null,
                warnings: [],
                degradedReason: null,
                rejectedReferenceCount: 0,
                scope,
                intentSummary: '',
                stats: { ruleHitCount: 0, fallbackCount: 1 },
                mode: 'live',
              }),
              result: {
                kind: 'answer',
                assistantMessageId: event.assistantMessageId,
                content: finalContent,
              },
            }
            terminalReached = true
            break
          }
          case 'turn-clarify': {
            store.setStreamingAssistant(null)
            turnResponse = {
              ...(turnResponse ?? {
                sessionId: store.liveSessionId ?? '',
                messageId: streamingMessageId,
                destinations: [],
                ambiguity: null,
                warnings: [],
                degradedReason: null,
                rejectedReferenceCount: 0,
                scope,
                intentSummary: '',
                stats: { ruleHitCount: 0, fallbackCount: 1 },
                mode: 'live',
              }),
              clarificationRequired: true,
              clarificationItems: event.items,
              assumptionEntries: [],
            }
            terminalReached = true
            break
          }
          case 'turn-route': {
            store.setStreamingAssistant(null)
            turnResponse = {
              ...(turnResponse ?? {
                sessionId: store.liveSessionId ?? '',
                messageId: streamingMessageId,
                clarificationRequired: false,
                clarificationItems: [],
                assumptionEntries: [],
                ambiguity: null,
                warnings: [],
                degradedReason: null,
                rejectedReferenceCount: 0,
                scope,
                intentSummary: '',
                stats: { ruleHitCount: 0, fallbackCount: 1 },
                mode: 'live',
              }),
              destinations: event.destinations,
            }
            terminalReached = true
            break
          }
          case 'turn-error': {
            // 失败：保留已累积增量（转正为可见消息），并标记稳定失败分类。
            const partial = useCopilotStore.getState().streamingAssistant?.content
            if (partial && partial.trim().length > 0) {
              store.setStreamingAssistant(null)
              store.appendMessage({
                messageId: streamingMessageId,
                sessionId: turnResponse?.sessionId ?? store.liveSessionId ?? '',
                role: 'assistant',
                messageSummary: boundedCopilotSummary(partial, 4_000),
                sourceRefs: [],
                createdAt: new Date().toISOString(),
              })
            } else {
              store.setStreamingAssistant(null)
            }
            failureOutcome = classifyCopilotEntryFailure(
              copilotStreamFailureToError(event.errorKind as CopilotEntryFailureOutcome['kind']),
            )
            terminalReached = true
            break
          }
        }
      },
      onEnd: () => {
        // 传输中断且未达终态：视为 retryable-service 失败（保留已累积文本已在上方处理）。
        if (!terminalReached && !failureOutcome) {
          failureOutcome = copilotEntryFailureOutcome('retryable-service')
        }
      },
    })

    if (!sessionStillCurrent()) return
    if (failureOutcome !== null) {
      throw copilotStreamFailureToError((failureOutcome as CopilotEntryFailureOutcome).kind)
    }

    if (!turnResponse) {
      throw new Error('COPILOT_EMPTY_RESULT')
    }

    store.setTurn(turnResponse)
    store.setRetryEnvelope(null)
    store.setStreaming(false, 'done')
  } catch (error) {
    if (!sessionStillCurrent()) return
    // 生产失败：保持 live 状态，给出稳定分类与可恢复输入，**不追加任何 fixture 回复**。
    const outcome = failureOutcome ?? classifyCopilotEntryFailure(error)
    store.setTurn(null)
    store.setFailure(outcome)
    store.setStreamError(describeCopilotFailure(outcome))
    store.setStreamingAssistant(null)
    store.setRetryEnvelope(
      outcome.preserveDraft
        ? buildCopilotRetryEnvelope({
            text,
            currentRoute: input.currentRoute,
            ...(input.slashCommand !== undefined ? { slashCommand: input.slashCommand } : {}),
            ...(input.pageContext !== undefined ? { pageContext: input.pageContext } : {}),
          })
        : null,
    )
    store.setStreaming(false, 'error')
  }
}

/**
 * 判断 quick start 选择是否已随资格快照失效。
 *
 * 只对插件来源的选择生效；`core` 来源不绑定插件 revision，不受影响。
 * 当前 revision 未知（readiness 还没回来）时**不放行**——宁可让用户重试，
 * 也不拿一个无法复核的插件选择去提交。
 */
export function isQuickStartSelectionStale(
  selection: { pluginBinding?: { snapshotRevision: string } } | null,
  currentRevision: string | null,
): boolean {
  const binding = selection?.pluginBinding
  if (!binding) return false
  if (currentRevision === null) return true
  return binding.snapshotRevision !== currentRevision
}

/** 重放最近一次失败的提交（只在分类允许重试时有意义）。默认沿用提交时的页面快照。 */
export async function retryCopilotTurn(): Promise<void> {
  const store = useCopilotStore.getState()
  const envelope = store.retryEnvelope
  if (!envelope) return
  if (store.failure && !store.failure.retryable) return

  await submitCopilotTurn({
    text: envelope.text,
    mentions: [],
    currentRoute: envelope.currentRoute,
    ...(envelope.slashCommand !== undefined ? { slashCommand: envelope.slashCommand } : {}),
    ...(envelope.pageContext !== undefined ? { pageContext: envelope.pageContext } : {}),
  })
}

/**
 * 「使用当前页面重试」：用**当前页面**新派生的 descriptor 重试（design §F-4）。
 * 与默认重试（沿用原快照）不同，本入口显式换绑到新 revision。
 */
export async function retryCopilotTurnWithCurrentPage(
  pageContext: CopilotPageContextDescriptorV1,
): Promise<void> {
  const store = useCopilotStore.getState()
  const envelope = store.retryEnvelope
  if (!envelope) return
  if (store.failure && !store.failure.retryable) return

  await submitCopilotTurn({
    text: envelope.text,
    mentions: [],
    currentRoute: envelope.currentRoute,
    ...(envelope.slashCommand !== undefined ? { slashCommand: envelope.slashCommand } : {}),
    pageContext,
  })
}

/**
 * 稳定文案键 → 简体中文说明。
 *
 * 只描述**类别**与下一步，不透传后端 message、状态码或不可访问对象的信息。
 */
export function describeCopilotFailure(outcome: CopilotEntryFailureOutcome): string {
  switch (outcome.kind) {
    case 'auth':
      return '登录状态已失效，请重新登录后继续'
    case 'permission':
      return '当前账号没有执行该操作的权限'
    case 'validation':
      return '输入不符合回合约束，请调整后重试'
    case 'rate-limit':
      return '请求过于频繁，请稍后再试'
    case 'stale':
      return '可用能力已变化，请刷新后重新选择'
    case 'conflict':
      return '目标状态已变化，请刷新后重试'
    case 'retryable-service':
      return 'Copilot 服务暂时不可用，可稍后重试'
    default:
      return '回合通道暂时不可达，可稍后重试'
  }
}
