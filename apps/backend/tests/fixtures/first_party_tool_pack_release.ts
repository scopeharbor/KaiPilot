/**
 * v3-copilot-first-party-tool-pack —— 官方四工具包 release/安装种子夹具。
 * 零网络、受控声明式本机数据；metadata 与 @aiproj/types 官方契约常量同源。
 */
import { DateTime } from 'luxon'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import {
  COPILOT_FIRST_PARTY_TOOL_PACK_MANIFEST_METADATA,
  COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID,
  COPILOT_FIRST_PARTY_TOOL_PACK_VERSION,
} from '@aiproj/types'

export const OFFICIAL_PACK_FIXTURE_MANIFEST_DIGEST = 'sha256:official-copilot-tool-pack-manifest'
export const OFFICIAL_PACK_FIXTURE_PACKAGE_DIGEST = 'sha256:official-copilot-tool-pack-package'

/** 创建官方工具包的目录 approved release（metadata 来自共享契约常量）。 */
export async function seedOfficialToolPackRelease(
  organizationId: number,
  opts: { status?: string; metadata?: Record<string, unknown> } = {},
): Promise<PluginPrivateRegistryRelease> {
  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID,
    version: COPILOT_FIRST_PARTY_TOOL_PACK_VERSION,
    packageDigest: `${OFFICIAL_PACK_FIXTURE_PACKAGE_DIGEST}-${Date.now()}`,
    manifestDigest: `${OFFICIAL_PACK_FIXTURE_MANIFEST_DIGEST}-${Date.now()}`,
    compatibilityDigest: `sha256:official-copilot-tool-pack-compat-${Date.now()}`,
    upstreamReceiptRef: `receipt-official-copilot-tool-pack-${Date.now()}`,
    status: opts.status ?? 'approved',
    metadata: JSON.stringify(
      opts.metadata ??
        (COPILOT_FIRST_PARTY_TOOL_PACK_MANIFEST_METADATA as unknown as Record<string, unknown>),
    ),
    rowVersion: 1,
  })
}

/** 创建官方工具包的安装记录。 */
export async function seedOfficialToolPackInstallation(
  organizationId: number,
  releaseId: number,
  opts: { status?: 'installed' | 'enabled' | 'uninstalled' } = {},
): Promise<PluginInstallation> {
  const status = opts.status ?? 'enabled'
  return await PluginInstallation.create({
    organizationId,
    pluginId: COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID,
    version: COPILOT_FIRST_PARTY_TOOL_PACK_VERSION,
    releaseId,
    status,
    permissionConfirmation:
      status === 'enabled'
        ? {
            confirmedBy: '1',
            permissionDigest: 'sha256:perm-digest-official-copilot-tool-pack',
            permissionKeys: ['project:view', 'risk:view', 'report:view', 'triz_skill_layer:view'],
            confirmedAt: DateTime.now().toISO()!,
          }
        : null,
    packageDigest: OFFICIAL_PACK_FIXTURE_PACKAGE_DIGEST,
    manifestDigest: OFFICIAL_PACK_FIXTURE_MANIFEST_DIGEST,
    compatibilityDigest: 'sha256:official-copilot-tool-pack-compat',
    rowVersion: 1,
    uninstalledAt: status === 'uninstalled' ? DateTime.now() : null,
  })
}
