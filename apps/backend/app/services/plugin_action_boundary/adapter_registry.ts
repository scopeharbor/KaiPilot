/**
 * v3-plugin-action-preview-boundary —— host-owned action adapter registry（design.md D1）。
 *
 * 红线：
 * - registry 只接受宿主核心登记的 adapter（descriptor.owner === 'host-core'），
 *   插件自带 adapter 一律拒绝；
 * - 未登记 / 未知 kind 一律 fail-closed（adapter-missing）；
 * - descriptor 经共享契约 validateAdapterDescriptor 校验，任何 repository/model/SQL/
 *   事务/网络/代码声明都被拒绝（平行写通道企图）。
 */
import type {
  PluginActionAdapterDescriptor,
  PluginActionKind,
  PluginActionReasonCode,
} from '@aiproj/types'
import { validateAdapterDescriptor } from '@aiproj/types'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/** 边界统一错误：携带稳定 reason code，由 API 层映射 HTTP 状态与非泄露消息。 */
export class ActionBoundaryError extends Error {
  constructor(
    public readonly reasonCode: PluginActionReasonCode,
    message: string,
  ) {
    super(message)
    this.name = 'ActionBoundaryError'
  }
}

/** preview 草稿：adapter 只提供数据，digest/边界化由宿主组装。 */
export interface PluginActionPreviewDraft {
  readonly diffEntries: readonly {
    readonly targetRef: string
    readonly field: string
    readonly before: unknown
    readonly after: unknown
  }[]
  readonly assumptions: readonly string[]
  readonly compatibilitySummary: string | null
  /** blocking finding 存在时宿主必须标记 preview 不可确认。 */
  readonly dryRunFindings: readonly {
    readonly code: string
    readonly severity: 'blocking' | 'warning'
    readonly message: string
  }[]
  readonly reversibility: 'reversible' | 'partially_reversible' | 'irreversible'
  readonly affectedItemRefs: readonly string[]
  /** 当前目标 revision（adapter 语义；确认时重校验绑定）。 */
  readonly targetRevision: string
}

export interface PluginActionAdapterContext {
  readonly organizationId: number
  readonly projectId: number | null
  readonly actorUserId: number
  readonly inputPayload: Record<string, unknown>
  /**
   * 宿主事务客户端（可选）。confirm 阶段的 revalidate 在宿主事务内执行，
   * adapter 必须复用该连接（SQLite 单连接下另取全局池连接会自锁）。
   */
  readonly trx?: TransactionClientContract
}

/** 正式应用上下文：事务由宿主创建并传入，adapter 禁止自行建事务（design.md D4）。 */
export interface PluginActionApplyContext extends PluginActionAdapterContext {
  readonly trx: TransactionClientContract
  readonly proposalUid: string
  readonly targetRevision: string
}

/** 宿主核心 adapter 接口：preview / revalidate / apply 三件事，无其他能力。 */
export interface PluginActionHostAdapter {
  readonly descriptor: PluginActionAdapterDescriptor
  preview(ctx: PluginActionAdapterContext): Promise<PluginActionPreviewDraft>
  /** 确认时目标 revision 重校验：fresh=false 即 stale 阻断。 */
  revalidate(
    ctx: PluginActionAdapterContext & { readonly expectedRevision: string },
  ): Promise<{ fresh: boolean; currentRevision: string }>
  apply(ctx: PluginActionApplyContext): Promise<{ writtenRefs: readonly string[] }>
}

export class PluginActionAdapterRegistry {
  private adapters = new Map<PluginActionKind, PluginActionHostAdapter>()

  /**
   * 宿主登记 adapter。描述符非法（含插件自带归属/未知 kind）即抛错——登记面 fail-closed。
   */
  register(adapter: PluginActionHostAdapter): void {
    const check = validateAdapterDescriptor(adapter.descriptor)
    if (!check.valid) {
      const firstCode =
        check.findings.find((f) => f.code === 'action-kind-unknown')?.code ??
        check.findings.find((f) => f.code === 'adapter-not-host-owned')?.code
      throw new ActionBoundaryError(
        firstCode ?? 'adapter-descriptor-invalid',
        `adapter descriptor rejected: ${check.findings.map((f) => f.message).join('; ')}`,
      )
    }
    this.adapters.set(adapter.descriptor.actionKind, adapter)
  }

  has(kind: PluginActionKind): boolean {
    return this.adapters.has(kind)
  }

  get(kind: PluginActionKind): PluginActionHostAdapter | undefined {
    return this.adapters.get(kind)
  }

  /** 取 adapter；未登记即 fail-closed（不回退、不猜测）。 */
  require(kind: PluginActionKind): PluginActionHostAdapter {
    const adapter = this.adapters.get(kind)
    if (!adapter) {
      throw new ActionBoundaryError('adapter-missing', `no host adapter registered for ${kind}`)
    }
    return adapter
  }

  kinds(): readonly PluginActionKind[] {
    return [...this.adapters.keys()]
  }

  /** 测试辅助：清空注册表。 */
  reset(): void {
    this.adapters.clear()
  }
}

/** 进程级单例（宿主持有；插件不可达）。 */
export const pluginActionAdapterRegistry = new PluginActionAdapterRegistry()
