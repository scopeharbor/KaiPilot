/**
 * v3-template-as-plugin-package —— Pilot 模板包目录 release 与安装测试夹具（tasks §7.2）。
 *
 * 用于端到端集成测试与宿主测试套件（零网络、受控测试夹具）。
 */
import { DateTime } from 'luxon'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import { PLUGIN_SEAM_TEMPLATE_PACK, PILOT_TEMPLATE_PACK_PAYLOAD } from '@aiproj/types'

export const PILOT_TEMPLATE_PACK_PLUGIN_ID = 'com.aiproj.pilot-bi-template-pack'
export const PILOT_TEMPLATE_PACK_VERSION = '1.0.0'

export const PILOT_TEMPLATE_PACK_MANIFEST_METADATA = {
  name: 'Pilot BI 报表模板包',
  version: PILOT_TEMPLATE_PACK_VERSION,
  contributions: [
    {
      contributionKey: 'pilot-bi-templates',
      seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
      seamVersion: '1.0.0',
      title: 'Pilot BI 模板包',
      payload: PILOT_TEMPLATE_PACK_PAYLOAD,
    },
  ],
  permissions: [
    {
      permissionKey: 'report:view',
      seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
      sideEffect: 'read-only',
      network: 'none',
      purpose: '查看组织 BI 报表模板及预览聚合数据',
    },
  ],
}

export interface PilotTemplatePackReleaseFixture {
  release: PluginPrivateRegistryRelease
  pluginId: string
  version: string
}

/**
 * 创建 pilot 模板包的目录 release 记录（默认 approved 状态）。
 */
export async function seedPilotTemplatePackRelease(
  organizationId: number,
  opts: {
    status?: string
    pluginId?: string
    version?: string
    metadata?: Record<string, unknown>
  } = {},
): Promise<PilotTemplatePackReleaseFixture> {
  const pluginId = opts.pluginId ?? PILOT_TEMPLATE_PACK_PLUGIN_ID
  const version = opts.version ?? PILOT_TEMPLATE_PACK_VERSION
  const status = opts.status ?? 'approved'
  const metadata = JSON.stringify(opts.metadata ?? PILOT_TEMPLATE_PACK_MANIFEST_METADATA)

  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: pluginId,
    version,
    packageDigest: `sha256:pilot-tpl-pkg-${Date.now()}`,
    manifestDigest: `sha256:pilot-tpl-manifest-${Date.now()}`,
    compatibilityDigest: `sha256:pilot-tpl-compat-${Date.now()}`,
    upstreamReceiptRef: `receipt-pilot-tpl-${Date.now()}`,
    status,
    metadata,
    rowVersion: 1,
  })

  return {
    release,
    pluginId,
    version,
  }
}

/**
 * 创建 pilot 模板包的安装记录。
 */
export async function seedPilotTemplatePackInstallation(
  organizationId: number,
  release: PluginPrivateRegistryRelease,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    pluginId?: string
    version?: string
    confirmedByUserId?: number
  } = {},
): Promise<PluginInstallation> {
  const pluginId = opts.pluginId ?? PILOT_TEMPLATE_PACK_PLUGIN_ID
  const version = opts.version ?? PILOT_TEMPLATE_PACK_VERSION
  const status = opts.status ?? 'enabled'
  const confirmedBy = String(opts.confirmedByUserId ?? 1)

  return await PluginInstallation.create({
    organizationId,
    pluginId,
    version,
    releaseId: release.id,
    status,
    permissionConfirmation:
      status === 'enabled'
        ? {
            confirmedBy,
            permissionDigest: 'sha256:perm-digest-pilot',
            permissionKeys: ['report:view'],
            confirmedAt: DateTime.now().toISO()!,
          }
        : null,
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    rowVersion: 1,
    uninstalledAt: status === 'uninstalled' ? DateTime.now() : null,
  })
}
