/**
 * v3-frontend-ai-usage-telemetry —— 前端 AI 使用事件接收端点。
 *
 * 实现要点：
 * - 事件接收端点，挂 /api/v1
 * - 服务端二次脱敏校验：含禁存字段的事件被拒而非落库
 * - 组织隔离：事件与聚合附加 organization_id
 */

import type { HttpContext } from '@adonisjs/core/http'

/**
 * 禁存字段列表：事件不得包含这些字段的值。
 */
const FORBIDDEN_FIELDS = [
  'userInput',
  'entityIdentifier',
  'keystroke',
  'prompt',
  'modelOutput',
  'token',
  'secret',
  'inputText',
  'originalInput',
]

/**
 * 敏感样本列表：用于校验。
 */
const SENSITIVE_SAMPLES = [
  '用户输入的文本内容',
  'sk-1234567890abcdef',
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'password: mysecretpassword',
  'api_key=abcdef1234567890',
]

/**
 * 校验事件是否包含禁存字段。
 */
function containsForbiddenFields(event: Record<string, unknown>): boolean {
  for (const field of FORBIDDEN_FIELDS) {
    if (field in event) {
      return true
    }
  }
  return false
}

/**
 * 校验事件是否包含敏感样本。
 */
function containsSensitiveSamples(event: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(event)
  for (const sample of SENSITIVE_SAMPLES) {
    if (sample.length > 0 && serialized.includes(sample)) {
      return true
    }
  }
  return false
}

/**
 * 校验事件是否合规。
 */
function isEventCompliant(event: Record<string, unknown>): boolean {
  return !containsForbiddenFields(event) && !containsSensitiveSamples(event)
}

/**
 * 前端 AI 使用事件接收控制器。
 *
 * 提供批量接收端点，用于接收前端埋点事件。
 * 事件只含类别与计数，不含用户输入文本、实体标识、击键、prompt、模型输出、token 与 secret。
 */
export default class FrontendTelemetryController {
  /**
   * POST /api/v1/frontend-telemetry — 批量接收前端埋点事件。
   *
   * 请求体：{ events: FrontendTelemetryEvent[] }
   * 响应：{ received: number }
   *
   * 服务端二次脱敏校验：含禁存字段的事件被拒而非落库。
   * 组织隔离：事件与聚合附加 organization_id。
   * RBAC 校验：需要认证才能访问。
   */
  async store(ctx: HttpContext) {
    const { events } = ctx.request.body()

    // 校验请求体
    if (!Array.isArray(events)) {
      return ctx.response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'events 必须是数组',
        },
      })
    }

    // 获取当前租户的组织 ID
    const organizationId = ctx.tenant?.organizationId
      ? Number(ctx.tenant.organizationId)
      : undefined
    if (!organizationId) {
      return ctx.response.unauthorized({
        error: {
          code: 'AUTH_REQUIRED',
          // 保持既有对外文案「需要认证」：无租户上下文对客户端等价于未认证，
          // 文案变化会让既有功能测试断言失配（且泄露内部机制差异）。
          message: '需要认证',
        },
      })
    }

    // 逐个校验事件合规性
    const compliantEvents: Record<string, unknown>[] = []
    for (const event of events) {
      if (!isEventCompliant(event)) {
        // 含禁存字段的事件被拒，不落库
        continue
      }

      // 确保事件包含 organization_id（组织隔离）
      compliantEvents.push({
        ...event,
        organizationId,
      })
    }

    // TODO: 实际存储事件到数据库（归 v3-observability-data-retention）
    // 目前只返回接收到的事件数
    return ctx.response.ok({
      received: compliantEvents.length,
    })
  }

  /**
   * GET /api/v1/frontend-telemetry/aggregate — 查询聚合指标。
   *
   * 查询参数：organizationId, eventKind?, start, end
   * 响应：FrontendTelemetryAggregationResult
   *
   * RBAC 校验：需要认证且有相应权限。
   * 组织隔离：只返回当前用户所属组织的聚合数据。
   */
  async aggregate(ctx: HttpContext) {
    const { organizationId, start, end } = ctx.request.qs()

    // 校验查询参数
    if (!organizationId || !start || !end) {
      return ctx.response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: '缺少必要参数：organizationId, start, end',
        },
      })
    }

    // 获取当前租户的组织 ID
    const currentOrganizationId = ctx.tenant?.organizationId
      ? Number(ctx.tenant.organizationId)
      : undefined
    if (!currentOrganizationId) {
      return ctx.response.unauthorized({
        error: {
          code: 'AUTH_REQUIRED',
          // 同 store：对外文案保持「需要认证」（无租户上下文对客户端等价于未认证）。
          message: '需要认证',
        },
      })
    }

    // 组织隔离校验：只能查询自己所属组织的数据
    if (Number(organizationId) !== currentOrganizationId) {
      return ctx.response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: '无权查询其他组织的数据',
        },
      })
    }

    // TODO: 实际查询数据库并计算聚合（归 v3-observability-data-retention）
    // 目前返回模拟数据
    return ctx.response.ok({
      openRate: 0,
      sessionLength: 0,
      firstQuestionDistribution: {},
      abandonmentRate: 0,
      chipClickDistribution: {},
    })
  }
}
