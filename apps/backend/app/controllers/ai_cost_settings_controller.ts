import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import AiConnectionPolicy from '#policies/ai_connection_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import ExchangeRateService, {
  EXCHANGE_RATE_SOURCE,
} from '#services/ai_pricing/exchange_rate_service'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import User from '#models/user'

@inject()
export default class AiCostSettingsController {
  constructor(
    private policy: AiConnectionPolicy,
    private audit: AuditService,
  ) {}

  async show(ctx: HttpContext) {
    const organizationId = this.organizationId(ctx)
    const exchange = new ExchangeRateService()
    const [currency, table] = await Promise.all([
      exchange.getDisplayCurrency(organizationId),
      exchange.latestTable(),
    ])
    return ctx.response.ok({
      data: {
        displayCurrency: currency,
        exchangeRateSource: EXCHANGE_RATE_SOURCE,
        exchangeRateAsOf: table?.asOf ?? null,
        exchangeRateStale: table?.stale ?? true,
        supportedCurrencies: table
          ? [...new Set([currency, ...Object.keys(table.ratesPerEur)])].sort()
          : [currency],
      },
    })
  }

  async update(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.organizationId(ctx)
    if (!(await this.policy.manage(user, organizationId))) {
      throw new PermissionDeniedException('无权修改 AI 成本设置')
    }
    const exchange = new ExchangeRateService()
    const before = await exchange.getDisplayCurrency(organizationId)
    const table = await exchange.latestTable()
    const requested = String(ctx.request.input('displayCurrency') ?? '')
      .trim()
      .toUpperCase()
    if (table && requested !== 'EUR' && !table.ratesPerEur[requested]) {
      throw new ValidationException(`汇率服务暂不支持币种 ${requested || '（空）'}`)
    }
    const displayCurrency = await exchange.setDisplayCurrency(organizationId, requested)
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_UPDATED,
      userId: user.id,
      organizationId,
      entityType: 'organization_setting',
      entityId: organizationId,
      requestId: ctx.request.id() ?? null,
      changes: { before: { displayCurrency: before }, after: { displayCurrency } },
      metadata: { reason: 'ai_cost_display_currency' },
    })
    return this.show(ctx)
  }

  private organizationId(ctx: HttpContext): number {
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!Number.isFinite(organizationId) || organizationId <= 0) {
      throw new PermissionDeniedException('缺少组织上下文')
    }
    return organizationId
  }
}
