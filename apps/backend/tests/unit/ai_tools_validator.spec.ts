/**
 * v3-ai-tools-orchestration-layer —— AiToolsValidator 单元测试（tasks W1 1.4）。
 *
 * 覆盖：执行/确认信封必填项与 previewToken 格式、长度校验（VineJS）；
 * 工具参数 JSON Schema 二次校验（类型/必填/enum/pattern/边界/额外字段），
 * 未通过抛 422 VALIDATION_ERROR 且 details 带字段级原因。
 * 纯逻辑，零数据库。
 */
import { describe, expect, it } from 'vitest'
import { ValidationException } from '../../app/exceptions/api_exception.js'
import {
  aiToolsConfirmValidator,
  aiToolsExecuteValidator,
  validateParametersWithSchema,
} from '../../app/validators/ai_tools_validator.js'

interface CompiledValidatorLike {
  validate(data: unknown): Promise<unknown>
}

async function validateWith(
  validator: CompiledValidatorLike,
  data: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; errors: unknown }> {
  try {
    await validator.validate(data)
    return { ok: true }
  } catch (error) {
    return { ok: false, errors: error }
  }
}

describe('aiToolsExecuteValidator（信封）', () => {
  it('合法信封通过：toolName + parameters', async () => {
    const result = await validateWith(aiToolsExecuteValidator, {
      toolName: 'get_project_summary',
      parameters: { projectId: 1 },
    })
    expect(result).toEqual({ ok: true })
  })

  it('缺失 toolName 被拒（422）', async () => {
    const result = await validateWith(aiToolsExecuteValidator, {
      parameters: { projectId: 1 },
    })
    expect(result.ok).toBe(false)
  })

  it('缺失 parameters 被拒（422）', async () => {
    const result = await validateWith(aiToolsExecuteValidator, { toolName: 'x' })
    expect(result.ok).toBe(false)
  })

  it('参数值为 null 允许（取消指派 assigneeId: null，由工具 Schema 决定可否为空）', async () => {
    const execute = await validateWith(aiToolsExecuteValidator, {
      toolName: 'update_task_assignee',
      parameters: { projectId: 1, taskId: 2, assigneeId: null },
    })
    expect(execute).toEqual({ ok: true })
    const confirm = await validateWith(aiToolsConfirmValidator, {
      toolName: 'update_task_assignee',
      previewToken: 'a'.repeat(64),
      parameters: { projectId: 1, taskId: 2, assigneeId: null },
    })
    expect(confirm).toEqual({ ok: true })
  })

  it('空 parameters（{}）允许（工具级 Schema 校验兜底）', async () => {
    const result = await validateWith(aiToolsExecuteValidator, {
      toolName: 'x',
      parameters: {},
    })
    expect(result).toEqual({ ok: true })
  })

  it('toolName 超长（>64）与非字符串被拒', async () => {
    const long = await validateWith(aiToolsExecuteValidator, {
      toolName: 'a'.repeat(65),
      parameters: {},
    })
    expect(long.ok).toBe(false)
    const numeric = await validateWith(aiToolsExecuteValidator, {
      toolName: 123,
      parameters: {},
    })
    expect(numeric.ok).toBe(false)
  })
})

describe('aiToolsConfirmValidator（信封）', () => {
  const previewToken = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

  it('合法确认信封通过', async () => {
    const result = await validateWith(aiToolsConfirmValidator, {
      toolName: 'update_task_schedule',
      previewToken,
      parameters: { taskId: 1, startDate: '2026-08-01' },
    })
    expect(result).toEqual({ ok: true })
  })

  it('previewToken 长度不足/超长被拒', async () => {
    const short = await validateWith(aiToolsConfirmValidator, {
      toolName: 'update_task_schedule',
      previewToken: previewToken.slice(0, 63),
      parameters: {},
    })
    expect(short.ok).toBe(false)
    const long = await validateWith(aiToolsConfirmValidator, {
      toolName: 'update_task_schedule',
      previewToken: `${previewToken}00`,
      parameters: {},
    })
    expect(long.ok).toBe(false)
  })

  it('previewToken 非十六进制字符被拒（格式校验）', async () => {
    const result = await validateWith(aiToolsConfirmValidator, {
      toolName: 'update_task_schedule',
      previewToken: 'g'.repeat(64),
      parameters: {},
    })
    expect(result.ok).toBe(false)
  })

  it('缺失 previewToken 被拒', async () => {
    const result = await validateWith(aiToolsConfirmValidator, {
      toolName: 'update_task_schedule',
      parameters: {},
    })
    expect(result.ok).toBe(false)
  })
})

