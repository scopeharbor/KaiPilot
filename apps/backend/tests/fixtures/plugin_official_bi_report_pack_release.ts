/**
 * v3-bi-report-plugin-pack —— Official BI 报表包目录 release 与安装测试夹具。
 *
 * 用于端到端集成测试与宿主测试套件（零网络、受控测试夹具），复用 Pilot 夹具结构，
 * 仅将 payload 替换为官方包 OFFICIAL_BI_REPORT_PACK_PAYLOAD。
 */
import { DateTime } from 'luxon'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import {
  PLUGIN_SEAM_TEMPLATE_PACK,
  OFFICIAL_BI_REPORT_PACK_PAYLOAD,
  OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
  OFFICIAL_BI_REPORT_PACK_VERSION,
} from '@aiproj/types'

export const OFFICIAL_BI_REPORT_PACK_PLUGIN_ID_FIXTURE = OFFICIAL_BI_REPORT_PACK_PLUGIN_ID
export const OFFICIAL_BI_REPORT_PACK_VERSION_FIXTURE = OFFICIAL_BI_REPORT_PACK_VERSION

export const OFFICIAL_BI_REPORT_PACK_MANIFEST_METADATA = {
  name: 'Official BI Report Pack',
  version: OFFICIAL_BI_REPORT_PACK_VERSION,
  contributions: [
    {
      contributionKey: 'official-bi-templates',
      seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
      seamVersion: '1.0.0',
      title: 'Official BI Templates',
      payload: OFFICIAL_BI_REPORT_PACK_PAYLOAD,
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

export interface OfficialBiReportPackReleaseFixture {
  release: PluginPrivateRegistryRelease
  pluginId: string
  version: string
}

/**
 * 创建 official BI 报表包的目录 release 记录（默认 approved 状态）。
 */
export async function seedOfficialBiReportPackRelease(
  organizationId: number,
  opts: {
    status?: string
    pluginId?: string
    version?: string
    metadata?: Record<string, unknown>
  } = {},
): Promise<OfficialBiReportPackReleaseFixture> {
  const pluginId = opts.pluginId ?? OFFICIAL_BI_REPORT_PACK_PLUGIN_ID
  const version = opts.version ?? OFFICIAL_BI_REPORT_PACK_VERSION
  const status = opts.status ?? 'approved'
  const metadata = JSON.stringify(opts.metadata ?? OFFICIAL_BI_REPORT_PACK_MANIFEST_METADATA)

  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: pluginId,
    version,
    packageDigest: `sha256:official-bi-pkg-${Date.now()}-${Math.random()}`,
    manifestDigest: `sha256:official-bi-manifest-${Date.now()}-${Math.random()}`,
    compatibilityDigest: `sha256:official-bi-compat-${Date.now()}`,
    upstreamReceiptRef: `receipt-official-bi-${Date.now()}`,
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
 * 创建 official BI 报表包的安装记录。
 */
export async function seedOfficialBiReportPackInstallation(
  organizationId: number,
  release: PluginPrivateRegistryRelease,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    pluginId?: string
    version?: string
    confirmedByUserId?: number
  } = {},
): Promise<PluginInstallation> {
  const pluginId = opts.pluginId ?? OFFICIAL_BI_REPORT_PACK_PLUGIN_ID
  const version = opts.version ?? OFFICIAL_BI_REPORT_PACK_VERSION
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
            permissionDigest: 'sha256:perm-digest-official',
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
