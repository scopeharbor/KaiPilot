// @aiproj/backend — TenantIdentificationAuditService（v3-multitenant-tenant-identification §9.1）。
//
// spec「Tenant decision audit MUST be low-sensitive and actionable」：为**识别链路**的
// 六类决定写低敏审计——拒绝 / 降级 / 快照过期 / 组织切换 / 歧义输入 / super admin 全局模式。
//
// 与 `TenantIsolationAuditService`（隔离执行层六类：denial/stale_scope/global_access/
// registry_violation/degraded/replay）的分工：那一层记「查询/写入/预览被隔离拦下」，
// 本服务记「本次请求的租户是怎么识别出来的、为什么被否」。两者事件枚举不重叠。
//
// 低敏保证（spec 明令排除项）：入参只接受 actor 引用、组织 ID、scope hash、scopeMode /
// selectionSource / resolutionReason 枚举、operation 字符串、requestId、idempotencyKey
// 与时间戳。刻意**不提供** metadata / message / targetName / payload 等自由字段，
// 调用方没有把隐藏资源名、隐藏计数、原始 token、secret、prompt、模型输出、完整日志、
// 文件正文或绝对路径写进审计的入口。落库前再做一次 forbidden key 扫描兜底。

import AuditService, { AuditEvent, type AuditEntry, type AuditEventType } from './audit_service.js'
import {
  hasTenantIdForbiddenKeys,
  type TenantIdentificationAuditMetadata,
  type TenantResolutionReason,
  type TenantScopeMode,
  type TenantSelectionSource,
} from '@aiproj/types/multitenant-tenant-identification'

/** 六类识别审计事件的语义键（对外稳定，映射到 AuditEvent）。 */
export const TENANT_IDENTIFICATION_AUDIT_KINDS = [
  'denied',
  'degraded',
  'stale',
  'switched',
  'ambiguous',
  'global_mode',
] as const
export type TenantIdentificationAuditKind = (typeof TENANT_IDENTIFICATION_AUDIT_KINDS)[number]

const KIND_TO_EVENT: Record<TenantIdentificationAuditKind, AuditEventType> = {
  denied: AuditEvent.TENANT_IDENTIFICATION_DENIED,
  degraded: AuditEvent.TENANT_IDENTIFICATION_DEGRADED,
  stale: AuditEvent.TENANT_SELECTION_STALE,
  switched: AuditEvent.TENANT_SELECTION_SWITCHED,
  ambiguous: AuditEvent.TENANT_IDENTIFICATION_AMBIGUOUS,
  global_mode: AuditEvent.TENANT_SCOPE_MODE_GLOBAL,
}

/** 严重级固定，不由调用方指定（避免把拒绝写成 info）。 */
const KIND_TO_SEVERITY: Record<TenantIdentificationAuditKind, AuditEntry['severity']> = {
  denied: 'warning',
  degraded: 'info',
  stale: 'warning',
  switched: 'info',
  ambiguous: 'error',
  global_mode: 'warning',
}

/** 低敏入参：全部是枚举 / 数值 ID / hash / code / requestId。 */
export interface TenantIdentificationAuditInput {
  /** actor 引用（如 `user:7`）；不是用户名/邮箱。 */
  actorRef: string
  /** 落 `audit_logs.user_id`，仅供本组织内追责。 */
  userId?: number | null
  /**
   * actor 自己解析出的组织（拒绝场景可能为 null）。
   * **隐藏目标的组织归属绝不写入**——跨组织被拒时这里记的是 actor 的 scope，不是目标的。
   */
  organizationId: number | null
  projectId?: number | null
  scopeMode: TenantScopeMode
  selectionSource: TenantSelectionSource
  resolutionReason: TenantResolutionReason
  /** 低敏 scope hash（16 位十六进制，不可反推组织名）。 */
  scopeHash: string
  /** 操作标识（路由名/服务方法名等稳定低敏串）。 */
  operation: string
  requestId: string
  idempotencyKey?: string | null
}

/** 组织切换事件额外携带 previous/next scope hash 对比（spec「Organization switch is auditable」）。 */
export interface TenantSwitchAuditInput extends TenantIdentificationAuditInput {
  previousScopeHash: string | null
  nextScopeHash: string
  /** 切换后新的 selection epoch（§4.3 失效判据）。 */
  selectionEpoch?: number | null
}

/** 构造结果：低敏审计元数据 + 可直接落库的 AuditEntry。 */
export interface TenantIdentificationAuditRecord {
  kind: TenantIdentificationAuditKind
  metadata: TenantIdentificationAuditMetadata
  entry: AuditEntry
}

