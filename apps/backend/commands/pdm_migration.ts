/**
 * v2-pdm-migration-compatibility —— Ace 命令：pdm:migration（Section 9）。
 *
 * 子命令：plan / dry-run / execute / verify / rollback / status
 * 所有命令默认 dry-run，禁止默认全库 execute。
 */
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { MigrationOrchestrator } from '#services/pdm_migration/orchestrator/migration_orchestrator'
import { PgCompatibilityGate } from '#services/pdm_migration/validators/pg_compatibility_gate'
import PdmMigrationRun from '#models/pdm_migration_run'

export const options: CommandOptions = {
  startApp: true,
  staysAlive: false,
}

export default class PdmMigrationCommand extends BaseCommand {
  static commandName = 'pdm:migration'
  static description = 'V1→PDM 迁移管理命令'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  /**
   * 用法：node ace pdm:migration <subcommand> [options]
   *
   * 子命令：
   *   plan      创建迁移规划
   *   dry-run   执行预检
   *   execute   执行迁移
   *   verify    双读验证
   *   rollback  回滚
   *   status    查看状态
   *   pg-gate   PG 兼容门禁
   */
  static aliases: string[] = []

  async run(): Promise<void> {
    const args = this.parsed?.args ?? {}
    const subcommand = (args._?.[0] as string) ?? 'status'

    switch (subcommand) {
      case 'plan':
        return this.plan()
      case 'dry-run':
        return this.dryRun()
      case 'execute':
        return this.execute()
      case 'verify':
        return this.verify()
      case 'rollback':
        return this.rollback()
      case 'status':
        return this.status()
      case 'pg-gate':
        return this.pgGate()
      case 'complete':
        return this.complete()
      default:
        this.logger.error(`未知子命令: ${subcommand}`)
        this.logger.info(
          '可用子命令: plan, dry-run, execute, verify, rollback, status, pg-gate, complete',
        )
    }
  }

  private async plan(): Promise<void> {
    const orgId = Number(this.parsed?.args?.organization ?? 0)
    if (!orgId) {
      this.logger.error('请指定组织 ID: --organization=1')
      return
    }

    const orchestrator = new MigrationOrchestrator()
    const { run, report } = await orchestrator.plan(
      {
        organizationId: orgId,
        allProjects: true,
        allDrafts: false,
      },
      1,
    )

    this.logger.info(`✅ 迁移规划已创建 runId=${run.id}`)
    this.logger.info(`组织: ${orgId}`)
    this.logger.info(`状态: ${run.status}`)
    this.logger.info(
      `blocking: ${report.blockingCount}, warning: ${report.warningCount}, info: ${report.infoCount}`,
    )
    this.logger.info('下一步: 执行 dry-run 命令')
  }

  private async dryRun(): Promise<void> {
    const runId = Number(this.parsed?.args?.run ?? 0)
    if (!runId) {
      this.logger.error('请指定 run ID: --run=1')
      return
    }

    const run = await PdmMigrationRun.find(runId)
    if (!run) {
      this.logger.error(`run ${runId} 不存在`)
      return
    }

    const orchestrator = new MigrationOrchestrator()
    const { report } = await orchestrator.dryRun(runId)

    this.logger.info(`runId=${runId}`)
    this.logger.info(`blocking: ${report.blockingCount}`)
    this.logger.info(`warning: ${report.warningCount}`)

    if (report.blockingCount > 0) {
      this.logger.error('❌ 存在 blocking 问题，请解决后重试')
      for (const issue of report.issues.filter((i) => i.severity === 'blocking')) {
        this.logger.error(`  [${issue.code}] ${issue.message}`)
      }
    } else {
      this.logger.info('✅ 预检通过')
      this.logger.info('下一步: 执行 snapshot 命令')
    }
  }

  private async execute(): Promise<void> {
    const runId = Number(this.parsed?.args?.run ?? 0)
    if (!runId) {
      this.logger.error('请指定 run ID: --run=1')
      return
    }

    const orchestrator = new MigrationOrchestrator()

    // 先创建快照
    try {
      await orchestrator.createSnapshot(runId, 1)
      this.logger.info('✅ 快照已创建')
    } catch (e: any) {
      this.logger.warning(`快照创建可能已存在: ${e.message}`)
    }

    // 执行
    try {
      const { report } = await orchestrator.execute(runId, 1)
      this.logger.info(`✅ 迁移执行完成 runId=${runId}`)
      this.logger.info(
        `映射数: ${report.counts.projects + report.counts.wbsNodes + report.counts.tasks + report.counts.dependencies}`,
      )
      this.logger.info('下一步: 执行 verify 命令进行双读验证')
    } catch (e: any) {
      this.logger.error(`❌ 执行失败: ${e.message}`)
    }
  }

