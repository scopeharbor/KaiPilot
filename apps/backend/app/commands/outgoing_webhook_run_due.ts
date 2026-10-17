import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * v2-5-outgoing-webhook-delivery-ledger -- 到期出站 webhook 投递本地 runner（design D4/6.5）。
 *
 * 选 due pending 事件执行（fixture 客户端默认；真实外发需 OUTGOING_WEBHOOK_DELIVERY_ENABLED
 * 且用户明确授权 smoke）。SQLite/local-dev 兼容，无需 Redis/Kafka。可用定时调度（cron）调用。
 */
export default class OutgoingWebhookRunDue extends BaseCommand {
  static commandName = 'outgoing_webhook:run-due'
  static description = '处理到期出站 webhook 投递（due attempts）'
  static options: CommandOptions = { startApp: true, allowUnknownFlags: false }

  async run() {
    const { default: OutgoingWebhookDeliveryService } =
      await import('#services/webhooks/outgoing_webhook_delivery_service')
    const service = new OutgoingWebhookDeliveryService()
    const result = await service.processDue()
    this.logger.info(`处理 ${result.processed} 条到期出站 webhook 投递`)
  }
}
