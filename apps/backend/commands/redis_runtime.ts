/**
 * v2-redis-minimum-runtime-support —— Ace 命令：redis:runtime（design D7, task 5.4）。
 *
 * 子命令：
 *   gate    运行 Redis 就绪门禁自检（连接可达、SET/GET/DEL 读写探针、参数完整）
 *   health  运行 Redis 健康探活（disabled/up/down 三态）
 *
 * 输出简体中文脱敏摘要，禁止暴露 host/password/连接串。供启用 Redis 前自检。
 */
import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { RedisReadinessGate } from '#services/redis/redis_readiness_gate'
import { checkRedisHealth } from '#services/redis/redis_health'

export default class RedisRuntimeCommand extends BaseCommand {
  static commandName = 'redis:runtime'
  static description = 'Redis 最小运行基础自检（就绪门禁 / 健康探活）'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  async run(): Promise<void> {
    const args = this.parsed?.args ?? {}
    const subcommand = (args._?.[0] as string) ?? 'gate'

    switch (subcommand) {
      case 'gate':
        return this.gate()
      case 'health':
        return this.health()
      default:
        this.logger.error(`未知子命令: ${subcommand}`)
        this.logger.info('可用子命令: gate, health')
    }
  }

  private async gate(): Promise<void> {
    const gate = new RedisReadinessGate()
    const result = await gate.check()

    this.logger.info(result.summary)
    this.logger.info(`连接: ${result.connection}（启用: ${result.enabled ? '是' : '否'}）`)
    this.logger.info(
      `blocking: ${result.blockingCount}, warning: ${result.warningCount}, info: ${result.infoCount}`,
    )

    for (const issue of result.issues) {
      this.logger.info(`  [${issue.severity}] ${issue.message}`)
    }

    if (result.status === 'blocked') {
      this.logger.error('❌ 存在 blocking 问题，禁止声明该 Redis 可承载限流或缓存')
    } else if (result.status === 'warning') {
      this.logger.warning('⚠️ 存在警告项，建议处理后再启用限流器 redis store')
    } else {
      this.logger.info('✅ Redis 就绪门禁通过')
    }
  }

  private async health(): Promise<void> {
    const result = await checkRedisHealth()
    this.logger.info(`Redis 健康状态: ${result.status}`)
    if (result.status === 'up') {
      this.logger.info(`  连接: ${result.connection}，延迟: ${result.latencyMs}ms`)
    } else if (result.status === 'down') {
      this.logger.warning(`  探活失败分类: ${result.error}`)
    } else {
      this.logger.info('  Redis 未启用，健康检查报告 disabled（不影响就绪）')
    }
  }
}
