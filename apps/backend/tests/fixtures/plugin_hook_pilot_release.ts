/**
 * v3-compiler-hook-plugin-pilot —— Pilot 插件目录 release 测试夹具（task 4.3）。
 *
 * 模拟经私有目录审批链入库的 seeder/测试夹具（不发布真实包，conditional 边界内）。
 * 用于端到端验收套件（task 4.4）。
 */
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import { PILOT_PLUGIN_ID, PILOT_PLUGIN_VERSION, PILOT_PLUGIN_MANIFEST } from '@aiproj/types'

export interface PilotPluginReleaseFixture {
  releaseId: number
  installationId: number
  pluginId: string
  version: string
}

/**
 * 创建 pilot 插件的目录 release 记录（模拟审批通过状态）
 */
export async function seedPilotPluginRelease(
  organizationId: number,
  opts: {
    status?: 'pending' | 'approved' | 'rejected'
    pluginId?: string
    version?: string
  } = {},
): Promise<PilotPluginReleaseFixture> {
  const pluginId = opts.pluginId ?? PILOT_PLUGIN_ID
  const version = opts.version ?? PILOT_PLUGIN_VERSION
  const status = opts.status ?? 'approved'

  const metadata = JSON.stringify(PILOT_PLUGIN_MANIFEST)

  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: pluginId,
    version,
    metadata,
    status,
    packageDigest: `pilot-pkg-${Date.now()}`,
    manifestDigest: `pilot-manifest-${Date.now()}`,
    compatibilityDigest: `pilot-compat-${Date.now()}`,
    // upstream_receipt_ref 是 NOT NULL 列（缺省会导致插入失败）
    upstreamReceiptRef: `pilot-receipt-${Date.now()}`,
  })

  return {
    releaseId: Number(release.id),
    installationId: 0, // 尚未安装
    pluginId,
    version,
  }
}

/**
 * 创建 pilot 插件的安装记录
 */
export async function seedPilotPluginInstallation(
  organizationId: number,
  releaseId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    pluginId?: string
    version?: string
  } = {},
): Promise<{ installationId: number }> {
  const pluginId = opts.pluginId ?? PILOT_PLUGIN_ID
  const version = opts.version ?? PILOT_PLUGIN_VERSION
  const status = opts.status ?? 'enabled'

  const installation = await PluginInstallation.create({
    organizationId,
    pluginId,
    version,
    releaseId,
    status,
    packageDigest: `pilot-pkg-${Date.now()}`,
    manifestDigest: `pilot-manifest-${Date.now()}`,
    compatibilityDigest: `pilot-compat-${Date.now()}`,
  })

  return { installationId: Number(installation.id) }
}

/**
 * 创建完整的 pilot 插件夹具（release + installation）
 */
export async function seedPilotPluginFull(
  organizationId: number,
  opts: {
    releaseStatus?: 'pending' | 'approved' | 'rejected'
    installationStatus?: 'installed' | 'enabled' | 'uninstalled'
    pluginId?: string
    version?: string
  } = {},
): Promise<PilotPluginReleaseFixture> {
  const release = await seedPilotPluginRelease(organizationId, {
    status: opts.releaseStatus,
    pluginId: opts.pluginId,
    version: opts.version,
  })

  const { installationId } = await seedPilotPluginInstallation(organizationId, release.releaseId, {
    status: opts.installationStatus,
    pluginId: opts.pluginId,
    version: opts.version,
  })

  return {
    ...release,
    installationId,
  }
}
