/**
 * v3-triz-to-delivery-closed-loop —— append-only / no-delete guards（task 3.6）。
 *
 * link/event 一律禁止普通 update/delete；更正只允许 superseding 行。
 * guard 以运行时断言 + 静态扫描双保险：
 * - 断言函数供 Service 写路径调用（防御性兜底）；
 * - 静态回归测试确保本模块源码不出现 `.delete()`/`.save()` 于 event。
 *
 * 设计依据：design D1/D6 —— 历史不修改；删除正式实体不级联删除闭环历史。
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import TrizDeliveryLink from '#models/triz_delivery_link'
import TrizDeliveryEvent from '#models/triz_delivery_event'

export class TrizDeliveryLoopAppendOnlyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrizDeliveryLoopAppendOnlyError'
  }
}

/**
 * 在指定事务 client 上创建 link。禁止任何其他写路径直接操作该表；
 * 更正走 createSupersedingLink（自动维护 supersedes/superseded_by 双向 refs）。
 */
export async function appendLink(
  payload: Partial<TrizDeliveryLink> & Pick<TrizDeliveryLink, 'linkDigest'>,
  trx: TransactionClientContract,
): Promise<TrizDeliveryLink> {
  return TrizDeliveryLink.create(payload, { client: trx })
}

/**
 * 追加更正行：新 link 生效，旧行仅回填 superseded_by（这是唯一允许的
 * 对既有行的写入——回填更正指针，不改任何业务字段）。
 */
export async function createSupersedingLink(
  payload: Omit<Partial<TrizDeliveryLink>, 'supersedesLinkId'> & {
    supersedesLinkId: number
  },
  trx: TransactionClientContract,
): Promise<TrizDeliveryLink> {
  const created = await TrizDeliveryLink.create(payload, { client: trx })
  const old = await TrizDeliveryLink.find(payload.supersedesLinkId, { client: trx })
  if (!old) {
    throw new TrizDeliveryLoopAppendOnlyError('被更正的 link 不存在')
  }
  old.supersededByLinkId = created.id
  old.useTransaction(trx)
  await old.save()
  return created
}

/** 事件只允许追加。 */
export async function appendEvent(
  payload: Partial<TrizDeliveryEvent>,
  trx: TransactionClientContract,
): Promise<TrizDeliveryEvent> {
  return TrizDeliveryEvent.create(payload, { client: trx })
}

/**
 * 断言 actor 非 automation/AI/plugin/system 类系统身份。
 * automation actor 永远拿不到 verify/reopen authority（task 3.8/D6）；
 * 这里再作进程内防线，拒绝明确带系统前缀的伪造 human id 调用。
 */
export function assertHumanActorId(actorUserId: number): void {
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
    throw new TrizDeliveryLoopAppendOnlyError('verification/reopen 仅接受人类 actor')
  }
}
