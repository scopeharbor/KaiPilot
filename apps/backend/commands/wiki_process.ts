/**
 * 记忆维基流程实况刷新（ace wiki:process [--org=ID]）——v3-llm-wiki-process-reality。
 *
 * 供部署方用外部定时任务调用（仓库不内置调度器）：对已开启记忆维基的组织，以组织所有者身份刷新
 * 任务流转与变更审批流程页。只写确定性派生段并按簿记发布；人写的声明与解读保留；不调用任何模型。
 */
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class WikiProcess extends BaseCommand {
  static commandName = 'wiki:process'
  static description = '刷新已开启记忆维基的组织的流程实况（任务流转 / 变更审批，确定性统计）'
  static options: CommandOptions = { startApp: true }

  @flags.number({ description: '只处理指定组织' })
  declare org: number | undefined

  async run() {
    const { default: Organization } = await import('#models/organization')
    const { default: User } = await import('#models/user')
    const { default: WikiProcessRealityService } =
      await import('#services/wiki_memory/process/wiki_process_reality_service')
    const { isWikiEnabledInSettings } = await import('#services/wiki_memory/wiki_settings_service')
    const service = await this.app.container.make(WikiProcessRealityService)

    const orgs = await Organization.query().if(this.org !== undefined, (q) =>
      q.where('id', this.org!),
    )
    let done = 0
    for (const org of orgs) {
      if (!isWikiEnabledInSettings(org.settings)) continue
      const owner = org.ownerId ? await User.find(org.ownerId) : null
      if (!owner) {
        this.logger.warning(`组织 ${org.id}：没有所有者账号，跳过`)
        continue
      }
      try {
        const s = await service.refresh({ user: owner, organizationId: org.id })
        done++
        this.logger.info(
          `组织 ${org.id}：新建 ${s.created}、更新 ${s.updated}、未变 ${s.unchanged}、跳过 ${s.skipped}`,
        )
      } catch (error) {
        this.logger.warning(
          `组织 ${org.id}：跳过（${error instanceof Error ? error.message : '未知错误'}）`,
        )
      }
    }
    this.logger.info(`完成：刷新 ${done} 个组织的流程实况`)
  }
}
