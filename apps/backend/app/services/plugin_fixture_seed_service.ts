/**
 * v3-plugin-fixture-market-seed —— 本机示例插件库 seed loader（backend service 层）。
 *
 * 红线（对齐 design.md D2/D3/D4 与 spec 六条 Requirement）：
 * - profile guard 在 service 层再次执行（CLI 之外直接调用同样被拦）；production/unknown
 *   fail closed，且任何环境都必须显式启用；拒绝时零数据库写入。
 * - 加载只走真实既有 lifecycle：包完整性校验（catalog digest）→
 *   evaluateCurrentReleaseApproval 审批门 → PluginPrivateRegistryRelease.create 登记 →
 *   可选 PluginInstallService.preview/confirm 两步安装。绝不伪造 enabled 安装、
 *   grant 或审计 receipt（审计只发生在正式 service 内部）。
 * - reset 只处理 provenance（fixture-seed: receipt 命名空间）+ digest 匹配的
 *   seed-owned 资源；优先 uninstall → withdraw；不删除 release/installation 行，
 *   组织自建插件与非 seed 数据不受影响。
 * - 全链路零网络。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import PluginInstallation from '#models/plugin_installation'
import PluginFixtureSeedRecord from '#models/plugin_fixture_seed_record'
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import { evaluateCurrentReleaseApproval } from '#services/plugin_compatibility_service'
import PluginInstallService from '#services/plugin_install_service'
import { validateTransition } from '#services/plugin_registry/status_orchestration_core'
import {
  FIXTURE_SEED_RECEIPT_PREFIX,
  computeFixtureSeedCatalogDigest,
  computeFixtureSeedItemDigest,
  listFixtureSeedCatalogItemsForProfile,
  normalizeFixtureSeedRunReport,
  resolveFixtureSeedProfileGuard,
  validateFixtureSeedCatalog,
  type FixtureSeedCatalogItemV1,
  type FixtureSeedCatalogProfile,
  type FixtureSeedCatalogV1,
  type FixtureSeedFileSource,
  type FixtureSeedRunReportV1,
} from '@aiproj/types/plugin-fixture-market-seed'
import { FIXTURE_SEED_CATALOG_V1 } from '@aiproj/types/plugin-fixture-market-seed-fixtures'

/** 运行时上下文：environment 为原始值，由 guard 归一并裁决。 */
export interface FixtureSeedRuntimeContext {
  readonly environment: unknown
  readonly explicitEnable: boolean
}

export interface FixtureSeedOrganizationInput {
  readonly organizationId: number
  readonly actorId: number
  readonly runtime: FixtureSeedRuntimeContext
  readonly catalog?: FixtureSeedCatalogV1
}

