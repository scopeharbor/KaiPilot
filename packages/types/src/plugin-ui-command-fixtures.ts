/**
 * plugin-ui-command-fixtures —— V3 插件 UI command contribution fixtures
 * （八态覆盖全部 spec rule families）。
 */

import type {
  PluginUiCommandContributionV1,
  PluginUiCommandHostSnapshot,
  PluginUiCommandProjectionResult,
  PluginUiCommandFinding,
} from './plugin-ui-command.js'
import { PLUGIN_UI_COMMAND_SCHEMA_VERSION } from './plugin-ui-command.js'

// =============================================================================
// 1. 合法 contribution fixtures
// =============================================================================

/** fixture 1：合法导航命令。 */
export const VALID_NAVIGATION_CONTRIBUTION: PluginUiCommandContributionV1 = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'open-project-analytics',
  surface: 'command-palette',
  label: '查看项目分析',
  keywords: ['analytics', '分析', '报表'],
  iconKey: 'BarChart3',
  actionKey: 'navigate',
  actionParams: { route: '/projects/:projectId/analytics' },
  scopeKind: 'project',
}

/** fixture 2：合法 open-form 命令。 */
export const VALID_FORM_CONTRIBUTION: PluginUiCommandContributionV1 = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'create-risk-entry',
  surface: 'command-palette',
  label: '新建风险条目',
  keywords: ['risk', '风险'],
  iconKey: 'AlertTriangle',
  actionKey: 'open-form',
  actionParams: { formId: 'risk-register' },
  requiredPermissions: ['risk:create'],
  scopeKind: 'project',
}

/** fixture 3：合法 open-confirm 命令。 */
export const VALID_CONFIRM_CONTRIBUTION: PluginUiCommandContributionV1 = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'archive-project',
  surface: 'command-palette',
  label: '归档项目',
  keywords: ['archive', '归档'],
  iconKey: 'Archive',
  actionKey: 'open-confirm',
  actionParams: { confirmId: 'project-archive' },
  requiredPermissions: ['project:archive'],
  scopeKind: 'organization',
  routeContextKey: 'project-detail',
}

// =============================================================================
// 2. 非法 contribution fixtures
// =============================================================================

/** fixture 4：携带可执行内容的 command（函数）。 */
export const MALICIOUS_FUNCTION_CONTRIBUTION = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'malicious',
  surface: 'command-palette',
  label: '恶意命令',
  iconKey: 'Code',
  actionKey: 'navigate',
  scopeKind: 'project',
  // 负例意图是「贡献里带了可执行字段」；这里不需要真的调用浏览器 API
  execute: () => {
    throw new Error('xss')
  },
} as unknown as PluginUiCommandContributionV1

/** fixture 5：携带 iframe 的 command。 */
export const MALICIOUS_IFRAME_CONTRIBUTION = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'iframe-inject',
  surface: 'command-palette',
  label: '注入命令',
  iconKey: 'Globe',
  actionKey: 'navigate',
  actionParams: { url: 'javascript:alert(1)' },
  scopeKind: 'project',
} as unknown as PluginUiCommandContributionV1

/** fixture 6：未知 action kind。 */
export const UNKNOWN_ACTION_CONTRIBUTION: PluginUiCommandContributionV1 = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'unknown-action',
  surface: 'command-palette',
  label: '未知动作',
  iconKey: 'HelpCircle',
  actionKey: 'write' as unknown as 'navigate',
  scopeKind: 'project',
}

/** fixture 7：未知 surface。 */
export const UNKNOWN_SURFACE_CONTRIBUTION = {
  version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  contributionKey: 'unknown-surface',
  surface: 'sidebar-widget' as unknown as 'command-palette',
  label: '未知面板',
  iconKey: 'Layout',
  actionKey: 'navigate',
  scopeKind: 'project',
} as unknown as PluginUiCommandContributionV1

// =============================================================================
// 3. Host snapshot fixtures
// =============================================================================

/** fixture 8：完整有效 host snapshot。 */
export const VALID_HOST_SNAPSHOT: PluginUiCommandHostSnapshot = {
  schemaVersion: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  pluginId: 'test-plugin-alpha',
  manifestDigest: 'sha256:abcdef1234567890',
  instanceRevision: '3',
  enabled: true,
  quarantined: false,
  effectiveGrantPermissions: ['risk:create', 'project:archive'],
  effectiveGrantExpiry: null,
  trustedScope: {
    kind: 'project',
    organizationId: 'org-001',
    projectId: 'proj-001',
  },
  hostReadySeams: ['command-palette'],
  actorEligibilityRef: 'eligibility:test-user-001',
  generatedAt: '2026-08-18T12:00:00Z',
  contributions: [
    VALID_NAVIGATION_CONTRIBUTION,
    VALID_FORM_CONTRIBUTION,
    VALID_CONFIRM_CONTRIBUTION,
  ],
}

/** fixture 9：disabled instance。 */
export const DISABLED_HOST_SNAPSHOT: PluginUiCommandHostSnapshot = {
  ...VALID_HOST_SNAPSHOT,
  enabled: false,
}

/** fixture 10：quarantined instance。 */
export const QUARANTINED_HOST_SNAPSHOT: PluginUiCommandHostSnapshot = {
  ...VALID_HOST_SNAPSHOT,
  quarantined: true,
}

