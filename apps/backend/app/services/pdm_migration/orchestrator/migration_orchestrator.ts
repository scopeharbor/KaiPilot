/**
 * v2-pdm-migration-compatibility —— MigrationOrchestrator（Section 8）。
 *
 * 状态机编排：plan → dryRun → createSnapshot → execute → verify → dualRead
 * 任意阶段失败 → failed；回滚 → rolled_back。
 * 幂等重试：同一 run 重复 execute 不得重复映射或重复快照。
 * 红线：迁移不删除 V1 数据。
 */
import PdmMigrationRun from '#models/pdm_migration_run'
import PdmEntityMapping from '#models/pdm_entity_mapping'
import PdmMigrationSnapshot from '#models/pdm_migration_snapshot'
import PdmMigrationReport from '#models/pdm_migration_report'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import type {
  MigrationRunStatus,
  MigrationScope,
  MigrationReport,
  CanonicalProjectSnapshot,
  MigrationIssue,
  DualReadSummary,
} from '../types.js'
import { isBlocked } from '../types.js'
import { ProjectExtractor } from '../extractors/project_extractor.js'
import { WbsTaskExtractor } from '../extractors/wbs_task_extractor.js'
import { ResourceRiskExtractor } from '../extractors/resource_risk_extractor.js'
import { PdmProjector } from '../projectors/pdm_projector.js'
import { MigrationValidator } from '../validators/migration_validator.js'
import { MigrationReportBuilder } from '../reporters/migration_report_builder.js'
import { DualReadVerifier } from '../compat_adapter/dual_read_verifier.js'

export class MigrationOrchestrator {
  private extractor = new ProjectExtractor()
  private wbsTaskExtractor = new WbsTaskExtractor()
  private resourceRiskExtractor = new ResourceRiskExtractor()
  private projector = new PdmProjector()
  private validator = new MigrationValidator()
  private reportBuilder = new MigrationReportBuilder()
  private dualReadVerifier = new DualReadVerifier()

  /**
   * Section 8.1：plan — 创建 planned run，不写映射或切换读路径。
   */
  async plan(
    scope: MigrationScope,
    requestedByUserId: number,
  ): Promise<{ run: PdmMigrationRun; report: MigrationReport }> {
    const run = await PdmMigrationRun.create({
      organizationId: scope.organizationId,
      requestedByUserId,
      status: 'planned' as MigrationRunStatus,
      currentPhase: 'plan',
      scopeJson: scope as unknown as Record<string, unknown>,
      countsJson: null,
    })

    const report = this.reportBuilder.build({
      runId: run.id,
      reportType: 'plan',
      snapshot: undefined,
      issues: [],
      scope: {
        organizationId: scope.organizationId,
        projectIds: scope.projectIds,
        draftIds: scope.draftIds,
        allProjects: scope.allProjects,
        allDrafts: scope.allDrafts ?? false,
      },
      suggestions: ['查看规划报告，确认迁移范围', '如无误可执行 dry-run'],
    })

    await this.saveReport(run.id, report)

    return { run, report }
  }

  /**
   * Section 8.2：dryRun — 抽取、投影、校验、生成报告；禁止写映射。
   */
  async dryRun(runId: number): Promise<{ report: MigrationReport; issues: MigrationIssue[] }> {
    const run = await PdmMigrationRun.findOrFail(runId)
    const scope = run.scopeJson as unknown as MigrationScope

    // 抽取 Canonical Snapshot
    const snapshot = await this.extractSnapshot(scope)
    if (!snapshot || snapshot.kind !== 'project') {
      throw new Error('dryRun 仅支持项目迁移')
    }

    // 投影为 PDM
    const projection = await this.projector.project(snapshot, runId)

    // 校验
    const validationIssues = await this.validator.validateAll(snapshot, projection.pdm)
    const allIssues = [...projection.issues, ...validationIssues]

    // 构建报告（不写映射）
    const report = this.reportBuilder.build({
      runId,
      reportType: 'dry_run',
      snapshot,
      issues: allIssues,
      scope: {
        organizationId: scope.organizationId,
        projectIds: scope.projectIds,
        allProjects: scope.allProjects,
        allDrafts: scope.allDrafts ?? false,
      },
      suggestions: isBlocked(allIssues)
        ? ['请逐个解决 blocking 级别问题', '修复后重新执行 dry-run']
        : ['无 blocking 问题，可创建快照并执行迁移'],
    })

    await this.saveReport(runId, report)

    // 更新 run 状态
    if (!isBlocked(allIssues)) {
      run.status = 'dry_run_passed' as MigrationRunStatus
      run.currentPhase = 'dry_run'
      await run.save()
    } else {
      run.status = 'failed' as MigrationRunStatus
      run.currentPhase = 'dry_run'
      run.errorSummary = `存在 ${allIssues.filter((i) => i.severity === 'blocking').length} 个 blocking 问题`
      await run.save()
    }

    return { report, issues: allIssues }
  }

