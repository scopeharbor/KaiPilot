/**
 * v3-triz-to-delivery-closed-loop —— closed delivery adapter contract & registry
 * （task 5.1）。
 *
 * 闭集：task/milestone 为 required delivery；risk/change_request 仅 context/evidence，
 * 不参与“全部交付完成”判定。adapter 必须：
 * - 显式按 organization + project + entityId 批量查询（禁止逐 ref 单查/N+1）；
 * - 返回标准化 posture（六态闭集）与低敏摘要；
 * - 对 deleted/cross-project/error 使用 fail-closed 的 unavailableReason；
 * - 支持显式 hiddenIds 注入（无权限实体不产生标题/计数痕迹）。
 */
import type { TrizDlAuthorizedEntitySummary, TrizDlEntityKind } from '@aiproj/types'
import {
  TRIZ_DL_CONTEXT_KINDS,
  TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS,
  TRIZ_DL_REQUIRED_DELIVERY_KINDS,
} from '@aiproj/types'

export interface TrizDlPortFetchContext {
  organizationId: number
  projectId: number
  /** 无权限实体 id 集：返回条目必须为 unavailable(forbidden) 且 title=null */
  hiddenEntityIds?: ReadonlySet<string>
}

export type TrizDlPortEntry = TrizDlAuthorizedEntitySummary

export interface TrizDlClosedDeliveryPort {
  readonly kind: Extract<
    TrizDlEntityKind,
    (typeof TRIZ_DL_REQUIRED_DELIVERY_KINDS)[number] | (typeof TRIZ_DL_CONTEXT_KINDS)[number]
  >
  /** 批量读取；ids 数量由 read model 保证有界，port 自身仍须防御性 slice。 */
  fetchSummaries(
    entityIds: readonly string[],
    ctx: TrizDlPortFetchContext,
  ): Promise<Map<string, TrizDlPortEntry>>
}

export class TrizDlAdapterRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrizDlAdapterRegistryError'
  }
}

/** 单次批量预算上限。 */
export const TRIZ_DL_PORT_BATCH_BUDGETS = {
  [TRIZ_DL_REQUIRED_DELIVERY_KINDS[0]]: TRIZ_DL_MAX_REQUIRED_DELIVERY_REFS,
} as const

export function isRequiredDeliveryKind(kind: TrizDlEntityKind): boolean {
  return (TRIZ_DL_REQUIRED_DELIVERY_KINDS as readonly string[]).includes(kind)
}

export function isContextKind(kind: TrizDlEntityKind): boolean {
  return (TRIZ_DL_CONTEXT_KINDS as readonly string[]).includes(kind)
}

/** 闭集 registry：重复注册与未知 kind 一律拒绝（fail closed）。 */
export class TrizDlClosedAdapterRegistry {
  private readonly ports = new Map<TrizDlEntityKind, TrizDlClosedDeliveryPort>()

  register(port: TrizDlClosedDeliveryPort): this {
    if (this.ports.has(port.kind)) {
      throw new TrizDlAdapterRegistryError(`重复注册 kind: ${port.kind}`)
    }
    if (!isRequiredDeliveryKind(port.kind) && !isContextKind(port.kind)) {
      throw new TrizDlAdapterRegistryError(`未知 kind: ${String(port.kind)}`)
    }
    this.ports.set(port.kind, port)
    return this
  }

  get(kind: TrizDlEntityKind): TrizDlClosedDeliveryPort | null {
    return this.ports.get(kind) ?? null
  }

  require(kind: TrizDlEntityKind): TrizDlClosedDeliveryPort {
    const p = this.ports.get(kind)
    if (!p) throw new TrizDlAdapterRegistryError(`未注册的 delivery kind: ${kind}`)
    return p
  }

  registeredKinds(): TrizDlEntityKind[] {
    return [...this.ports.keys()].sort()
  }
}