/** fixture 11：expired grant。 */
export const EXPIRED_GRANT_HOST_SNAPSHOT: PluginUiCommandHostSnapshot = {
  ...VALID_HOST_SNAPSHOT,
  effectiveGrantExpiry: '2026-01-01T00:00:00Z',
}

/** fixture 12：host not ready。 */
export const HOST_NOT_READY_SNAPSHOT: PluginUiCommandHostSnapshot = {
  ...VALID_HOST_SNAPSHOT,
  hostReadySeams: [],
}

/** fixture 13：cross-tenant scope。 */
export const CROSS_TENANT_SNAPSHOT: PluginUiCommandHostSnapshot = {
  ...VALID_HOST_SNAPSHOT,
  trustedScope: {
    kind: 'project',
    organizationId: 'org-other',
    projectId: 'proj-other',
  },
}

/** fixture 14：empty contributions。 */
export const EMPTY_CONTRIBUTIONS_SNAPSHOT: PluginUiCommandHostSnapshot = {
  ...VALID_HOST_SNAPSHOT,
  contributions: [],
}

// =============================================================================
// 4. Projection result fixtures
// =============================================================================

/** fixture 15：全部 accepted。 */
export const ALL_ACCEPTED_RESULT: PluginUiCommandProjectionResult = {
  accepted: [
    {
      id: 'ext.plugin.test-plugin-alpha.open-project-analytics',
      pluginId: 'test-plugin-alpha',
      contributionKey: 'open-project-analytics',
      manifestDigest: 'sha256:abcdef1234567890',
      instanceRevision: '3',
      label: '查看项目分析',
      keywords: ['analytics', '分析', '报表'],
      iconKey: 'BarChart3',
      actionKey: 'navigate',
      actionParams: { route: '/projects/:projectId/analytics' },
      requiredPermissions: [],
      scopeKind: 'project',
    },
  ],
  findings: [],
  sourceRevision: '3',
  sourceManifestDigest: 'sha256:abcdef1234567890',
  projectedAt: '2026-08-18T12:00:00Z',
}

/** fixture 16：含 blocking findings。 */
export const BLOCKING_FINDINGS_RESULT: PluginUiCommandProjectionResult = {
  accepted: [],
  findings: [
    {
      reason: 'grant-expired',
      severity: 'blocking',
      pluginId: 'test-plugin-alpha',
      evidenceRef: 'grantExpiry:2026-01-01T00:00:00Z',
    },
  ],
  sourceRevision: '3',
  sourceManifestDigest: 'sha256:abcdef1234567890',
  projectedAt: '2026-08-18T12:00:00Z',
}

/** fixture 17：含 warning findings（但有 accepted）。 */
export const WARNING_FINDINGS_RESULT: PluginUiCommandProjectionResult = {
  accepted: [
    {
      id: 'ext.plugin.test-plugin-alpha.open-project-analytics',
      pluginId: 'test-plugin-alpha',
      contributionKey: 'open-project-analytics',
      manifestDigest: 'sha256:abcdef1234567890',
      instanceRevision: '3',
      label: '查看项目分析',
      keywords: ['analytics', '分析', '报表'],
      iconKey: 'BarChart3',
      actionKey: 'navigate',
      actionParams: {},
      requiredPermissions: [],
      scopeKind: 'project',
    },
  ],
  findings: [
    {
      reason: 'contribution-schema-invalid',
      severity: 'warning',
      pluginId: 'test-plugin-alpha',
      contributionKey: 'other-command',
      evidenceRef: 'label:length=0',
    },
  ],
  sourceRevision: '3',
  sourceManifestDigest: 'sha256:abcdef1234567890',
  projectedAt: '2026-08-18T12:00:00Z',
}

// =============================================================================
// 5. Finding fixtures
// =============================================================================

/** fixture 18：各种 finding reason。 */
export const FINDING_SAMPLES: PluginUiCommandFinding[] = [
  { reason: 'core-conflict', severity: 'blocking', pluginId: 'p1', contributionKey: 'k1' },
  { reason: 'grant-escalation', severity: 'blocking', pluginId: 'p1', contributionKey: 'k2' },
  { reason: 'icon-not-found', severity: 'blocking', pluginId: 'p2', iconKey: 'UnknownIcon' },
  {
    reason: 'contribution-schema-invalid',
    severity: 'blocking',
    pluginId: 'p2',
    evidenceRef: 'label:length=0',
  },
  { reason: 'scope-mismatch', severity: 'blocking', pluginId: 'p3', contributionKey: 'k3' },
  { reason: 'cross-tenant-denied', severity: 'blocking', pluginId: 'p4' },
  { reason: 'revision-stale', severity: 'warning', pluginId: 'p5', instanceRevision: '1' },
  { reason: 'dependency-unavailable', severity: 'blocking', pluginId: 'p6' },
]

// =============================================================================
// 6. 测试用辅助数据
// =============================================================================

/** 大量 contribution（性能测试用）。 */
export function generateContributions(count: number): PluginUiCommandContributionV1[] {
  return Array.from({ length: count }, (_, i) => ({
    version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
    contributionKey: `cmd-${String(i).padStart(4, '0')}`,
    surface: 'command-palette' as const,
    label: `命令 ${i}`,
    keywords: [`kw-${i}`],
    iconKey: 'Circle',
    actionKey: 'navigate' as const,
    actionParams: { route: `/item/${i}` },
    scopeKind: 'project' as const,
  }))
}