  /**
   * Section 8.3：createSnapshot — 保存 Canonical/PDM 快照和 hash。
   */
  async createSnapshot(
    runId: number,
    createdByUserId: number,
  ): Promise<{ snapshots: PdmMigrationSnapshot[] }> {
    const run = await PdmMigrationRun.findOrFail(runId)
    const scope = run.scopeJson as unknown as MigrationScope

    const snapshot = await this.extractSnapshot(scope)
    if (!snapshot || snapshot.kind !== 'project') {
      throw new Error('createSnapshot 仅支持项目迁移')
    }

    const projection = await this.projector.project(snapshot, runId)

    // 保存 canonical 快照
    const canonicalPayload = snapshot as unknown as Record<string, unknown>
    const canonicalHash = createHash('sha256')
      .update(JSON.stringify(canonicalPayload), 'utf-8')
      .digest('hex')
      .slice(0, 32)

    const canonicalSnapshot = await PdmMigrationSnapshot.create({
      migrationRunId: runId,
      snapshotKind: 'canonical_project',
      entityRef: String(scope.projectIds?.[0] ?? ''),
      payload: canonicalPayload,
      payloadHash: canonicalHash,
      isRollbackReady: true,
      createdByUserId,
    })

    // 保存 PDM 快照
    const pdmHash = createHash('sha256')
      .update(JSON.stringify(projection.pdm), 'utf-8')
      .digest('hex')
      .slice(0, 32)

    const pdmSnapshot = await PdmMigrationSnapshot.create({
      migrationRunId: runId,
      snapshotKind: 'pdm',
      entityRef: String(scope.projectIds?.[0] ?? ''),
      payload: projection.pdm as Record<string, unknown>,
      payloadHash: pdmHash,
      isRollbackReady: true,
      createdByUserId,
    })

    // 更新 run 状态
    run.status = 'snapshot_created' as MigrationRunStatus
    run.currentPhase = 'snapshot'
    await run.save()

    return { snapshots: [canonicalSnapshot, pdmSnapshot] }
  }

  /**
   * Section 8.4-8.5：execute — 校验前置条件后写映射。
   * 幂等：重复执行同一 run 不重复映射。
   */
  async execute(
    runId: number,
    _requestedByUserId: number,
  ): Promise<{ report: MigrationReport; mappings: PdmEntityMapping[] }> {
    const run = await PdmMigrationRun.findOrFail(runId)

    // 前置校验
    if (run.status !== 'snapshot_created' && run.status !== 'migrating') {
      throw new Error(`execute 需要 snapshot_created 状态，当前状态: ${run.status}`)
    }

    const scope = run.scopeJson as unknown as MigrationScope

    // 检查是否已有映射（幂等）
    const existingMappings = await PdmEntityMapping.query().where('migration_run_id', runId)
    if (existingMappings.length > 0) {
      // 幂等复用已有映射
      const report = this.reportBuilder.build({
        runId,
        reportType: 'execute',
        snapshot: undefined,
        issues: [],
        scope: {
          organizationId: scope.organizationId,
          projectIds: scope.projectIds,
          allProjects: scope.allProjects,
          allDrafts: scope.allDrafts,
        },
        suggestions: ['映射已存在，无需重复执行', '执行 verify 确认一致性'],
      })
      await this.saveReport(runId, report)
      return { report, mappings: existingMappings }
    }

    run.status = 'migrating' as MigrationRunStatus
    run.currentPhase = 'execute'
    await run.save()

    const snapshot = await this.extractSnapshot(scope)
    if (!snapshot || snapshot.kind !== 'project') {
      throw new Error('execute 仅支持项目迁移')
    }

    const projection = await this.projector.project(snapshot, runId)
    const allIssues = [...projection.issues]

    if (isBlocked(allIssues)) {
      run.status = 'failed' as MigrationRunStatus
      run.errorSummary = '投影存在 blocking 问题'
      await run.save()
      throw new Error(
        `execute 被阻断：存在 ${allIssues.filter((i) => i.severity === 'blocking').length} 个 blocking 问题`,
      )
    }

    // 写映射
    const mappings: PdmEntityMapping[] = []
    for (const m of projection.mappings) {
      const mapping = await PdmEntityMapping.firstOrCreate(
        {
          organizationId: scope.organizationId,
          sourceKind: m.sourceKind,
          sourceTable: m.sourceTable,
          sourceId: m.sourceId,
        },
        {
          organizationId: scope.organizationId,
          sourceKind: m.sourceKind,
          sourceTable: m.sourceTable,
          sourceId: m.sourceId,
          sourceHash: m.sourceHash,
          pdmEntityType: m.pdmEntityType,
          pdmEntityId: m.pdmEntityId,
          migrationRunId: runId,
          status: 'active',
        },
      )
      mappings.push(mapping)
    }

    // 更新计数
    const report = this.reportBuilder.build({
      runId,
      reportType: 'execute',
      snapshot,
      issues: allIssues,
      scope: {
        organizationId: scope.organizationId,
        projectIds: scope.projectIds,
        allProjects: scope.allProjects,
        allDrafts: scope.allDrafts ?? false,
      },
      suggestions: ['迁移执行完成，请运行 verify 确认一致性'],
    })
    await this.saveReport(runId, report)

    run.status = 'verifying' as MigrationRunStatus
    run.currentPhase = 'execute_done'
    await run.save()

    return { report, mappings }
  }