export default class TenantIdentificationAuditService {
  constructor(private readonly audit: AuditService = new AuditService()) {}

  /** 租户识别拒绝（非成员/组织隐藏/资源归属不符/全局模式未许可）。 */
  buildDenial(input: TenantIdentificationAuditInput): TenantIdentificationAuditRecord {
    return this.build('denied', input)
  }

  /** 识别链路降级（resolver 依赖故障，§3.5）。 */
  buildDegraded(input: TenantIdentificationAuditInput): TenantIdentificationAuditRecord {
    return this.build('degraded', input)
  }

  /** 快照/成员关系过期（membership 移除、角色降权、roleVersion 失效）。 */
  buildStale(input: TenantIdentificationAuditInput): TenantIdentificationAuditRecord {
    return this.build('stale', input)
  }

  /** 组织切换成功（记录 previous/next scope hash，不记组织名）。 */
  buildSwitch(input: TenantSwitchAuditInput): TenantIdentificationAuditRecord {
    return this.build('switched', input, {
      previousScopeHash: input.previousScopeHash,
      nextScopeHash: input.nextScopeHash,
      previousToNextChanged: input.previousScopeHash !== input.nextScopeHash,
      ...((input.selectionEpoch ?? null) === null ? {} : { selectionEpoch: input.selectionEpoch }),
    })
  }

  /** 歧义输入（route/body/资源归属/快照互相矛盾）。 */
  buildAmbiguous(input: TenantIdentificationAuditInput): TenantIdentificationAuditRecord {
    return this.build('ambiguous', input)
  }

  /** super admin 显式全局/运维模式（spec「Global low-sensitive mode is audited」）。 */
  buildGlobalMode(input: TenantIdentificationAuditInput): TenantIdentificationAuditRecord {
    return this.build('global_mode', input)
  }

  /** 落库（沿用 AuditService 的不阻塞语义：写失败只记日志，不影响业务）。 */
  async record(record: TenantIdentificationAuditRecord): Promise<void> {
    await this.audit.log(record.entry)
  }

  async recordDenial(
    input: TenantIdentificationAuditInput,
  ): Promise<TenantIdentificationAuditRecord> {
    const record = this.buildDenial(input)
    await this.record(record)
    return record
  }

  async recordDegraded(
    input: TenantIdentificationAuditInput,
  ): Promise<TenantIdentificationAuditRecord> {
    const record = this.buildDegraded(input)
    await this.record(record)
    return record
  }

  async recordStale(
    input: TenantIdentificationAuditInput,
  ): Promise<TenantIdentificationAuditRecord> {
    const record = this.buildStale(input)
    await this.record(record)
    return record
  }

  async recordSwitch(input: TenantSwitchAuditInput): Promise<TenantIdentificationAuditRecord> {
    const record = this.buildSwitch(input)
    await this.record(record)
    return record
  }

  async recordAmbiguous(
    input: TenantIdentificationAuditInput,
  ): Promise<TenantIdentificationAuditRecord> {
    const record = this.buildAmbiguous(input)
    await this.record(record)
    return record
  }

  async recordGlobalMode(
    input: TenantIdentificationAuditInput,
  ): Promise<TenantIdentificationAuditRecord> {
    const record = this.buildGlobalMode(input)
    await this.record(record)
    return record
  }

  private build(
    kind: TenantIdentificationAuditKind,
    input: TenantIdentificationAuditInput,
    extra: Record<string, unknown> = {},
  ): TenantIdentificationAuditRecord {
    const metadata: TenantIdentificationAuditMetadata = {
      actorRef: input.actorRef,
      scopeHash: input.scopeHash,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      scopeMode: input.scopeMode,
      selectionSource: input.selectionSource,
      resolutionReason: input.resolutionReason,
      operation: input.operation,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey ?? null,
      timestamp: new Date().toISOString(),
    }

    const payload: Record<string, unknown> = { ...metadata, ...extra, kind }
    // 兜底扫描：即便未来有人加了自由字段，也不让 secret/prompt/路径类键落库。
    if (hasTenantIdForbiddenKeys(payload)) {
      throw new Error('租户识别审计元数据包含禁止字段，拒绝落库')
    }

    return {
      kind,
      metadata,
      entry: {
        event: KIND_TO_EVENT[kind],
        severity: KIND_TO_SEVERITY[kind],
        userId: input.userId ?? null,
        // organizationId 可能为 null（未解析出租户时的拒绝/降级）。
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        requestId: input.requestId,
        metadata: payload,
      },
    }
  }
}
