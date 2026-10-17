import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { cleanupAiRecords } from '#services/ai_records/cleanup_service'

export default class AiRecordsPurgeCommand extends BaseCommand {
  static commandName = 'ai:records:purge'
  static description = '清除全部组织的 AI 对话、记忆、用量、分析与草案记录，保留业务和设置'
  static options: CommandOptions = { startApp: true, staysAlive: false }

  @flags.boolean({ description: '执行事务删除；省略时仅盘点，不删除' })
  declare apply: boolean

  async run() {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const result = await cleanupAiRecords(db.connection().getWriteClient(), this.apply)
    for (const row of result.tables) this.logger.info(`${row.table}: ${row.count}`)
    this.logger.info(
      `${result.applied ? '已清除' : '待清除'} ${result.total} 条 AI 记录（不含正式业务与设置）`,
    )
  }
}
