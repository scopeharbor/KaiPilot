/**
 * plugin-policy-bundles-fixtures.ts —— 策略包契约测试夹具
 * （纯数据构造器 + 宿主 permission/RBAC 基线 fixture；零运行时依赖）。
 *
 * ROLE_HOST_PLUGIN_PERMISSIONS 是六角色插件权限的**测试基线**，与后端
 * start/rbac/roles.ts 的 sec11 矩阵对齐（system_admin 哨兵放行；org_admin 持有
 * 安装/注册表管理；其余角色不持有管理类插件权限）。模板不得扩大 RBAC 的测试
 * 以此为判定基线。
 */

import type {
  PluginPolicyBundleDocument,
  PluginPolicyBundleRule,
  PluginPolicyRole,
} from './plugin-policy-bundles.js'
import { BUILTIN_PLUGIN_POLICY_TEMPLATES } from './plugin-policy-bundles.js'

/** 宿主已知插件 permission key 全集（与 start/rbac/permissions.ts 字面值对齐）。 */
export const POLICY_TEST_KNOWN_PERMISSIONS: readonly string[] = [
  'plugin_registry:view',
  'plugin_registry:submit',
  'plugin_registry:review',
  'plugin_registry:manage',
  'plugin_registry:rollback',
  'plugin_install:view',
  'plugin_install:manage',
]

/** 六角色 → 插件权限基线（'*' 为 system_admin 哨兵全量放行）。 */
export const ROLE_HOST_PLUGIN_PERMISSIONS: Record<PluginPolicyRole, readonly string[]> = {
  system_admin: ['*'],
  org_admin: [
    'plugin_registry:view',
    'plugin_registry:submit',
    'plugin_registry:review',
    'plugin_registry:manage',
    'plugin_registry:rollback',
    'plugin_install:view',
    'plugin_install:manage',
  ],
  project_manager: ['plugin_install:view', 'plugin_registry:view'],
  member: [],
  external_collaborator: [],
  readonly_observer: [],
}

/** 角色是否持有某宿主 permission（哨兵 '*' 全量放行）。 */
export function roleHoldsPluginPermission(role: PluginPolicyRole, permissionKey: string): boolean {
  const held = ROLE_HOST_PLUGIN_PERMISSIONS[role] ?? []
  return held.includes('*') || held.includes(permissionKey)
}

/** 单条规则构造器。 */
export function makePolicyRule(
  overrides?: Partial<PluginPolicyBundleRule>,
): PluginPolicyBundleRule {
  return {
    role: 'member',
    effect: 'deny',
    operation: 'execute',
    ...overrides,
  }
}

/** 文档构造器（默认一份最小合法文档）。 */
export function makePolicyBundle(
  overrides?: Partial<PluginPolicyBundleDocument> & { rules?: PluginPolicyBundleRule[] },
): PluginPolicyBundleDocument {
  return {
    schemaVersion: '1.0',
    bundleId: 'test.bundle',
    version: 1,
    descriptionZh: '测试用策略包：仅用于契约测试。',
    rules: [makePolicyRule()],
    ...overrides,
  }
}

/** 按 id 取内置模板文档的深拷贝（测试可安全改写）。 */
export function cloneBuiltinTemplateDocument(templateId: string): PluginPolicyBundleDocument {
  const t = BUILTIN_PLUGIN_POLICY_TEMPLATES.find((x) => x.templateId === templateId)
  if (!t) throw new Error(`unknown template: ${templateId}`)
  return JSON.parse(JSON.stringify(t.document)) as PluginPolicyBundleDocument
}
