import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import {
  CANARY_ADVISORY_PLUGIN_ID,
  CANARY_ADVISORY_RELEASE_METADATA,
  CANARY_QUERY_PLUGIN_ID,
  CANARY_QUERY_RELEASE_METADATA,
} from '@aiproj/types'
import { evaluateCurrentReleaseApproval } from '#services/plugin_compatibility_service'

/**
 * v3-plugin-e2e-lifecycle-certification —— 浏览器认证夹具种子器（任务 3.1~3.3）。
 *
 * 仅 development 环境幂等执行：为 `default-org` 预置官方 canary release（approved），
 * 供 `/dev/plugin-install-harness` 沙箱页与 Playwright 认证套件驱动**真实**安装状态机。
 * 元数据复用共享契约 fixture，经 `evaluateCurrentReleaseApproval` 同一道审批门校验；
 * 不含 secret、不产生网络外发。
 *
 * 用法：node ace db:seed --files database/seeders/e2e_plugin_canary_seeder.ts
 */
/**
 * canary release 的兼容性声明（部署期事实，不属共享 metadata）。
 *
 * 共享的 `CANARY_*_RELEASE_METADATA` 只描述贡献与权限，**不含**
 * `compatibilityMatrix`——后者是「当前宿主 × 该版本」的部署期判定输入，
 * 由各夹具按当前 host 契约给出（与 tests/fixtures/first_party_plugin_canary_releases.ts
 * 同口径：hostVersion 3.0.0 / manifest schema 1.0 / permission model 1.0 / stable）。
 * 缺了它，release 审批门只会拿到 `undefined` 声明并 fail-closed。
 */
function canaryCompatibilityMatrix(
  metadata: { contributions: readonly { seamKey: string; seamVersion: string }[] },
  version: string,
) {
  return {
    pluginVersion: version,
    hostRange: '>=3.0.0 <4.0.0',
    manifestSchemaVersion: '1.0',
    permissionModelVersion: '1.0',
    channel: 'stable',
    requiredSeams: metadata.contributions.map((item) => ({
      seamKey: item.seamKey,
      seamVersion: item.seamVersion,
    })),
  }
}

export default class extends BaseSeeder {
  static environment = ['development']

  async run() {
    const org = await this.client.from('organizations').where('slug', 'default-org').first()
    if (!org) return

    // 终态（uninstalled）安装行对状态机是不可再转移的死行；作为开发期认证夹具，
    // 重置为不存在以便浏览器套件重复执行（installed/enabled 行保留，由测试自适应）。
    await this.client
      .from('plugin_installations')
      .where('organization_id', org.id)
      .where('plugin_id', CANARY_QUERY_PLUGIN_ID)
      .where('status', 'uninstalled')
      .del()
    await this.client
      .from('plugin_installations')
      .where('organization_id', org.id)
      .where('plugin_id', CANARY_ADVISORY_PLUGIN_ID)
      .where('status', 'uninstalled')
      .del()

    const breakingMetadata = {
      ...CANARY_QUERY_RELEASE_METADATA,
      name: 'cert-breaking-major',
      version: '9.9.9',
      compatibilityMatrix: {
        pluginVersion: '9.9.9',
        hostRange: '>=99.0.0 <100.0.0',
        manifestSchemaVersion: '1.0',
        permissionModelVersion: '1.0',
        channel: 'stable',
        requiredSeams: [],
      },
      contributions: [],
    }
    const releases = [
      { kind: 'query', version: '1.0.0', metadata: CANARY_QUERY_RELEASE_METADATA },
      { kind: 'query', version: '1.1.0', metadata: CANARY_QUERY_RELEASE_METADATA },
      { kind: 'advisory', version: '1.0.0', metadata: CANARY_ADVISORY_RELEASE_METADATA },
      { kind: 'query', version: '9.9.9', metadata: breakingMetadata },
    ] as const

    const now = DateTime.now().toSQL({ includeOffset: false })

    for (const item of releases) {
      const pluginIdentity =
        item.kind === 'query' ? CANARY_QUERY_PLUGIN_ID : CANARY_ADVISORY_PLUGIN_ID
      // 正式夹具必须过与生产相同的 release 审批门；唯一例外是 9.9.9 破坏性版本——
      // 它刻意模拟「绕过审批门的被篡改行」（纵深防御负例，与 canary e2e 同语义），
      // 安装预览必须仍被兼容矩阵拒绝。
      // 破坏性夹具自带声明（hostRange 99.x）时以它为准；共享 metadata 常量没有这个字段，
      // 用 `in` 做联合窄化即可，不需要 any 断言（类型抑制棘轮只许减不许增）。
      const declaredMatrix =
        'compatibilityMatrix' in item.metadata ? item.metadata.compatibilityMatrix : undefined
      // 审批校验与落库共用同一份 metadata，避免两处漂移
      const releaseMetadata = {
        ...item.metadata,
        version: item.version,
        compatibilityMatrix: {
          ...canaryCompatibilityMatrix(item.metadata, item.version),
          ...(declaredMatrix ?? {}),
          pluginVersion: item.version,
        },
      }
      if (item.version !== '9.9.9') {
        const approval = evaluateCurrentReleaseApproval(JSON.stringify(releaseMetadata))
        if (!approval.allowed) {
          throw new Error(`canary seeder approval rejected: ${approval.reasonCodes.join(',')}`)
        }
      }
      const existing = await this.client
        .from('plugin_private_registry_releases')
        .where('organization_id', org.id)
        .where('plugin_identity', pluginIdentity)
        .where('version', item.version)
        .first()
      if (existing) continue

      await this.client.table('plugin_private_registry_releases').insert({
        organization_id: org.id,
        plugin_identity: pluginIdentity,
        version: item.version,
        package_digest: `sha256:${item.kind}-package-${item.version}`,
        manifest_digest: `sha256:${item.kind}-manifest-${item.version}`,
        compatibility_digest: `sha256:${item.kind}-compat-${item.version}`,
        upstream_receipt_ref: `fixture:e2e-canary-${item.kind}-${item.version}`,
        status: 'approved',
        metadata: JSON.stringify(releaseMetadata),
        row_version: 1,
        // 走原生 query builder 插入，Lucid 的自动时间戳不生效，需显式补齐
        created_at: now,
        updated_at: now,
      })
    }
  }
}
