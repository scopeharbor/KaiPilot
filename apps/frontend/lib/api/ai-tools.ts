/**
 * AI 工具编排层前端 API 客户端（v3-ui-next-ai-colleague W1 · tasks 1.1）。
 *
 * 对接后端 B3a 端点组（`apps/backend/start/routes.ts` 路由组 `/api/v1/ai/tools`）：
 * - `GET  /ai/tools`       → 工具注册表元数据投影（`{ data, meta: { total } }`）；
 * - `POST /ai/tools/execute` → 统一执行入口，返回 `{ data, meta: { toolName, status,
 *   durationMs, previewToken?, diff? } }`，写工具阶段一恒为 `PREVIEW_REQUIRED`；
 * - `POST /ai/tools/confirm` → 写工具两阶段人工确认（RL-01），携带 previewToken 提交。
 *
 * 错误映射（RL-01/RL-05 前端防线）：
 * - HTTP 409 且错误码为 `SCHEDULE_STALE` / `TOKEN_EXPIRED` → 映射为
 *   `AiToolScheduleConflictError`，调用方（store）据此呈现版本冲突告警，严禁静默重试或假成功；
 * - 403 / 404 / 其余错误原样透传 `ApiError`（403 权限拒绝、404 由卡片层以中性文案回显）。
 *
 * 本模块零 DOM / 零 React 依赖，纯网络封装，供 store 与后续组件层消费。
 */
import { apiFetchEnvelope, type ApiError } from '@/lib/api-client'
import type {
  AiToolCallingMode,
  ColleagueAppDestination,
  ColleagueUiPreferenceOptions,
} from '@aiproj/types'

/** 工具副作用类别（对齐后端 `ToolSideEffect`）。 */
export type AiToolSideEffect = 'read' | 'navigate' | 'write'

/** GET /ai/tools 单条工具元数据（后端 `getAllMetadata()` 的契约投影）。 */
export interface AiToolMetadata {
  name: string
  description: string
  parameters: Record<string, unknown>
  parametersJsonSchema: Record<string, unknown>
  requiredPermissions: readonly string[]
  sideEffect: AiToolSideEffect
}

/** GET /ai/tools 信封响应。 */
export interface AiToolRegistryResponse {
  data: AiToolMetadata[]
  meta: { total: number }
}

/** 执行信封状态：只读/导航工具直执行成功，写工具阶段一拦截预览。 */
export type AiToolExecutionStatus = 'SUCCESS' | 'PREVIEW_REQUIRED'

/** POST /ai/tools/execute 的 meta 契约。 */
export interface AiToolExecuteMeta {
  toolName: string
  status: AiToolExecutionStatus
  durationMs?: number
  /** 写操作阶段一预览令牌（仅 PREVIEW_REQUIRED 时由后端下发）。 */
  previewToken?: string
  /** 写操作变更 Diff（仅 PREVIEW_REQUIRED 时由后端下发）。 */
  diff?: unknown
}

/** POST /ai/tools/execute 完整信封（保留 `{ data, meta }`）。 */
export interface AiToolExecuteEnvelope {
  data: unknown
  meta: AiToolExecuteMeta
}

/** POST /ai/tools/confirm 的 meta 契约（提交成功 `committed: true`）。 */
export interface AiToolConfirmMeta {
  toolName: string
  committed: boolean
  durationMs?: number
}

/** POST /ai/tools/confirm 完整信封。 */
export interface AiToolConfirmEnvelope {
  data: unknown
  meta: AiToolConfirmMeta
}

export interface AiToolExecuteRequest {
  toolName: string
  parameters: Record<string, unknown>
}

export interface AiToolConfirmRequest {
  toolName: string
  previewToken: string
  parameters: Record<string, unknown>
}