describe('validateParametersWithSchema（工具参数 JSON Schema 二次校验）', () => {
  const schema = {
    type: 'object',
    properties: {
      projectId: { type: 'integer', minimum: 1 },
      status: { type: 'string', enum: ['not_started', 'in_progress', 'completed'] },
      startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      keywords: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
      note: { type: 'string', minLength: 2, maxLength: 64 },
    },
    required: ['projectId', 'status', 'startDate'],
    additionalProperties: false,
  }

  it('合法入参通过', () => {
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 101,
        status: 'in_progress',
        startDate: '2026-08-01',
        keywords: ['支付', '联调'],
        note: 'ok',
      }),
    ).not.toThrow()
  })

  it('缺少必填字段抛 422 VALIDATION_ERROR，details 含字段级原因', () => {
    try {
      validateParametersWithSchema(schema, { projectId: 101 })
      expect.unreachable('应当抛出 ValidationException')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException)
      const validationError = error as ValidationException & { details?: unknown }
      expect(validationError.status).toBe(422)
      expect(validationError.code).toBe('VALIDATION_ERROR')
      const details = validationError.details as Array<{ field: string; message: string }>
      expect(Array.isArray(details)).toBe(true)
      expect(
        details.some((item) => item.field === '$.status' && item.message === '缺少必填字段'),
      ).toBe(true)
    }
  })

  it('类型错误（projectId 传字符串）被拒并指明字段', () => {
    try {
      validateParametersWithSchema(schema, {
        projectId: 'abc',
        status: 'in_progress',
        startDate: '2026-08-01',
      })
      expect.unreachable('应当抛出 ValidationException')
    } catch (error) {
      const details = (error as ValidationException & { details?: unknown }).details as Array<{
        field: string
      }>
      expect(details.some((item) => item.field === '$.projectId')).toBe(true)
    }
  })

  it('enum 越界被拒', () => {
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 1,
        status: 'archived',
        startDate: '2026-08-01',
      }),
    ).toThrow(ValidationException)
  })

  it('pattern 不匹配被拒', () => {
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 1,
        status: 'in_progress',
        startDate: '2026/08/01',
      }),
    ).toThrow(ValidationException)
  })

  it('minimum 越界被拒', () => {
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 0,
        status: 'in_progress',
        startDate: '2026-08-01',
      }),
    ).toThrow(ValidationException)
  })

  it('additionalProperties: false 拒绝未声明字段', () => {
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 1,
        status: 'in_progress',
        startDate: '2026-08-01',
        evil: 'injected',
      }),
    ).toThrow(ValidationException)
  })

  it('数组 items/minItems/maxItems 校验', () => {
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 1,
        status: 'in_progress',
        startDate: '2026-08-01',
        keywords: [],
      }),
    ).toThrow(ValidationException)
    expect(() =>
      validateParametersWithSchema(schema, {
        projectId: 1,
        status: 'in_progress',
        startDate: '2026-08-01',
        keywords: [1, 2],
      }),
    ).toThrow(ValidationException)
  })

  it('非对象入参（数组/空值）被拒', () => {
    expect(() => validateParametersWithSchema(schema, null)).toThrow(ValidationException)
    expect(() => validateParametersWithSchema(schema, [1, 2])).toThrow(ValidationException)
  })
})
