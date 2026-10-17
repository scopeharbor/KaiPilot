// apps/backend — v3-ai-tools-orchestration-layer —— 请求信封与工具参数校验器（W1）。
//
// 两层校验：
// 1. 信封校验（VineJS）：`POST /ai/tools/execute` 的 `{ toolName, parameters }` 与
//    `POST /ai/tools/confirm` 的 `{ toolName, previewToken, parameters }`；
//    违规由全局 ExceptionHandler 映射为 422 `VALIDATION_ERROR`（details 为 Vine 结构）；
// 2. 工具参数 Schema 校验（`validateParametersWithSchema`）：按工具注册时声明的
//    `parametersJsonSchema`（JSON Schema 子集）做确定性二次校验，未通过抛 422。

import { ValidationException } from '#exceptions/api_exception'
import vine from '@vinejs/vine'

export const aiToolsExecuteValidator = vine.compile(
  vine.object({
    toolName: vine.string().trim().minLength(1).maxLength(64),
    // 参数值允许 null（如取消指派 assigneeId: null）：Vine 默认把 null 当缺失字段，
    // 会在进入工具 JSON Schema 校验前就 422；具体可否为 null 由各工具的 Schema 决定。
    parameters: vine.record(vine.any().nullable()),
  }),
)

export const aiToolsConfirmValidator = vine.compile(
  vine.object({
    toolName: vine.string().trim().minLength(1).maxLength(64),
    previewToken: vine
      .string()
      .trim()
      .fixedLength(64)
      .regex(/^[0-9a-f]+$/),
    parameters: vine.record(vine.any().nullable()),
  }),
)

export interface SchemaViolation {
  field: string
  message: string
}

/**
 * 按工具 `parametersJsonSchema` 校验入参（JSON Schema 子集，确定性实现，无第三方依赖）。
 *
 * 支持的关键字（W2 编写 parametersJsonSchema 时使用）：
 * - `type`: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'
 * - object: `properties`、`required`、`additionalProperties`（默认 true）
 * - array: `items`、`minItems`、`maxItems`
 * - string: `minLength`、`maxLength`、`pattern`、`enum`
 * - number/integer: `minimum`、`maximum`、`enum`
 *
 * 未通过抛 `ValidationException`（422 VALIDATION_ERROR），`details` 为
 * `[{ field, message }]` 结构（spec：details 数组中明确返回校验失败的具体字段与原因）。
 */
export function validateParametersWithSchema(schema: Record<string, unknown>, data: unknown): void {
  const violations: SchemaViolation[] = []
  validateNode(schema, data, '$', violations)
  if (violations.length > 0) {
    throw new ValidationException('工具参数不符合 JSON Schema 定义', {
      details: violations,
    })
  }
}

