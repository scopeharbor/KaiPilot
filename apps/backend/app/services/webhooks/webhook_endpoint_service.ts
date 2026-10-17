/**
 * v2-5-provider-incoming-webhook-foundation —— 端点管理 Service（design D4/D9）。
 *
 * 注册端点（生成随机签名密钥、AES-GCM 加密存储、响应不回显明文）、启用/禁用、
 * 轮换密钥（过渡窗口）、更新容差、分页查询投递账本（组织隔离）。管理写操作触发审计。
 */
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import WebhookEndpoint from '#models/webhook_endpoint'
import WebhookDelivery from '#models/webhook_delivery'
import IntegrationTokenCipher from '#services/integrations/token_cipher'
import AuditService, { AuditEvent } from '#services/audit_service'
import { isSupportedWebhookProvider } from './verifiers/registry.js'
import type {
  WebhookEndpointDto,
  WebhookEndpointCreatedDto,
  WebhookDeliveryLedgerEntryDto,
  WebhookSignatureResult,
  WebhookTimestampResult,
  WebhookDedupResult,
} from '@aiproj/types'

export interface CreateEndpointInput {
  provider: string
  slug: string
  timestampToleranceSeconds?: number
  enabled?: boolean
}

export interface EndpointActor {
  userId: number
  organizationId: number
}

export interface LedgerQuery {
  page: number
  perPage: number
  provider?: string
}

