import vine from '@vinejs/vine'

/**
 * v3-copilot-productized-operating-entry —— readiness query 校验（任务 3.1）。
 *
 * `GET /api/v1/copilot/readiness` 只接受一个可选 `projectId`。
 * 它**只是 scope 输入**，可见性由 Policy 复核：校验通过不代表该项目存在或可访问。
 *
 * 未知 query 字段不进入校验结果（vine 只取声明字段），避免通过 query 注入额外行为。
 */
export const copilotReadinessQueryValidator = vine.compile(
  vine.object({
    projectId: vine.number().withoutDecimals().positive().optional(),
  }),
)