/** 409 调度版本冲突错误码（后端 `ConflictException('SCHEDULE_STALE')` → HTTP 409）。 */
export const SCHEDULE_STALE_ERROR_CODE = 'SCHEDULE_STALE'
export const TOKEN_EXPIRED_ERROR_CODE = 'TOKEN_EXPIRED'

/** 请求超时错误码（前端 15s 门限，映射为 AiErrorCard kind=timeout 呈现）。 */
export const REQUEST_TIMEOUT_ERROR_CODE = 'REQUEST_TIMEOUT'

/** execute/confirm 单请求超时门限（毫秒）。 */
export const AI_TOOLS_REQUEST_TIMEOUT_MS = 15_000

const CONFLICT_CODES = new Set([SCHEDULE_STALE_ERROR_CODE, TOKEN_EXPIRED_ERROR_CODE])

/**
 * 写操作版本冲突专用错误（409）。携带后端原始错误码，供卡片层区分
 * `SCHEDULE_STALE` 与 `TOKEN_EXPIRED` 两种过期语义。
 */
export class AiToolScheduleConflictError extends Error {
  readonly status = 409
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AiToolScheduleConflictError'
    this.code = code
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).code === 'string' &&
    typeof (value as ApiError).message === 'string'
  )
}

/** 409 冲突判定：优先识别专用错误类，其次识别仍以原始 ApiError 形态抛出的冲突。 */
export function isScheduleStaleError(error: unknown): boolean {
  if (error instanceof AiToolScheduleConflictError) return true
  if (isApiError(error)) {
    return error.status === 409 && CONFLICT_CODES.has(error.code)
  }
  return false
}

/** 把后端原始错误按契约映射后重新抛出；非冲突错误原样透传。 */
async function rethrowMapped(error: unknown): Promise<never> {
  if (isApiError(error) && error.status === 409 && CONFLICT_CODES.has(error.code)) {
    throw new AiToolScheduleConflictError(error.code, error.message)
  }
  throw error
}

/** 执行信封分类器：成功态（只读/导航直执行结果）。 */
export function isToolSuccess(envelope: AiToolExecuteEnvelope): boolean {
  return envelope.meta.status === 'SUCCESS'
}

/** 执行信封分类器：写操作阶段一预览态（等待人工确认）。 */
export function isToolPreviewRequired(envelope: AiToolExecuteEnvelope): boolean {
  return envelope.meta.status === 'PREVIEW_REQUIRED'
}

/**
 * 15s 超时守卫：AbortController 终止在途 fetch，超时映射为 timeout 错误
 * （`code=REQUEST_TIMEOUT` / `status=408`，AiErrorCard 自动呈现「网络连接超时」）。
 * 请求正常完成或提前失败时清除计时器，绝不留悬空定时器。
 */
async function withRequestTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(), AI_TOOLS_REQUEST_TIMEOUT_MS)
  try {
    return await run(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error('请求超时，请检查网络后重试'), {
        code: REQUEST_TIMEOUT_ERROR_CODE,
        kind: 'timeout',
        status: 408,
      })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timer)
  }
}

/** AI 同事操作计划里的一步（服务端已校验任务归属、日期与枚举）。 */
export interface ColleaguePlannedAction {
  toolName:
    | 'update_task_status'
    | 'update_task_schedule'
    | 'navigate_to_space'
    | 'list_project_tasks'
    | 'get_task_detail'
    | 'open_app_page'
    | 'search_global_entities'
    | 'set_ui_preference'
    | 'get_my_work'
    | 'update_task_assignee'
    | 'delete_task'
    | 'create_task'
    | 'toggle_task_steps'
    | 'start_project_generation'
    | 'sign_out'
    | 'get_project_summary'
    | 'list_project_risks'
    | 'capture_page'
    | 'update_setting'
    | 'wiki_index'
    | 'wiki_read'
    | 'wiki_search'
  parameters: Record<string, unknown>
  summary: string
  /** prioritize = 执行后把结果交给模型排优先级、给建议。 */
  followUp?: 'prioritize'
}