export interface PaginatedLedger {
  data: WebhookDeliveryLedgerEntryDto[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export default class WebhookEndpointService {
  constructor(
    private cipher: IntegrationTokenCipher = new IntegrationTokenCipher(),
    private audit: AuditService = new AuditService(),
  ) {}

  async create(
    input: CreateEndpointInput,
    actor: EndpointActor,
  ): Promise<WebhookEndpointCreatedDto> {
    if (!isSupportedWebhookProvider(input.provider)) {
      throw new InvalidWebhookProviderError(input.provider)
    }
    const plainSecret = generateSecret()
    const encrypted = this.cipher.encrypt(plainSecret)
    const endpoint = await WebhookEndpoint.create({
      organizationId: actor.organizationId,
      provider: input.provider,
      slug: input.slug,
      signingSecretEncrypted: encrypted,
      previousSecretEncrypted: null,
      secretRotatedAt: null,
      timestampToleranceSeconds: input.timestampToleranceSeconds ?? 300,
      enabled: input.enabled ?? false,
      createdBy: actor.userId,
    })

    await this.audit.log({
      event: AuditEvent.WEBHOOK_ENDPOINT_CREATED,
      severity: 'info',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'webhook_endpoint',
      entityId: Number(endpoint.id),
      metadata: { provider: input.provider, slug: input.slug },
    })

    return {
      ...this.toDto(endpoint),
      secret: { signingSecret: plainSecret, rotatedAt: null },
    }
  }

  async list(actor: EndpointActor, provider?: string): Promise<WebhookEndpointDto[]> {
    const query = WebhookEndpoint.query().where('organization_id', actor.organizationId)
    if (provider) query.where('provider', provider)
    const rows = await query.orderBy('created_at', 'desc')
    return rows.map((r) => this.toDto(r))
  }

  async setEnabled(
    endpointId: number,
    enabled: boolean,
    actor: EndpointActor,
  ): Promise<WebhookEndpointDto> {
    const endpoint = await this.findOwned(endpointId, actor)
    endpoint.enabled = enabled
    await endpoint.save()
    await this.audit.log({
      event: enabled ? AuditEvent.WEBHOOK_ENDPOINT_ENABLED : AuditEvent.WEBHOOK_ENDPOINT_DISABLED,
      severity: 'info',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'webhook_endpoint',
      entityId: Number(endpoint.id),
      metadata: { provider: endpoint.provider, slug: endpoint.slug, enabled },
    })
    return this.toDto(endpoint)
  }

  async updateTolerance(
    endpointId: number,
    toleranceSeconds: number,
    actor: EndpointActor,
  ): Promise<WebhookEndpointDto> {
    const endpoint = await this.findOwned(endpointId, actor)
    endpoint.timestampToleranceSeconds = toleranceSeconds
    await endpoint.save()
    await this.audit.log({
      event: AuditEvent.WEBHOOK_ENDPOINT_UPDATED,
      severity: 'info',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'webhook_endpoint',
      entityId: Number(endpoint.id),
      metadata: {
        provider: endpoint.provider,
        slug: endpoint.slug,
        timestampToleranceSeconds: toleranceSeconds,
      },
    })
    return this.toDto(endpoint)
  }

  async getOwned(endpointId: number, actor: EndpointActor): Promise<WebhookEndpointDto> {
    return this.toDto(await this.findOwned(endpointId, actor))
  }

  async getOwnedModel(
    endpointId: number,
    actor: Pick<EndpointActor, 'organizationId'>,
  ): Promise<WebhookEndpoint> {
    return this.findOwned(endpointId, actor)
  }

  async rotateSecret(
    endpointId: number,
    actor: EndpointActor,
  ): Promise<{ secret: string; endpoint: WebhookEndpointDto }> {
    const endpoint = await this.findOwned(endpointId, actor)
    const plainSecret = generateSecret()
    endpoint.previousSecretEncrypted = endpoint.signingSecretEncrypted
    endpoint.signingSecretEncrypted = this.cipher.encrypt(plainSecret)
    endpoint.secretRotatedAt = DateTime.now()
    await endpoint.save()

    await this.audit.log({
      event: AuditEvent.WEBHOOK_ENDPOINT_SECRET_ROTATED,
      severity: 'warning',
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'webhook_endpoint',
      entityId: Number(endpoint.id),
      metadata: { provider: endpoint.provider, slug: endpoint.slug },
    })

    return { secret: plainSecret, endpoint: this.toDto(endpoint) }
  }

  async listDeliveries(
    endpointId: number,
    actor: EndpointActor,
    query: LedgerQuery,
  ): Promise<PaginatedLedger> {
    await this.findOwned(endpointId, actor)
    const baseQuery = WebhookDelivery.query()
      .where('organization_id', actor.organizationId)
      .where('endpoint_id', endpointId)
    if (query.provider) baseQuery.where('provider', query.provider)
    const totalRow = await baseQuery.clone().count('* as total').first()
    const rows = await baseQuery
      .clone()
      .orderBy('received_at', 'desc')
      .forPage(query.page, query.perPage)

    const totalNum = Number((totalRow?.$extras as Record<string, unknown>)?.total ?? 0)
    return {
      data: rows.map((r) => this.toLedgerEntry(r)),
      meta: {
        total: totalNum,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.max(1, Math.ceil(totalNum / query.perPage)),
      },
    }
  }

  private async findOwned(
    endpointId: number,
    actor: Pick<EndpointActor, 'organizationId'>,
  ): Promise<WebhookEndpoint> {
    const endpoint = await WebhookEndpoint.query()
      .where('id', endpointId)
      .where('organization_id', actor.organizationId)
      .first()
    if (!endpoint) throw new WebhookEndpointNotFoundError(endpointId)
    return endpoint
  }

  private toDto(endpoint: WebhookEndpoint): WebhookEndpointDto {
    return {
      id: Number(endpoint.id),
      provider: endpoint.provider,
      slug: endpoint.slug,
      enabled: endpoint.enabled,
      timestampToleranceSeconds: endpoint.timestampToleranceSeconds,
      secretRotatedAt: endpoint.secretRotatedAt ? endpoint.secretRotatedAt.toISO() : null,
      createdAt: endpoint.createdAt.toISO()!,
      updatedAt: endpoint.updatedAt ? endpoint.updatedAt.toISO() : null,
    }
  }

  private toLedgerEntry(row: WebhookDelivery): WebhookDeliveryLedgerEntryDto {
    return {
      id: Number(row.id),
      provider: row.provider,
      endpointId: row.endpointId,
      idempotencyKey: row.idempotencyKey,
      eventType: row.eventType,
      signatureResult: row.signatureResult as WebhookSignatureResult,
      timestampResult: row.timestampResult as WebhookTimestampResult,
      dedupResult: row.dedupResult as WebhookDedupResult,
      payloadDigest: row.payloadDigest,
      receivedAt: row.receivedAt.toISO()!,
    }
  }
}

export class InvalidWebhookProviderError extends Error {
  constructor(provider: string) {
    super(`不支持的 webhook provider: ${provider}`)
    this.name = 'InvalidWebhookProviderError'
  }
}

export class WebhookEndpointNotFoundError extends Error {
  constructor(id: number) {
    super(`webhook endpoint 不存在或跨组织不可见: ${id}`)
    this.name = 'WebhookEndpointNotFoundError'
  }
}
