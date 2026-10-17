import vine from '@vinejs/vine'
import {
  COMMAND_CENTER_MAX_ATTENTION_LIMIT,
  COMMAND_CENTER_MAX_FRESHNESS_WINDOW_DAYS,
  COMMAND_CENTER_SOURCE_KEYS,
} from '@aiproj/types'

/**
 * 项目健康风险指挥中心验证器（§4.1）。
 *
 * 红线：project id / attentionLimit / include / freshnessWindowDays 全部
 * 白名单 + 上限约束；未知筛选与无界请求在进入 Service 前以 VALIDATION_ERROR 拒绝。
 */

/** 路由参数：项目 id 必须是正整数。 */
export const commandCenterParamsValidator = vine.compile(
  vine.object({
    id: vine.number().positive(),
  }),
)

/**
 * 查询白名单。vine 对未声明键默认剥离，这里再叠加严格边界；
 * include 同时接受逗号分隔串与数组（由 Controller 归一化后传入）。
 */
export const commandCenterQueryValidator = vine.compile(
  vine.object({
    attentionLimit: vine.number().positive().max(COMMAND_CENTER_MAX_ATTENTION_LIMIT).optional(),
    include: vine.array(vine.enum(COMMAND_CENTER_SOURCE_KEYS)).optional(),
    freshnessWindowDays: vine
      .number()
      .positive()
      .max(COMMAND_CENTER_MAX_FRESHNESS_WINDOW_DAYS)
      .optional(),
  }),
)

/**
 * 归一化 query string 的 include 参数（支持逗号分隔与数组两种形式）。
 * 空串/空数组按「未指定」处理；非法值保留原样交由共享纯函数给出 issue。
 */
export function parseCommandCenterIncludeParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw)
    ? raw.map((item) => String(item))
    : String(raw)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
  return list.length > 0 ? list : undefined
}