  /**
   * 执行双读验证。
   */
  async verifyDualRead(
    runId: number,
    projectId?: number,
    draftId?: number,
  ): Promise<{ dualReadSummary?: DualReadSummary; report: MigrationReport }> {
    const run = await PdmMigrationRun.findOrFail(runId)
    const scope = run.scopeJson as unknown as MigrationScope

    const issues: MigrationIssue[] = []
    let dualReadSummary: DualReadSummary | undefined

    if (projectId) {
      dualReadSummary = await this.dualReadVerifier.verifyProject(
        projectId,
        scope.organizationId,
        runId,
      )
      issues.push(...dualReadSummary.blockingMismatches)

      if (dualReadSummary.overallMatch) {
        run.status = 'dual_read' as MigrationRunStatus
      } else {
        run.status = 'verifying' as MigrationRunStatus
      }
    } else if (draftId) {
      dualReadSummary = await this.dualReadVerifier.verifyDraft(
        draftId,
        scope.organizationId,
        runId,
      )
      issues.push(...dualReadSummary.blockingMismatches)
    }

    const report = this.reportBuilder.build({
      runId,
      reportType: 'dual_read',
      snapshot: undefined,
      issues,
      scope: {
        organizationId: scope.organizationId,
        projectIds: scope.projectIds ?? (projectId ? [projectId] : undefined),
        allProjects: false,
        allDrafts: false,
      },
      suggestions: dualReadSummary?.overallMatch
        ? ['双读通过，可完成迁移并切换读路径']
        : ['双读存在 mismatch，请修复后重试'],
    })
    await this.saveReport(runId, report)

    if (dualReadSummary?.overallMatch) {
      run.currentPhase = 'dual_read'
      await run.save()
    }

    return { dualReadSummary, report }
  }

  /**
   * Section 8.6：rollback — 切回 V1 读路径，标记当前 run 的映射/快照为 rolled_back。
   */
  async rollback(runId: number): Promise<void> {
    const run = await PdmMigrationRun.findOrFail(runId)

    // 标记映射
    await PdmEntityMapping.query()
      .where('migration_run_id', runId)
      .where('status', 'active')
      .update({ status: 'rolled_back' })

    // 更新 run 状态
    run.status = 'rolled_back' as MigrationRunStatus
    run.currentPhase = 'rollback'
    run.rollbackInfo = `回滚于 ${DateTime.now().toISO()}`
    run.completedAt = DateTime.now()
    await run.save()

    // 写回滚报告
    const report = this.reportBuilder.build({
      runId,
      reportType: 'rollback',
      snapshot: undefined,
      issues: [],
      scope: {
        organizationId: run.organizationId,
        allProjects: false,
        allDrafts: false,
      },
      suggestions: ['回滚完成，请确认 V1 路径可用'],
    })
    await this.saveReport(runId, report)
  }

  /**
   * 完成迁移（进入 completed 状态）。
   */
  async complete(runId: number): Promise<void> {
    const run = await PdmMigrationRun.findOrFail(runId)

    if (run.status !== 'dual_read') {
      throw new Error(`complete 需要 dual_read 状态，当前状态: ${run.status}`)
    }

    run.status = 'completed' as MigrationRunStatus
    run.currentPhase = 'completed'
    run.completedAt = DateTime.now()
    await run.save()
  }

  // ── 私有辅助 ──

  private async extractSnapshot(scope: MigrationScope): Promise<CanonicalProjectSnapshot | null> {
    if (!scope.projectIds || scope.projectIds.length === 0) return null

    const projectId = scope.projectIds[0]
    const snapshot = await this.extractor.extract(projectId, scope.organizationId)
    await this.wbsTaskExtractor.extractInto(snapshot)
    await this.resourceRiskExtractor.extractInto(snapshot)
    return snapshot
  }

  private async saveReport(runId: number, report: MigrationReport): Promise<void> {
    const severity =
      report.blockingCount > 0 ? 'critical' : report.warningCount > 0 ? 'warning' : 'success'

    const dbReport = await PdmMigrationReport.create({
      migrationRunId: runId,
      reportType: report.reportType,
      severity,
      blockingCount: report.blockingCount,
      warningCount: report.warningCount,
      infoCount: report.infoCount,
      payload: report as unknown as Record<string, unknown>,
      generatedAt: DateTime.fromISO(report.generatedAt),
    })

    // 更新 run 的 latestReportId
    await PdmMigrationRun.query().where('id', runId).update({ latestReportId: dbReport.id })
  }
}