function validateNode(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  violations: SchemaViolation[],
): void {
  const type = typeof schema.type === 'string' ? schema.type : undefined
  if (type && !matchesType(type, value)) {
    violations.push({ field: path, message: `期望类型 ${type}，实际为 ${describeType(value)}` })
    return
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((candidate) => deepEqual(candidate, value))) {
      violations.push({
        field: path,
        message: `取值必须为枚举之一：${JSON.stringify(schema.enum)}`,
      })
      return
    }
  }

  if (type === 'object' || (!type && isPlainObject(value))) {
    if (typeof schema.properties === 'object' && schema.properties !== null) {
      for (const [key, subSchema] of Object.entries(
        schema.properties as Record<string, Record<string, unknown>>,
      )) {
        if (key in (value as Record<string, unknown>)) {
          validateNode(
            subSchema,
            (value as Record<string, unknown>)[key],
            `${path}.${key}`,
            violations,
          )
        }
      }
    }
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (typeof key !== 'string') continue
        if ((value as Record<string, unknown>)[key] === undefined) {
          violations.push({ field: `${path}.${key}`, message: '缺少必填字段' })
        }
      }
    }
    if (schema.additionalProperties === false && isPlainObject(value)) {
      const allowed = new Set(
        typeof schema.properties === 'object' && schema.properties !== null
          ? Object.keys(schema.properties as Record<string, unknown>)
          : [],
      )
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!allowed.has(key)) {
          violations.push({ field: `${path}.${key}`, message: '不允许的额外字段' })
        }
      }
    }
  }

  if (type === 'array' || (!type && Array.isArray(value))) {
    const items = Array.isArray(value) ? value : []
    if (typeof schema.minItems === 'number' && items.length < schema.minItems) {
      violations.push({ field: path, message: `数组长度不能小于 ${schema.minItems}` })
    }
    if (typeof schema.maxItems === 'number' && items.length > schema.maxItems) {
      violations.push({ field: path, message: `数组长度不能大于 ${schema.maxItems}` })
    }
    if (typeof schema.items === 'object' && schema.items !== null && Array.isArray(value)) {
      value.forEach((item, index) => {
        validateNode(schema.items as Record<string, unknown>, item, `${path}[${index}]`, violations)
      })
    }
  }

  if (type === 'string' || typeof value === 'string') {
    const text = typeof value === 'string' ? value : ''
    if (typeof schema.minLength === 'number' && text.length < schema.minLength) {
      violations.push({ field: path, message: `字符串长度不能小于 ${schema.minLength}` })
    }
    if (typeof schema.maxLength === 'number' && text.length > schema.maxLength) {
      violations.push({ field: path, message: `字符串长度不能大于 ${schema.maxLength}` })
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(text)) {
          violations.push({ field: path, message: `不匹配模式 ${schema.pattern}` })
        }
      } catch {
        violations.push({ field: path, message: 'schema 的 pattern 非法' })
      }
    }
  }

  if (type === 'number' || type === 'integer' || typeof value === 'number') {
    const numberValue = typeof value === 'number' ? value : Number.NaN
    if (typeof schema.minimum === 'number' && numberValue < schema.minimum) {
      violations.push({ field: path, message: `不能小于 ${schema.minimum}` })
    }
    if (typeof schema.maximum === 'number' && numberValue > schema.maximum) {
      violations.push({ field: path, message: `不能大于 ${schema.maximum}` })
    }
  }
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    case 'null':
      return value === null
    default:
      return true
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => deepEqual(a[key], b[key]))
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  return false
}

/** AI 同事自然语言操作计划：`POST /ai/tools/plan` 请求体。 */
export const aiColleaguePlanValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive().withoutDecimals().nullable().optional(),
    text: vine.string().trim().minLength(1).maxLength(2000),
    // 应用地图 / 界面偏好：形状由 sanitizeColleagueAppMap / sanitizeColleagueUiPreferences 清洗
    appDestinations: vine.array(vine.any()).maxLength(300).optional(),
    uiPreferences: vine.any().optional(),
    selectedTaskId: vine.number().positive().withoutDecimals().optional(),
    recentTaskIds: vine.array(vine.number().positive().withoutDecimals()).maxLength(50).optional(),
    // 最近几轮对话（理解「直接带我过去」这类指代）；服务端再截断条数与长度
    conversation: vine
      .array(
        vine.object({
          role: vine.enum(['user', 'assistant'] as const),
          text: vine.string().trim().maxLength(4000),
        }),
      )
      .maxLength(20)
      .optional(),
    // 多步任务：前几轮动作的执行结果（服务端再截断）与当前轮次
    observations: vine
      .array(
        vine.object({
          step: vine.string().maxLength(500),
          tool: vine.string().maxLength(80),
          status: vine.string().maxLength(40),
          result: vine.string().maxLength(20000),
        }),
      )
      .maxLength(200)
      .optional(),
    iteration: vine.number().positive().withoutDecimals().max(60).optional(),
    // 当前页面：可见文字摘要与截图描述（服务端再截断）
    page: vine
      .object({
        route: vine.string().maxLength(500).optional(),
        title: vine.string().maxLength(300).optional(),
        visibleText: vine.string().maxLength(20000).optional(),
        visualDescription: vine.string().maxLength(20000).optional(),
      })
      .optional(),
    modelPreference: vine
      .object({
        connectionId: vine.number().positive().withoutDecimals().optional(),
        modelId: vine.number().positive().withoutDecimals().optional(),
      })
      .optional(),
  }),
)

