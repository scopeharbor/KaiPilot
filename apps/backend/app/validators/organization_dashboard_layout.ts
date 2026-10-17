import vine from '@vinejs/vine'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITY_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES,
  ORGANIZATION_DASHBOARD_LAYOUT_SCOPES,
  type ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZE_VALUES,
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
} from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排验证器（v3-organization-dashboard-layout-builder §4.1）。
 *
 * 红线：所有 module key / size / density / breakpoint 必须在保存或预览前被白名单与上限约束。
 * 非法参数返回 VALIDATION_ERROR，绝不退化成无界插入或跨组织引用。
 */

export const ORGANIZATION_DASHBOARD_LAYOUT_MAX_MODULES = 20
export const ORGANIZATION_DASHBOARD_LAYOUT_MAX_SETTINGS_BYTES = 4096

const layoutSize = () => vine.enum(ORGANIZATION_DASHBOARD_LAYOUT_SIZE_VALUES)
const layoutDensity = () => vine.enum(ORGANIZATION_DASHBOARD_LAYOUT_DENSITY_VALUES)
const layoutScope = () =>
  vine.enum([
    ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.PERSONAL,
    ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SHARED,
  ])
const moduleKey = () => vine.enum(ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES)

/** 路由参数：organizationId 必须是正整数。 */
export const organizationDashboardLayoutParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 单一路由参数：layoutId 必须是正整数。 */
export const layoutIdParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    layoutId: vine.number().positive(),
  }),
)

/** 模块实例 schema。 */
const moduleInstanceSchema = vine.object({
  moduleKey: moduleKey(),
  size: layoutSize(),
  row: vine.number().positive().max(100),
  col: vine.number().positive().max(12),
  breakpoints: vine
    .record(
      vine.object({
        size: layoutSize().optional(),
        row: vine.number().positive().max(100).optional(),
        col: vine.number().positive().max(12).optional(),
      }),
    )
    .optional(),
  settings: vine.record(vine.any()).optional(),
})

/** 创建/更新布局 payload。 */
export const layoutPayloadValidator = vine.compile(
  vine.object({
    name: vine.string().trim().maxLength(128).optional(),
    density: layoutDensity().optional(),
    modules: vine
      .array(moduleInstanceSchema)
      .minLength(1)
      .maxLength(ORGANIZATION_DASHBOARD_LAYOUT_MAX_MODULES),
    expectedVersion: vine.number().positive().optional(),
  }),
)

/** 预览 payload（相同的 schema，但 expectedVersion 无意义）。 */
export const layoutPreviewValidator = vine.compile(
  vine.object({
    name: vine.string().trim().maxLength(128).optional(),
    density: layoutDensity().optional(),
    modules: vine
      .array(moduleInstanceSchema)
      .minLength(1)
      .maxLength(ORGANIZATION_DASHBOARD_LAYOUT_MAX_MODULES),
  }),
)

/** 复制操作 payload。 */
export const layoutCopyValidator = vine.compile(
  vine.object({
    name: vine.string().trim().maxLength(128).optional(),
    scope: layoutScope().optional(),
  }),
)

/** 设为默认 payload。 */
export const layoutSetDefaultValidator = vine.compile(
  vine.object({
    expectedVersion: vine.number().positive().optional(),
  }),
)

/**
 * 验证 payload 中的模块是否出现在注册表中，尺寸是否在模块允许范围内。
 * 返回发现的违规列表（空数组表示全部合法）。
 */
export function validateModulesAgainstRegistry(
  modules: Array<{ moduleKey: string; size: string; settings?: Record<string, unknown> }>,
): string[] {
  const errors: string[] = []

  for (const [index, mod] of modules.entries()) {
    const registry =
      ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
        mod.moduleKey as keyof typeof ORGANIZATION_DASHBOARD_MODULE_REGISTRY
      ]
    if (!registry) {
      errors.push(`模块[${index}] moduleKey "${mod.moduleKey}" 未注册`)
      continue
    }
    if (
      !registry.allowedSizes.includes(
        mod.size as (typeof ORGANIZATION_DASHBOARD_LAYOUT_SIZES)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_SIZES],
      )
    ) {
      errors.push(
        `模块[${index}] "${mod.moduleKey}" 不支持尺寸 "${mod.size}"（允许：${registry.allowedSizes.join(', ')}）`,
      )
    }
    if (
      mod.settings &&
      JSON.stringify(mod.settings).length > ORGANIZATION_DASHBOARD_LAYOUT_MAX_SETTINGS_BYTES
    ) {
      errors.push(
        `模块[${index}] "${mod.moduleKey}" settings 超过 ${ORGANIZATION_DASHBOARD_LAYOUT_MAX_SETTINGS_BYTES} 字节上限`,
      )
    }
  }

  return errors
}
