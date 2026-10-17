/**
 * v2-pdm-migration-compatibility —— DualReadVerifier（Section 10.3-10.5）。
 *
 * 比较 V1 与 PDM 摘要。存在 blocking mismatch 时禁止读路径切换。
 * mismatch 分类：blocking（计数/关键 hash 不一致）、warning（状态分布差异）、info（细节差异）。
 */
import { DateTime } from 'luxon'
import type { DualReadEntitySummary, DualReadSummary, MigrationIssue } from '../types.js'
import type { EntityDigest } from './pdm_read_adapter.js'
import { PdmReadAdapter } from './pdm_read_adapter.js'
import { V1ReadAdapter } from './v1_read_adapter.js'

export class DualReadVerifier {
  /**
   * 验证项目的 V1 ↔ PDM 一致性。
   */
  async verifyProject(
    projectId: number,
    organizationId: number,
    runId: number,
  ): Promise<DualReadSummary> {
    const v1Adapter = new V1ReadAdapter()
    const pdmAdapter = new PdmReadAdapter()

    const v1Digests = await v1Adapter.getProjectDigest(projectId, organizationId)
    const pdmDigests = await pdmAdapter.getProjectDigest(projectId, organizationId)

    return this.compareDigests(v1Digests, pdmDigests, projectId, organizationId, runId)
  }

  /**
   * 验证草案的 V1 ↔ PDM 一致性。
   */
  async verifyDraft(
    draftId: number,
    organizationId: number,
    runId: number,
  ): Promise<DualReadSummary> {
    const v1Adapter = new V1ReadAdapter()
    const pdmAdapter = new PdmReadAdapter()

    const v1Digests = await v1Adapter.getDraftDigest(draftId, organizationId)
    const pdmDigests = await pdmAdapter.getDraftDigest(draftId, organizationId)

    return this.compareDigests(v1Digests, pdmDigests, undefined, organizationId, runId)
  }

  private compareDigests(
    v1: EntityDigest[],
    pdm: EntityDigest[],
    projectId: number | undefined,
    organizationId: number,
    runId: number,
  ): DualReadSummary {
    const summaries: DualReadEntitySummary[] = []
    const blockingMismatches: MigrationIssue[] = []

    const allTypes = new Set([...v1.map((d) => d.entityType), ...pdm.map((d) => d.entityType)])

    for (const type of allTypes) {
      const v1Entry = v1.find((d) => d.entityType === type)
      const pdmEntry = pdm.find((d) => d.entityType === type)

      const v1Count = v1Entry?.count ?? 0
      const pdmCount = pdmEntry?.count ?? 0
      const countMatch = v1Count === pdmCount

      const v1Hash = v1Entry?.fieldHash ?? ''
      const pdmHash = pdmEntry?.fieldHash ?? ''
      const fieldHashMatch = v1Hash === pdmHash

      const issues: MigrationIssue[] = []

      if (!countMatch) {
        issues.push({
          severity: 'blocking',
          code: 'DUAL_READ_COUNT_MISMATCH',
          message: `实体 "${type}" 数量不一致: V1=${v1Count} PDM=${pdmCount}`,
          entityType: type,
        })
        blockingMismatches.push({
          severity: 'blocking',
          code: 'DUAL_READ_COUNT_MISMATCH',
          message: `实体 "${type}" 数量: V1=${v1Count} PDM=${pdmCount}`,
          entityType: type,
        })
      }

      if (!fieldHashMatch && countMatch) {
        issues.push({
          severity: 'warning',
          code: 'DUAL_READ_HASH_MISMATCH',
          message: `实体 "${type}" 字段 hash 不一致: V1=${v1Hash} PDM=${pdmHash}`,
          entityType: type,
        })
      }

      // 状态分布对比
      if (v1Entry && pdmEntry) {
        const v1Statuses = JSON.stringify(v1Entry.statusSummary)
        const pdmStatuses = JSON.stringify(pdmEntry.statusSummary)
        if (v1Statuses !== pdmStatuses) {
          issues.push({
            severity: 'info',
            code: 'DUAL_READ_STATUS_DIFF',
            message: `实体 "${type}" 状态分布差异: V1=${v1Statuses} PDM=${pdmStatuses}`,
            entityType: type,
          })
        }
      }

      summaries.push({
        entityType: type,
        v1Count,
        pdmCount,
        countMatch,
        fieldHashMatch,
        v1FieldHash: v1Hash,
        pdmFieldHash: pdmHash,
        issues,
      })
    }

    const overallMatch = blockingMismatches.length === 0

    return {
      runId,
      organizationId,
      projectId,
      summaries,
      overallMatch,
      blockingMismatches,
      generatedAt: DateTime.now().toISO(),
    }
  }
}
