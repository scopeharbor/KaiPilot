// @aiproj/backend — TenantIsolationAuditService（v3-multitenant-isolation-architecture §7.1）。
//
// spec「Isolation audit and observation MUST be low-sensitive and actionable」要求
// 对六类隔离事件写低敏审计：
//   1. 租户 scope 拒绝（denial）
//   2. 快照失效阻断（stale scope block）
//   3. 显式全局访问（super admin 自审计）
//   4. registry 违规（未登记 / unsupported 资源被访问）
//   5. 降级状态（adapter/cache 不可用或 degraded 资源）
//   6. 跨租户重放（缓存键 / 预览签名 / 导出句柄 / 幂等键）
//
// **低敏保证靠"封闭字段集"，不靠事后过滤**：
// 本 service 不接受任意 `metadata`，只接受枚举、ID、hash、code 这几类入参，
// 输出字段集固定（`buildMultitenantAuditMetadata` 的 11 键 + 至多 3 个 code 字段）。
// 调用方**没有**把 prompt / model output / provider payload / 文件内容 / 绝对路径
// / 隐藏资源名 / 隐藏计数塞进来的通道——这是 §7.2 冗余测试的前提。
//
// 另外两条不变量：
// - `organizationId` 永远是 **actor 自己的组织**；被拒绝目标所属的组织（tenant origin）
//   本身就是隐藏信息，绝不写入。
// - 被拒绝目标的 `entityId` 一律为 null；只写 `entityType`（registry 的
//   `auditResourceType`，是**类型名**而非实例名）。
//
// 写入语义沿用 `AuditService.log`：失败只记日志、不阻塞主请求（`strict` 时才抛）。

import AuditService, {
  AuditEvent,
  type AuditEntry,
  type AuditEventType,
} from '#services/audit_service'
import {
  buildMultitenantAuditMetadata,
  type MultitenantAuditMetadata,
  type MultitenantDecision,
  type MultitenantOperationType,
  type MultitenantReasonCode,
  type MultitenantRegistryStatus,
  type MultitenantResourceType,
  type MultitenantWarningCode,
} from '@aiproj/types/multitenant-isolation-architecture'
import TenantScopeRegistry from './tenant_scope_registry.js'

/** 六类隔离审计事件的语义键（对外稳定，映射到 AuditEvent）。 */
export const TENANT_ISOLATION_AUDIT_KINDS = [
  'denial',
  'stale_scope',
  'global_access',
  'registry_violation',
  'degraded',
  'replay',
] as const
export type TenantIsolationAuditKind = (typeof TENANT_ISOLATION_AUDIT_KINDS)[number]

const KIND_TO_EVENT: Record<TenantIsolationAuditKind, AuditEventType> = {
  denial: AuditEvent.TENANT_SCOPE_DENIED,
  stale_scope: AuditEvent.TENANT_STALE_SCOPE_BLOCKED,
  global_access: AuditEvent.TENANT_GLOBAL_ACCESS,
  registry_violation: AuditEvent.TENANT_REGISTRY_VIOLATION,
  degraded: AuditEvent.TENANT_DEGRADED_MODE,
  replay: AuditEvent.TENANT_REPLAY_BLOCKED,
}

/** 六类事件的判定结果与严重级（固定，不由调用方指定，避免把拒绝写成 info）。 */
const KIND_TO_DECISION: Record<TenantIsolationAuditKind, MultitenantDecision> = {
  denial: 'deny',
  stale_scope: 'deny',
  global_access: 'allow',
  registry_violation: 'deny',
  degraded: 'degrade',
  replay: 'deny',
}

const KIND_TO_SEVERITY: Record<TenantIsolationAuditKind, AuditEntry['severity']> = {
  denial: 'warning',
  stale_scope: 'warning',
  global_access: 'warning',
  registry_violation: 'error',
  degraded: 'info',
  replay: 'error',
}

/**
 * 低敏入参：全部是枚举 / 数值 ID / hash / code / requestId。
 * 刻意**不提供** `metadata`、`message`、`payload`、`targetName` 等自由字段。
 */
export interface TenantIsolationAuditInput {
  /** actor 引用（如 `user:7`）；不是用户名/邮箱。 */
  actorRef: string
  /** 落 `audit_logs.user_id`，仅供本组织内追责。 */
  userId?: number | null
  /** actor 自己的组织；隐藏目标的组织归属绝不写入。 */
  organizationId: number
  projectId?: number | null
  resourceType: MultitenantResourceType
  operationType: MultitenantOperationType
  reasonCode: MultitenantReasonCode
  requestId: string
  idempotencyKey?: string | null
}

/** 降级事件额外携带的 warning code（枚举）。 */
export interface TenantDegradedAuditInput extends TenantIsolationAuditInput {
  warningCode: MultitenantWarningCode
  registryStatus?: MultitenantRegistryStatus | null
}

/** 全局访问事件额外携带的显式全局声明。 */
export interface TenantGlobalAccessAuditInput extends TenantIsolationAuditInput {
  /** 声明的全局 scope 模式；只有 registry 许可的资源才应走到这里。 */
  declaredScopeMode: 'global'
}

/** 重放事件额外携带被拒绝的派生值种类（不含派生值本身）。 */
export interface TenantReplayAuditInput extends TenantIsolationAuditInput {
  /** 被重放的派生值种类：缓存键 / 预览签名 / 导出句柄 / 幂等键。 */
  derivedKind: 'cache_key' | 'preview_signature' | 'export_handle' | 'idempotency_key'
}

