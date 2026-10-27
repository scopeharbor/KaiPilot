/**
 * 记忆维基编入（ace wiki:ingest [--org=ID]）——v3-llm-wiki-ingest-pipeline。
 *
 * 供部署方用外部定时任务调用（仓库不内置调度器）：遍历已开启记忆维基的组织中已存在的项目空间，
 * 逐个同步执行一次编入。结果只是待审提议，不发布任何内容；每日预算与单空间串行照常生效。
 */
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class WikiIngest extends BaseCommand {
  static commandName = 'wiki:ingest'
  static description = '对已开启记忆维基的组织的项目空间执行一次 AI 编入（只产待审提议）'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: '只处理指定组织' })
  declare org: number | undefined

  async run() {
    const { default: Organization } = await import('#models/organization')
    const { default: WikiSpace } = await import('#models/wiki_space')
    const { default: WikiIngestService } =
      await import('#services/wiki_memory/ingest/wiki_ingest_service')
    const { isWikiEnabledInSettings } = await import('#services/wiki_memory/wiki_settings_service')
    const service = await this.app.container.make(WikiIngestService)

    const orgs = await Organization.query().if(this.org !== undefined, (q) =>
      q.where('id', this.org!),
    )
    let runs = 0
    for (const org of orgs) {
      if (!isWikiEnabledInSettings(org.settings)) continue
      const spaces = await WikiSpace.query()
        .where('organization_id', org.id)
        .where('scope_kind', 'project')
        .orderBy('id', 'asc')
      for (const space of spaces) {
        try {
          const run = await service.trigger(null, space, 'command')
          const done = await service.execute(run.id)
          runs++
          this.logger.info(
            `组织 ${org.id} 空间 ${space.id}：${done.status}，事件 ${done.eventsCount}，提议 ${done.proposalsCreated}`,
          )
        } catch (error) {
          this.logger.warning(
            `组织 ${org.id} 空间 ${space.id}：跳过（${error instanceof Error ? error.message : '未知错误'}）`,
          )
        }
      }
    }
    this.logger.info(`完成：执行 ${runs} 次编入`)
  }
}