/** AI 同事成员代号解析：`POST /ai/tools/member-names`。 */
export const aiColleagueMemberNamesValidator = vine.compile(
  vine.object({
    // 代号编码（〔成员·XXXXXXXX〕里的 8 位 Crockford Base32）
    codes: vine
      .array(
        vine
          .string()
          .trim()
          .regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
      )
      .minLength(1)
      .maxLength(100),
  }),
)

/** AI 同事看页面：`POST /ai/tools/page-vision`（截图 → 能看图的模型描述成文字）。 */
export const aiColleaguePageVisionValidator = vine.compile(
  vine.object({
    // data:image/png|jpeg|webp;base64,…（约 8MB 以内）
    imageDataUrl: vine
      .string()
      .maxLength(11_000_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
    question: vine.string().trim().maxLength(1000).optional(),
    connectionId: vine.number().positive().withoutDecimals().optional(),
    modelId: vine.number().positive().withoutDecimals().optional(),
  }),
)

/** AI 同事输入建议：`POST /ai/tools/suggest-replies`（按 Tab 采用的预填答案）。 */
export const aiColleagueSuggestValidator = vine.compile(
  vine.object({
    conversation: vine
      .array(
        vine.object({
          role: vine.enum(['user', 'assistant'] as const),
          text: vine.string().trim().maxLength(4000),
        }),
      )
      .minLength(1)
      .maxLength(20),
    /** 正在回答的问题（追问卡 / 生成剧场的问题）与候选。 */
    question: vine.string().trim().maxLength(1000).optional(),
    options: vine.array(vine.string().trim().maxLength(200)).maxLength(10).optional(),
    /** 用户已经输入的开头（补全）。 */
    draft: vine.string().maxLength(500).optional(),
    connectionId: vine.number().positive().withoutDecimals().optional(),
    modelId: vine.number().positive().withoutDecimals().optional(),
  }),
)

/** 全自动代答剧场追问：`POST /ai/tools/theater-answer`（模型审阅题目与全部选项后作答，零写入）。 */
export const aiColleagueTheaterAnswerValidator = vine.compile(
  vine.object({
    projectInput: vine.string().trim().minLength(1).maxLength(4000),
    previousAnswers: vine
      .array(
        vine.object({
          question: vine.string().trim().maxLength(500),
          answer: vine.string().trim().maxLength(1000),
        }),
      )
      .maxLength(60)
      .optional(),
    question: vine.object({
      title: vine.string().trim().minLength(1).maxLength(500),
      description: vine.string().trim().maxLength(2000).nullable().optional(),
      reasoning: vine.string().trim().maxLength(2000).nullable().optional(),
      questionType: vine.enum(['single_choice', 'multi_choice', 'number', 'date', 'text'] as const),
      options: vine
        .array(
          vine.object({
            label: vine.string().trim().maxLength(200),
            value: vine.any(),
            description: vine.string().trim().maxLength(500).nullable().optional(),
            recommended: vine.boolean().optional(),
          }),
        )
        .maxLength(30),
      customInput: vine.boolean().optional(),
      defaultValue: vine.any().optional(),
      suggestedValue: vine.any().optional(),
      allowSkip: vine.boolean().optional(),
      isRequired: vine.boolean().optional(),
    }),
    connectionId: vine.number().positive().withoutDecimals().optional(),
    modelId: vine.number().positive().withoutDecimals().optional(),
  }),
)