/** 构造结果：低敏审计元数据 + 可直接落库的 AuditEntry。 */
export interface TenantIsolationAuditRecord {
  kind: TenantIsolationAuditKind
  metadata: MultitenantAuditMetadata
  entry: AuditEntry
}

/**
 * registry 依赖的最小形状（与 `AuditService` 同样走构造注入）。
 *
 * 存在注入缝的实际原因：当前 registry 中**零个**资源声明
 * `allowSuperAdminGlobal: true`（默认拒绝是对的），因此
 * `global_access` 分支经真实 registry 不可达。等到某个资源真的 opt-in，
 * 生产路径自然走通，注入缝也让"已开放时记什么"能被提前钉住。
 */
export interface TenantScopeRegistryLike {
  assertGlobalAllowed(resourceType: MultitenantResourceType): void
  statusOf(resourceType: MultitenantResourceType): MultitenantRegistryStatus
  get(resourceType: MultitenantResourceType): { auditResourceType: string }
}

export default class TenantIsolationAuditService {
  constructor(
    private readonly audit: AuditService = new AuditService(),
    private readonly registry: TenantScopeRegistryLike = TenantScopeRegistry,
  ) {}

  /** 租户 scope 拒绝（跨租读/写/预览/确认/缓存/作业被拒）。 */
  buildDenial(input: TenantIsolationAuditInput): TenantIsolationAuditRecord {
    return this.build('denial', input)
  }

  /** 快照失效阻断（membership / roleVersion / 归属变化导致的 stale scope）。 */
  buildStaleScopeBlock(input: TenantIsolationAuditInput): TenantIsolationAuditRecord {
    return this.build('stale_scope', input)
  }

  /**
   * 显式全局访问自审计（super admin 低敏全局操作）。
   *
   * 这里对 registry 做**二次确认**：资源未被许可全局时，事件降格为 registry 违规，
   * 避免"未许可的全局访问"被记成一次正常放行。
   */
  buildGlobalAccess(input: TenantGlobalAccessAuditInput): TenantIsolationAuditRecord {
    try {
      this.registry.assertGlobalAllowed(input.resourceType)
    } catch {
      return this.build('registry_violation', { ...input, reasonCode: 'GLOBAL_NOT_ALLOWED' })
    }
    return this.build('global_access', input, { declaredScopeMode: input.declaredScopeMode })
  }

  /** registry 违规（资源未登记 / unsupported / 越过全局例外声明）。 */
  buildRegistryViolation(input: TenantIsolationAuditInput): TenantIsolationAuditRecord {
    return this.build('registry_violation', input, {
      registryStatus: this.statusOf(input.resourceType),
    })
  }

  /** 降级状态（cache/adapter 不可用、degraded 资源仍需保持隔离）。 */
  buildDegradedState(input: TenantDegradedAuditInput): TenantIsolationAuditRecord {
    return this.build('degraded', input, {
      warningCode: input.warningCode,
      registryStatus: input.registryStatus ?? this.statusOf(input.resourceType),
    })
  }

  /** 跨租户重放尝试（缓存键 / 预览签名 / 导出句柄 / 幂等键在他组织被复用）。 */
  buildReplayAttempt(input: TenantReplayAuditInput): TenantIsolationAuditRecord {
    return this.build('replay', input, { derivedKind: input.derivedKind })
  }

  /**
   * 落库。沿用 `AuditService.log` 的非阻塞语义：写失败只记日志。
   * 测试可 `await` 以断言行数。
   */
  async record(record: TenantIsolationAuditRecord): Promise<void> {
    await this.audit.log(record.entry)
  }

  /** 构造 + 落库的便捷组合。 */
  async recordDenial(input: TenantIsolationAuditInput): Promise<TenantIsolationAuditRecord> {
    const record = this.buildDenial(input)
    await this.record(record)
    return record
  }

  private build(
    kind: TenantIsolationAuditKind,
    input: TenantIsolationAuditInput,
    /** 仅允许枚举型附加字段；无自由文本通道。 */
    extra: Readonly<Record<string, string>> = {},
  ): TenantIsolationAuditRecord {
    const metadata = buildMultitenantAuditMetadata({
      actorRef: input.actorRef,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      resourceType: input.resourceType,
      operationType: input.operationType,
      reasonCode: input.reasonCode,
      decision: KIND_TO_DECISION[kind],
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey ?? null,
    })

    const entry: AuditEntry = {
      event: KIND_TO_EVENT[kind],
      severity: KIND_TO_SEVERITY[kind],
      userId: input.userId ?? null,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      // 类型名（registry 的 auditResourceType），不是实例名。
      entityType: this.auditResourceType(input.resourceType),
      // 隐藏目标的 ID 不落审计——它本身就是"存在性"信息。
      entityId: null,
      requestId: input.requestId,
      changes: null,
      metadata: { ...metadata, ...extra },
    }

    return { kind, metadata, entry }
  }

  /** 未登记资源退回 resourceType 字面量，仍是类型名，不泄露实例信息。 */
  private auditResourceType(resourceType: MultitenantResourceType): string {
    try {
      return this.registry.get(resourceType).auditResourceType
    } catch {
      return resourceType
    }
  }

  /**
   * 未登记资源视为 `unsupported`。
   * registry 违规事件本来就可能因"资源根本没登记"而触发，
   * 这里不能让 `statusOf` 的抛错把审计写入本身打断。
   */
  private statusOf(resourceType: MultitenantResourceType): MultitenantRegistryStatus {
    try {
      return this.registry.statusOf(resourceType)
    } catch {
      return 'unsupported'
    }
  }
}
