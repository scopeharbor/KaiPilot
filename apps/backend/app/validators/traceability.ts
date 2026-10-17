/**
 * v2-traceability-source-attribution —— Traceability Validators（task 6.2）。
 *
 * 所有请求经 JWT、RBAC、组织隔离，禁止客户端指定 organizationId。
 *
 * @aiproj/backend
 */

import vine from '@vinejs/vine'

/** Query compiler run attributions — 禁止客户端传 organizationId。 */
export const queryCompilerRunAttributionsValidator = vine.compile(
  vine.object({
    page: vine.number().optional(),
    perPage: vine.number().optional(),
  }),
)

/** Query single attribution — 无请求体，仅 path param。 */

/** Query entity source attribution — 无请求体，仅路径参数。 */

/** Query project traceability links — 仅查询参数。 */
export const queryProjectTraceabilityLinksValidator = vine.compile(
  vine.object({
    page: vine.number().optional(),
    perPage: vine.number().optional(),
    relationType: vine.string().optional(),
  }),
)
