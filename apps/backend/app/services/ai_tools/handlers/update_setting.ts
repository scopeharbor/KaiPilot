// AI 同事 —— 写工具 `update_setting`：用自然语言改设置（日历第 4 批）。
//
// 两阶段确认（RL-01 / RL-06，与其它写工具同一契约）：
// - execute（无 previewToken）→ 按设置目录校验权限与新值，返回 PREVIEW_REQUIRED + 前后差异 + 令牌，零写入；
// - confirm（编排层合入 previewToken）→ 重算令牌（预览后被改过 → 409），经既有 Service 写入并记审计。
// 敏感设置（密码、两步验证、AI 密钥、KMS、SSO、集成凭据）不在目录里，模型只能用 open_destination 带用户过去。
import app from '@adonisjs/core/services/app'
import { ValidationException } from '#exceptions/api_exception'
import SettingsCatalogService from '#services/settings_catalog/settings_catalog_service'
import { asOptionalString } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const UPDATE_SETTING_TOOL_NAME = 'update_setting'

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export interface UpdateSettingParams {
  key: string
  value: unknown
  projectId?: number
  previewToken?: string
}

export function createUpdateSettingTool(deps?: {
  catalog?: SettingsCatalogService
}): ToolDefinition<UpdateSettingParams, unknown> {
  const resolve = async () => deps?.catalog ?? app.container.make(SettingsCatalogService)
  return {
    name: UPDATE_SETTING_TOOL_NAME,
    description:
      '修改一项设置（个人 / 项目 / 组织），key 来自设置目录。阶段一只返回前后差异与 previewToken，绝不落库；必须经用户确认后携带 previewToken 提交才生效。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '设置目录里的 key' },
        value: { description: '新值（格式见设置目录的 valueHint）' },
        projectId: { type: 'integer', minimum: 1, description: '项目设置所属项目' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    requiredPermissions: [],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: UpdateSettingParams,
    ): Promise<ToolExecutionResult<unknown>> => {
      const key = asOptionalString(input.key, 'key')
      if (!key) throw new ValidationException('缺少设置 key')
      const projectId =
        typeof input.projectId === 'number' &&
        Number.isInteger(input.projectId) &&
        input.projectId > 0
          ? input.projectId
          : null
      const settingCtx = {
        user: ctx.user,
        organizationId: ctx.organizationId,
        projectId,
        requestId: ctx.requestId,
      }
      const catalog = await resolve()
      if (
        typeof input.previewToken === 'string' &&
        PREVIEW_TOKEN_PATTERN.test(input.previewToken)
      ) {
        const result = await catalog.apply(settingCtx, key, input.value, input.previewToken)
        return { status: 'SUCCESS', data: result }
      }
      const preview = await catalog.preview(settingCtx, key, input.value)
      const { previewToken, ...diff } = preview
      return { status: 'PREVIEW_REQUIRED', data: diff, diff, previewToken }
    },
  }
}