  private async verify(): Promise<void> {
    const runId = Number(this.parsed?.args?.run ?? 0)
    const projectId = Number(this.parsed?.args?.project ?? 0)
    if (!runId || !projectId) {
      this.logger.error('请指定 run ID 和 project ID: --run=1 --project=1')
      return
    }

    const orchestrator = new MigrationOrchestrator()
    const { dualReadSummary } = await orchestrator.verifyDualRead(runId, projectId)

    if (dualReadSummary?.overallMatch) {
      this.logger.info('✅ 双读验证通过')
      this.logger.info('下一步: 执行 complete 命令完成迁移')
    } else {
      this.logger.error('❌ 双读存在 mismatch')
      for (const issue of dualReadSummary?.blockingMismatches ?? []) {
        this.logger.error(`  [${issue.code}] ${issue.message}`)
      }
    }
  }

  private async complete(): Promise<void> {
    const runId = Number(this.parsed?.args?.run ?? 0)
    if (!runId) {
      this.logger.error('请指定 run ID: --run=1')
      return
    }

    const orchestrator = new MigrationOrchestrator()
    await orchestrator.complete(runId)
    this.logger.info(`✅ 迁移 runId=${runId} 已完成`)
  }

  private async rollback(): Promise<void> {
    const runId = Number(this.parsed?.args?.run ?? 0)
    if (!runId) {
      this.logger.error('请指定 run ID: --run=1')
      return
    }

    const orchestrator = new MigrationOrchestrator()
    await orchestrator.rollback(runId)
    this.logger.info(`✅ 迁移 runId=${runId} 已回滚`)
    this.logger.info('V1 读路径已恢复')
  }

  private async status(): Promise<void> {
    const runId = this.parsed?.args?.run ? Number(this.parsed?.args?.run) : undefined

    if (runId) {
      const run = await PdmMigrationRun.find(runId)
      if (!run) {
        this.logger.error(`run ${runId} 不存在`)
        return
      }
      this.printRun(run)
    } else {
      const runs = await PdmMigrationRun.query().orderBy('created_at', 'desc').limit(10)
      if (runs.length === 0) {
        this.logger.info('暂无迁移记录')
        return
      }
      for (const run of runs) {
        this.printRun(run)
        this.logger.info('---')
      }
    }
  }

  private async pgGate(): Promise<void> {
    const orgId = Number(this.parsed?.args?.organization ?? 0)
    if (!orgId) {
      this.logger.error('请指定组织 ID: --organization=1')
      return
    }

    const gate = new PgCompatibilityGate()
    const result = await gate.check(orgId)

    // 简体中文摘要
    this.logger.info(result.summary)
    this.logger.info(
      `blocking: ${result.blockingCount}, warning: ${result.warningCount}, info: ${result.infoCount}`,
    )

    for (const issue of result.issues) {
      this.logger.info(`  [${issue.severity}] ${issue.message}`)
    }

    if (result.status === 'blocked') {
      this.logger.error('❌ 存在 blocking 问题，禁止声明 PostgreSQL 迁移可用')
    } else if (result.status === 'warning') {
      this.logger.warning('⚠️ 存在警告项，建议在正式切换前处理')
    } else {
      this.logger.info('✅ PG 兼容门禁通过，迁移前置条件满足')
    }

    this.logger.info('')
    this.logger.info(gate.getTypeMappingReport())

    // 下一步建议
    if (result.status === 'blocked') {
      this.logger.info('下一步建议：修复上述 blocking 问题后重新运行 pdm:migration pg-gate')
    } else {
      this.logger.info('下一步建议：运行 pdm:migration plan 开始迁移规划')
    }
  }

  private printRun(run: PdmMigrationRun): void {
    this.logger.info(`runId=${run.id} 组织=${run.organizationId} 状态=${run.status}`)
    this.logger.info(`  阶段: ${run.currentPhase ?? '-'}`)
    this.logger.info(`  操作者: ${run.requestedByUserId}`)
    this.logger.info(`  创建时间: ${run.createdAt.toISO()}`)
    if (run.errorSummary) {
      this.logger.info(`  错误: ${run.errorSummary}`)
    }
  }
}