function sha256Of(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

/** 由 catalog 条目构造 release metadata（声明式镜像 manifest 身份/权限，不含内容负载）。 */
export function buildSeedReleaseMetadata(item: FixtureSeedCatalogItemV1): Record<string, unknown> {
  return {
    name: item.displayName,
    version: item.version,
    publisher: 'aiproj-official',
    provenance: 'fixture-seed',
    contributions: [],
    permissions: [],
    compatibilityMatrix: {
      pluginVersion: item.version,
      hostRange: '>=3.0.0 <4.0.0',
      manifestSchemaVersion: '1.0',
      permissionModelVersion: '1.0',
      channel: 'stable',
      requiredSeams: [...item.compatibility.requiredSeams],
    },
    fixtureSeed: {
      itemId: item.itemId,
    },
  }
}

@inject()
export class PluginFixtureSeedService {
  constructor(private readonly install: PluginInstallService) {}

  /** 统一守卫入口：拒绝时返回 blocking 报告且零写入。 */
  private evaluateGuard(
    runtime: FixtureSeedRuntimeContext,
    command: FixtureSeedRunReportV1['command'],
    profile: FixtureSeedCatalogProfile,
    catalog: FixtureSeedCatalogV1,
  ): FixtureSeedRunReportV1 | null {
    const guard = resolveFixtureSeedProfileGuard({
      environment: runtime.environment,
      explicitEnable: runtime.explicitEnable,
    })
    if (guard.allowed) return null
    return normalizeFixtureSeedRunReport({
      command,
      profile,
      environment: guard.environment,
      status: 'blocking',
      catalogVersion: catalog.catalogVersion,
      catalogDigest: computeFixtureSeedCatalogDigest(catalog),
      guardAllowed: false,
      guardCode: guard.code,
      items: [],
    })
  }

  /**
   * seed / reseed：幂等。相同 catalog + 相同初始状态重复执行产生相同结果；
   * 部分条目失败不影响其他条目（逐项结果），但任何 integrity/approval 失败的条目
   * 都不会产生可安装或已启用记录。
   */
  async seedToOrganization(
    input: FixtureSeedOrganizationInput & {
      readonly profile: FixtureSeedCatalogProfile
      readonly install?: boolean
      readonly fileSource?: FixtureSeedFileSource
    },
  ): Promise<FixtureSeedRunReportV1> {
    const catalog = input.catalog ?? FIXTURE_SEED_CATALOG_V1
    const guard = resolveFixtureSeedProfileGuard({
      environment: input.runtime.environment,
      explicitEnable: input.runtime.explicitEnable,
    })
    if (!guard.allowed) {
      return normalizeFixtureSeedRunReport({
        command: 'seed',
        profile: input.profile,
        environment: guard.environment,
        status: 'blocking',
        catalogVersion: catalog.catalogVersion,
        catalogDigest: computeFixtureSeedCatalogDigest(catalog),
        guardAllowed: false,
        guardCode: guard.code,
        items: [],
      })
    }

    // 结构与完整性校验（fail closed）：损坏/漂移的 catalog 不产生任何写入
    const validation = validateFixtureSeedCatalog(catalog, { fileSource: input.fileSource })
    if (validation.status !== 'passed' || !validation.catalog) {
      return this.blockedValidationReport('seed', input.profile, catalog)
    }

    const items = listFixtureSeedCatalogItemsForProfile(validation.catalog, input.profile)
    const results = []
    for (const item of items) {
      results.push(
        await this.seedSingleItem(input.organizationId, input.actorId, item, {
          catalog: validation.catalog,
          install: input.install ?? false,
        }),
      )
    }
    const hasFailure = results.some((r) => r.outcome === 'failed')
    return normalizeFixtureSeedRunReport({
      command: 'seed',
      profile: input.profile,
      environment: guard.environment,
      status: hasFailure ? 'blocking' : 'passed',
      catalogVersion: validation.catalog.catalogVersion,
      catalogDigest: validation.catalogDigest,
      guardAllowed: true,
      items: results,
    })
  }

  /**
   * reset preview：只清点 provenance + digest 匹配的 seed-owned 资源；
   * 用户修改过、跨组织引用或 stale 的条目标记 conflict/stale 且默认跳过。
   */
  async resetPreviewFromOrganization(
    input: FixtureSeedOrganizationInput,
  ): Promise<FixtureSeedRunReportV1> {
    const catalog = input.catalog ?? FIXTURE_SEED_CATALOG_V1
    const guarded = this.evaluateGuard(input.runtime, 'reset', catalog.defaultProfile, catalog)
    if (guarded) return guarded

    const records = await PluginFixtureSeedRecord.query()
      .where('organization_id', input.organizationId)
      .where('catalog_id', catalog.catalogId)
    const classified = await this.classifyRecordsForReset(input.organizationId, catalog, records)
    return normalizeFixtureSeedRunReport({
      command: 'reset',
      profile: catalog.defaultProfile,
      environment: 'unknown',
      status: 'passed',
      catalogVersion: catalog.catalogVersion,
      catalogDigest: computeFixtureSeedCatalogDigest(catalog),
      guardAllowed: true,
      items: classified,
    })
  }

  /**
   * reset confirm：按 preview 分类逐项执行——优先 uninstall（经 install service）→
   * withdraw release（复用 registry 状态机）；stale record 清空 refs；conflict 跳过。
   */
  async resetConfirmFromOrganization(
    input: FixtureSeedOrganizationInput & { readonly previewOnly?: false },
  ): Promise<FixtureSeedRunReportV1> {
    const catalog = input.catalog ?? FIXTURE_SEED_CATALOG_V1
    const guarded = this.evaluateGuard(input.runtime, 'reset', catalog.defaultProfile, catalog)
    if (guarded) return guarded

    const records = await PluginFixtureSeedRecord.query()
      .where('organization_id', input.organizationId)
      .where('catalog_id', catalog.catalogId)
    const classified = await this.classifyRecordsForReset(input.organizationId, catalog, records)
    const byItemId = new Map(classified.map((r) => [r.itemId, r]))

    for (const record of records) {
      const plan = byItemId.get(record.itemId)
      if (!plan || plan.outcome !== 'ok') continue

      // 1) 先卸载安装：按目录身份查找并校验仍绑定本 seed release（不依赖 state 回写，
      //    HTTP 面的安装同样纳入白名单）；卸载失败则保守跳过该项的 withdraw
      if (record.releaseId !== null) {
        const installation = await PluginInstallation.query()
          .where('organization_id', input.organizationId)
          .where('plugin_id', record.pluginIdentity)
          .first()
        if (
          installation &&
          installation.releaseId === record.releaseId &&
          installation.status !== 'uninstalled'
        ) {
          try {
            const preview = await this.install.preview(input.organizationId, input.actorId, {
              action: 'uninstall',
              pluginId: record.pluginIdentity,
            })
            await this.install.confirm(input.organizationId, input.actorId, {
              previewHandle: preview.previewHandle,
              previewDigest: preview.previewDigest,
            })
          } catch {
            continue
          }
        }
      }

      // 2) 再撤回 release（复用 registry 状态机，不删除行）
      if (record.releaseId !== null) {
        const release = await PluginPrivateRegistryRelease.query()
          .where('organization_id', input.organizationId)
          .where('id', record.releaseId)
          .first()
        if (release && release.upstreamReceiptRef.startsWith(FIXTURE_SEED_RECEIPT_PREFIX)) {
          const transition = validateTransition(
            'withdraw',
            release.status as unknown as Parameters<typeof validateTransition>[1],
          )
          if (transition.valid) {
            release.status = transition.instruction.targetStatus
            release.rowVersion += 1
            await release.save()
          }
        }
      }

      // 3) 回收本 change 创建且仍指向自家 release 的目录卡片（seed-owned；否则不动）
      if (record.releaseId !== null) {
        const card = await PluginPrivateRegistryEntry.query()
          .where('organization_id', input.organizationId)
          .where('plugin_identity', record.pluginIdentity)
          .first()
        if (card && card.recommendedReleaseId === record.releaseId) {
          await card.delete()
        }
      }

      // 4) 清空 seed state refs（保留行作为 reset 痕迹，reseed 时 updateOrCreate 复用）
      record.releaseId = null
      record.installationId = null
      await record.save()
    }

    const finalRecords = await PluginFixtureSeedRecord.query()
      .where('organization_id', input.organizationId)
      .where('catalog_id', catalog.catalogId)
    const reclassified = await this.classifyRecordsForReset(
      input.organizationId,
      catalog,
      finalRecords,
    )
    const hasFailure = reclassified.some((r) => r.outcome === 'failed')
    return normalizeFixtureSeedRunReport({
      command: 'reset',
      profile: catalog.defaultProfile,
      environment: 'unknown',
      status: hasFailure ? 'blocking' : 'passed',
      catalogVersion: catalog.catalogVersion,
      catalogDigest: computeFixtureSeedCatalogDigest(catalog),
      guardAllowed: true,
      items: reclassified.map((r) =>
        r.action === 'withdraw' ? { ...r, action: 'withdraw' as const, outcome: 'ok' as const } : r,
      ),
    })
  }

  // ===========================================================================
  // 内部：单条目 seed（真实 lifecycle）
  // ===========================================================================

  private async seedSingleItem(
    organizationId: number,
    actorId: number,
    item: FixtureSeedCatalogItemV1,
    ctx: { catalog: FixtureSeedCatalogV1; install: boolean },
  ): Promise<FixtureSeedRunReportV1['items'][number]> {
    const base = { itemId: item.itemId, pluginIdentity: item.pluginIdentity }
    try {
      const existing = await PluginPrivateRegistryRelease.query()
        .where('organization_id', organizationId)
        .where('plugin_identity', item.pluginIdentity)
        .where('upstream_receipt_ref', item.upstreamReceiptRef)
        .first()

      let releaseId: number
      if (existing) {
        // 幂等：同 receipt 的既有 release 必须 digest 一致，否则视为漂移冲突
        if (
          existing.packageDigest !== item.expectedPackageDigest ||
          existing.manifestDigest !== item.expectedManifestDigest ||
          existing.version !== item.version
        ) {
          return {
            ...base,
            action: 'none',
            outcome: 'failed',
            detailCode: 'seed-item-release-conflict',
          }
        }
        releaseId = existing.id
      } else {
        // 审批门：走当前真实 approval evaluator；未通过则不落任何行
        const metadata = buildSeedReleaseMetadata(item)
        const approval = evaluateCurrentReleaseApproval(JSON.stringify(metadata))
        if (!approval.allowed) {
          return {
            ...base,
            action: 'none',
            outcome: 'failed',
            detailCode: 'seed-item-approval-rejected',
          }
        }
        const created = await PluginPrivateRegistryRelease.create({
          organizationId,
          pluginIdentity: item.pluginIdentity,
          version: item.version,
          packageDigest: item.expectedPackageDigest,
          manifestDigest: item.expectedManifestDigest,
          compatibilityDigest: sha256Of(JSON.stringify(metadata.compatibilityMatrix)),
          upstreamReceiptRef: item.upstreamReceiptRef,
          status: 'approved',
          metadata: JSON.stringify(metadata),
          rowVersion: 1,
        })
        releaseId = created.id
      }

      // 可选两步安装（preview → confirm；权限确认边界不变）
      let installationId: number | null = null
      if (ctx.install) {
        const current = await PluginInstallation.query()
          .where('organization_id', organizationId)
          .where('plugin_id', item.pluginIdentity)
          .first()
        if (current && current.releaseId === releaseId && current.status !== 'uninstalled') {
          installationId = current.id
        } else {
          const preview = await this.install.preview(organizationId, actorId, {
            action: 'install',
            pluginId: item.pluginIdentity,
            releaseId,
            expectedDigest: item.expectedPackageDigest,
          })
          const installation = await this.install.confirm(organizationId, actorId, {
            previewHandle: preview.previewHandle,
            previewDigest: preview.previewDigest,
          })
          installationId = installation.id
        }
      }

      // 目录卡片（registry 真实数据模型的一半）：缺卡则建卡并指向本 release；
      // 已有卡片（组织自管）一律不动。
      const existingEntry = await PluginPrivateRegistryEntry.query()
        .where('organization_id', organizationId)
        .where('plugin_identity', item.pluginIdentity)
        .first()
      if (!existingEntry) {
        await PluginPrivateRegistryEntry.create({
          organizationId,
          pluginIdentity: item.pluginIdentity,
          pluginName: item.displayName,
          recommendedReleaseId: releaseId,
          recommendedVersion: item.version,
          rowVersion: 1,
        })
      } else if (existingEntry.recommendedReleaseId === null) {
        existingEntry.recommendedReleaseId = releaseId
        existingEntry.recommendedVersion = item.version
        existingEntry.rowVersion += 1
        await existingEntry.save()
      }

      // 最小 seed state upsert（非 authority）
      await PluginFixtureSeedRecord.updateOrCreate(
        {
          organizationId,
          catalogId: ctx.catalog.catalogId,
          catalogVersion: ctx.catalog.catalogVersion,
          itemId: item.itemId,
        },
        {
          pluginIdentity: item.pluginIdentity,
          version: item.version,
          releaseId,
          installationId,
          itemDigest: computeFixtureSeedItemDigest(item),
          catalogDigest: computeFixtureSeedCatalogDigest(ctx.catalog),
        },
      )

      const outcome = existing ? 'already-present' : 'ok'
      return installationId !== null
        ? { ...base, action: 'install', outcome, releaseId, installationId }
        : { ...base, action: existing ? 'none' : 'create-release', outcome, releaseId }
    } catch {
      return { ...base, action: 'validate', outcome: 'failed', detailCode: 'seed-tool-error' }
    }
  }

  // ===========================================================================
  // 内部：reset 分类（provenance 白名单 + digest 新鲜度）
  // ===========================================================================

  private async classifyRecordsForReset(
    organizationId: number,
    catalog: FixtureSeedCatalogV1,
    records: PluginFixtureSeedRecord[],
  ): Promise<FixtureSeedRunReportV1['items'][number][]> {
    const itemByItemId = new Map(catalog.items.map((i) => [i.itemId, i]))
    const results: FixtureSeedRunReportV1['items'][number][] = []
    for (const record of records) {
      const base = { itemId: record.itemId, pluginIdentity: record.pluginIdentity }
      if (record.releaseId === null && record.installationId === null) {
        results.push({
          ...base,
          action: 'none',
          outcome: 'already-present',
          detailCode: 'seed-state-stale-ref',
        })
        continue
      }
      const release =
        record.releaseId !== null
          ? await PluginPrivateRegistryRelease.query()
              .where('organization_id', organizationId)
              .where('id', record.releaseId)
              .first()
          : null
      if (!release) {
        results.push({
          ...base,
          action: 'none',
          outcome: 'skipped',
          detailCode: 'seed-state-stale-ref',
        })
        continue
      }
      // provenance 白名单：receipt 必须仍在 seed 命名空间且 identity 一致
      if (
        !release.upstreamReceiptRef.startsWith(FIXTURE_SEED_RECEIPT_PREFIX) ||
        release.pluginIdentity !== record.pluginIdentity
      ) {
        results.push({
          ...base,
          action: 'none',
          outcome: 'skipped',
          detailCode: 'seed-reset-cross-org-ref',
        })
        continue
      }
      // digest 新鲜度：catalog 已知该条目时必须匹配，否则视为用户修改
      const item = itemByItemId.get(record.itemId)
      if (item && release.packageDigest !== item.expectedPackageDigest) {
        results.push({
          ...base,
          action: 'none',
          outcome: 'skipped',
          detailCode: 'seed-reset-conflict-user-modified',
        })
        continue
      }
      results.push({ ...base, action: 'withdraw', outcome: 'ok', releaseId: release.id })
    }
    return results.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
  }

  /** 校验失败时的统一 blocking 报告（零写入；明细 findings 由 CLI dry-run/检查器承载）。 */
  private blockedValidationReport(
    command: FixtureSeedRunReportV1['command'],
    profile: FixtureSeedCatalogProfile,
    catalog: FixtureSeedCatalogV1,
  ): FixtureSeedRunReportV1 {
    return normalizeFixtureSeedRunReport({
      command,
      profile,
      environment: 'unknown',
      status: 'blocking',
      catalogVersion: catalog.catalogVersion,
      catalogDigest: computeFixtureSeedCatalogDigest(catalog),
      guardAllowed: true,
      items: [],
    })
  }
}