/** `POST /ai/tools/plan` 结果：一句话 → 操作建议序列（零写入）。 */
export interface ColleagueActionPlan {
  isAction: boolean
  actions: ColleaguePlannedAction[]
  /** 多步任务：本轮动作执行完后把结果交回模型、再想下一步。 */
  continue?: boolean
  /** 多步任务的最终答复（Markdown）。 */
  answer?: string | null
  reply: string | null
  clarification: string | null
  /** 追问候选答案（界面渲染成选项卡片，另加「自己输入」）。 */
  clarificationOptions?: string[]
  rejected: string[]
  model: string | null
  /** 本次实际使用的工具调用方式。 */
  toolCallingMode?: AiToolCallingMode
  /** 连接配置的方式（与实际不同说明回退了）。 */
  requestedToolCallingMode?: AiToolCallingMode
  /** 原生方式失败、回退到提示词 + JSON 的原因。 */
  fallbackReason?: string | null
}

export interface ColleagueActionPlanRequest {
  /** 当前项目；不在项目空间时为 null（只能打开页面 / 搜索 / 切换界面偏好）。 */
  projectId: number | null
  text: string
  /** 应用地图（从界面目录实时生成、按权限过滤）。 */
  appDestinations?: ColleagueAppDestination[]
  uiPreferences?: ColleagueUiPreferenceOptions
  selectedTaskId?: number
  /** 上一张任务清单的显示顺序（「第 N 个」）。 */
  recentTaskIds?: number[]
  modelPreference?: { connectionId?: number; modelId?: number }
  /** 最近几轮对话（理解「直接带我过去」这类指代）。 */
  conversation?: { role: 'user' | 'assistant'; text: string }[]
  /** 多步任务：前几轮动作的执行结果与当前轮次。 */
  observations?: ColleagueObservation[]
  iteration?: number
  /** 当前页面：可见文字与截图描述。 */
  page?: ColleaguePageSnapshot
}

/** 一步动作的执行结果（交回模型的「观察」）。 */
export interface ColleagueObservation {
  step: string
  tool: string
  status: string
  result: string
}

export interface ColleaguePageSnapshot {
  route?: string
  title?: string
  visibleText?: string
  visualDescription?: string
}

/** 页面截图的看图描述。 */
export interface ColleaguePageVision {
  description: string
  model: string
}

/** 看图模型描述一张页面截图可能要几十秒。 */
const AI_TOOLS_VISION_TIMEOUT_MS = 150_000

/** 模型理解一句话可能要几十秒（推理模型更久），单独放宽超时。 */
const AI_TOOLS_PLAN_TIMEOUT_MS = 150_000

