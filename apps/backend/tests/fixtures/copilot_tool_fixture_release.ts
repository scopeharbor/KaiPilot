/**
 * v3-copilot-plugin-tool-contract —— Copilot 插件工具 fixture release 与安装夹具。
 * 零网络、受控声明式本机数据；供 E2E 与宿主测试复用。
 */
import { DateTime } from 'luxon'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import { COPILOT_TOOL_FIXTURE_PAYLOAD, PLUGIN_SEAM_COPILOT_TOOL } from '@aiproj/types'

export const COPILOT_TOOL_FIXTURE_PLUGIN_ID = 'com.aiproj.pilot-copilot-tools'
export const COPILOT_TOOL_FIXTURE_VERSION = '1.0.0'

export const COPILOT_TOOL_FIXTURE_MANIFEST_METADATA = {
  name: 'Pilot Copilot 插件工具包',
  version: COPILOT_TOOL_FIXTURE_VERSION,
  contributions: [
    {
      contributionKey: 'pilot-copilot-tools',
      seamKey: PLUGIN_SEAM_COPILOT_TOOL,
      seamVersion: '1.0.0',
      title: 'Pilot Copilot 工具包',
      payload: COPILOT_TOOL_FIXTURE_PAYLOAD,
    },
  ],
  permissions: [
    {
      permissionKey: 'risk:read',
      seamKey: PLUGIN_SEAM_COPILOT_TOOL,
      sideEffect: 'read-only',
      network: 'none',
      purpose: '查询组织风险登记册摘要',
    },
  ],
}

/** 创建 copilot-tool fixture 的目录 release 记录（默认 approved）。 */
export async function seedCopilotToolFixtureRelease(
  organizationId: number,
  opts: { status?: string; metadata?: Record<string, unknown> } = {},
): Promise<PluginPrivateRegistryRelease> {
  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: COPILOT_TOOL_FIXTURE_PLUGIN_ID,
    version: COPILOT_TOOL_FIXTURE_VERSION,
    packageDigest: `sha256:copilot-tool-pkg-${Date.now()}`,
    manifestDigest: `sha256:copilot-tool-manifest-${Date.now()}`,
    compatibilityDigest: `sha256:copilot-tool-compat-${Date.now()}`,
    upstreamReceiptRef: `receipt-copilot-tool-${Date.now()}`,
    status: opts.status ?? 'approved',
    metadata: JSON.stringify(opts.metadata ?? COPILOT_TOOL_FIXTURE_MANIFEST_METADATA),
    rowVersion: 1,
  })
}

/** 创建 copilot-tool fixture 的安装记录。 */
export async function seedCopilotToolFixtureInstallation(
  organizationId: number,
  releaseId: number,
  opts: { status?: 'installed' | 'enabled' | 'uninstalled' } = {},
): Promise<PluginInstallation> {
  const status = opts.status ?? 'enabled'
  return await PluginInstallation.create({
    organizationId,
    pluginId: COPILOT_TOOL_FIXTURE_PLUGIN_ID,
    version: COPILOT_TOOL_FIXTURE_VERSION,
    releaseId,
    status,
    permissionConfirmation:
      status === 'enabled'
        ? {
            confirmedBy: '1',
            permissionDigest: 'sha256:perm-digest-copilot-tool',
            permissionKeys: ['risk:read', 'project:read'],
            confirmedAt: DateTime.now().toISO()!,
          }
        : null,
    packageDigest: `sha256:copilot-tool-pkg`,
    manifestDigest: `sha256:copilot-tool-manifest`,
    compatibilityDigest: `sha256:copilot-tool-compat`,
    rowVersion: 1,
    uninstalledAt: status === 'uninstalled' ? DateTime.now() : null,
  })
}
