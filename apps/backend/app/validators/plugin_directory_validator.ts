import vine from '@vinejs/vine'
import { REGISTRY_RELEASE_STATUSES } from '@aiproj/types'

/** 目录 release 列表查询契约：状态过滤封闭枚举、排序键封闭、分页下界有界（上界由仓储层钳制）。 */
export const listDirectoryReleasesValidator = vine.compile(
  vine.object({
    status: vine.enum(REGISTRY_RELEASE_STATUSES).optional(),
    pluginIdentity: vine.string().trim().maxLength(200).optional(),
    /** 来源过滤：true 只看示例库 seed 数据，false 只看非示例数据（v3-plugin-fixture-market-seed 4.1）。 */
    fixtureOnly: vine.boolean().optional(),
    sort: vine.enum(['-createdAt', '+createdAt', '-version', '+version']).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).optional(),
  }),
)

/** 有界受影响安装清单查询契约（上界同样由仓储层钳制）。 */
export const listAffectedInstallationsValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).optional(),
  }),
)

/**
 * 目录变更请求创建契约（tasks 3.1）：动作封闭枚举（四动作），
 * rollback 显式选中实例有界（与 canonical diff 的有界上限一致）。
 */
export const createDirectoryChangeRequestValidator = vine.compile(
  vine.object({
    action: vine.enum(['approve', 'disable', 'restore', 'rollback']),
    selectedInstanceIds: vine.array(vine.number()).maxLength(64).optional(),
  }),
)

/**
 * 回滚结构化预览查询契约（task 3.5）。
 * 回滚**目标** release 由路径参数 `:releaseId` 承载，故此处只校验可选的显式实例集合。
 */
export const rollbackPreviewValidator = vine.compile(
  vine.object({
    selectedInstanceIds: vine.array(vine.number()).maxLength(64).optional(),
  }),
)