export const aiToolsApi = {
  /** 成员代号编码 → 姓名（只给界面；只解析同在有权限项目里的成员）。 */
  memberNames: async (codes: string[]): Promise<Record<string, string>> => {
    const envelope = await apiFetchEnvelope<{ data: Record<string, string> }>(
      '/ai/tools/member-names',
      { method: 'POST', body: JSON.stringify({ codes }) },
    )
    return envelope.data ?? {}
  },

  /** 页面截图 → 看图模型的文字描述（零写入）。 */
  pageVision: async (input: {
    imageDataUrl: string
    question?: string
    connectionId?: number
    modelId?: number
  }): Promise<ColleaguePageVision> => {
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), AI_TOOLS_VISION_TIMEOUT_MS)
    try {
      const envelope = await apiFetchEnvelope<{ data: ColleaguePageVision }>(
        '/ai/tools/page-vision',
        { method: 'POST', body: JSON.stringify(input), signal: controller.signal },
      )
      return envelope.data
    } catch (error) {
      return await rethrowMapped(error)
    } finally {
      globalThis.clearTimeout(timer)
    }
  },

  /** 输入框预填建议（按 Tab 采用；零写入）。 */
  suggestReplies: async (input: {
    conversation: { role: 'user' | 'assistant'; text: string }[]
    question?: string
    options?: string[]
    draft?: string
    connectionId?: number
    modelId?: number
  }): Promise<string[]> => {
    const envelope = await apiFetchEnvelope<{ data: { suggestions?: string[] } }>(
      '/ai/tools/suggest-replies',
      { method: 'POST', body: JSON.stringify(input) },
    )
    return Array.isArray(envelope.data?.suggestions) ? envelope.data.suggestions : []
  },

  /**
   * 全自动代答生成剧场的一个追问：模型审阅题目与全部选项（推荐 / 默认只作参考）后作答。
   * 没有可用的真实模型时返回 null（调用方按规则兜底）。零写入。
   */
  chooseTheaterAnswer: async (input: {
    projectInput: string
    previousAnswers?: { question: string; answer: string }[]
    question: {
      title: string
      description?: string | null
      reasoning?: string | null
      questionType: 'single_choice' | 'multi_choice' | 'number' | 'date' | 'text'
      options: {
        label: string
        value: string | number
        description?: string | null
        recommended?: boolean
      }[]
      customInput?: boolean
      defaultValue?: string | number | string[] | null
      suggestedValue?: string | number | string[] | null
      allowSkip?: boolean
      isRequired?: boolean
    }
    connectionId?: number
    modelId?: number
  }): Promise<{
    action: 'answer' | 'default' | 'skip'
    value: string | number | string[] | null
    reason: string
    model: string
  } | null> => {
    const envelope = await apiFetchEnvelope<{
      data: {
        action: 'answer' | 'default' | 'skip'
        value: string | number | string[] | null
        reason: string
        model: string
      } | null
    }>('/ai/tools/theater-answer', { method: 'POST', body: JSON.stringify(input) })
    return envelope.data ?? null
  },

  /** 自然语言 → 操作建议序列（模型理解 + 服务端校验；本身不执行任何操作）。 */
  plan: async (input: ColleagueActionPlanRequest): Promise<ColleagueActionPlan> => {
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), AI_TOOLS_PLAN_TIMEOUT_MS)
    try {
      const envelope = await apiFetchEnvelope<{ data: ColleagueActionPlan }>('/ai/tools/plan', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: controller.signal,
      })
      return envelope.data
    } catch (error) {
      return await rethrowMapped(error)
    } finally {
      globalThis.clearTimeout(timer)
    }
  },

  /** 查询工具注册表元数据（可用工具白名单）。 */
  list: () => apiFetchEnvelope<AiToolRegistryResponse>('/ai/tools'),

  /**
   * 统一执行入口。写工具返回 `PREVIEW_REQUIRED` 信封（不落库，RL-01 阶段一），
   * 由调用方截获 previewToken/diff 进入人工确认流程；15s 未响应映射为 timeout 错误。
   */
  execute: async (
    toolName: string,
    parameters: Record<string, unknown>,
  ): Promise<AiToolExecuteEnvelope> => {
    try {
      return await withRequestTimeout((signal) =>
        apiFetchEnvelope<AiToolExecuteEnvelope>('/ai/tools/execute', {
          method: 'POST',
          body: JSON.stringify({ toolName, parameters } satisfies AiToolExecuteRequest),
          signal,
        }),
      )
    } catch (error) {
      return await rethrowMapped(error)
    }
  },

  /** 写操作两阶段确认提交（仅携带 previewToken 才算落库授权）；15s 未响应映射为 timeout。 */
  confirm: async (input: AiToolConfirmRequest): Promise<AiToolConfirmEnvelope> => {
    try {
      return await withRequestTimeout((signal) =>
        apiFetchEnvelope<AiToolConfirmEnvelope>('/ai/tools/confirm', {
          method: 'POST',
          body: JSON.stringify(input),
          signal,
        }),
      )
    } catch (error) {
      return await rethrowMapped(error)
    }
  },
}
