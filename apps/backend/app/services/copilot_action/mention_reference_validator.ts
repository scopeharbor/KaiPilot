/**
 * v3-copilot-mentions-and-slash-commands —— 服务端提及引用复核（任务 5.5）。
 *
 * 纯函数层：对客户端提交的 MentionReference[] 进行独立权限与组织隔离校验。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线（spec Requirement 9）：
 * - 客户端过滤仅是展示层，后端必须独立复核每个引用；
 * - 伪造引用必须被拒绝且不泄露信息；
 * - 提及不得扩大上下文层的来源合格范围。
 */

import type { MentionReference } from '@aiproj/types'
import { isMentionReference, pruneOrphanMentionRefs } from '@aiproj/types'

// ===========================================================================
// 校验结果类型
// ===========================================================================

/**
 * 单个提及引用的校验结果。
 */
export interface MentionRefCheck {
  /** 引用是否通过校验。 */
  readonly granted: boolean
  /** 引用下标（用于批量定位）。 */
  readonly index: number
  /** 失败原因（仅用于审计，不得回显到前端）。 */
  readonly reason?: string
}

/**
 * 批量提及引用校验结果。
 */
export interface MentionRefValidationResult {
  /** 是否全部通过。 */
  readonly allGranted: boolean
  /** 各引用的校验结果。 */
  readonly checks: readonly MentionRefCheck[]
  /** 被拒绝的引用数。 */
  readonly rejectedCount: number
}

// ===========================================================================
// 校验纯函数
// ===========================================================================

/**
 * 验证单个提及引用：组织归属 + 格式合法性。
 *
 * @param ref 待验证的提及引用
 * @param actorOrganizationId 当前用户的组织 ID
 * @returns 校验结果
 */
export function validateSingleMentionRef(
  ref: unknown,
  actorOrganizationId: number,
): MentionRefCheck {
  // 1. 格式合法性
  if (!isMentionReference(ref)) {
    return { granted: false, index: -1, reason: 'invalid-reference-format' }
  }

  // 2. 组织隔离：引用的组织归属必须与 actor 一致
  if (ref.organizationId !== actorOrganizationId) {
    return {
      granted: false,
      index: -1,
      reason: 'organization-mismatch',
    }
  }

  return { granted: true, index: -1 }
}

/**
 * 批量验证提及引用：对每个引用进行组织隔离与格式校验。
 *
 * 后续扩展可接入实际的权限查询（如 task:read、project:read），
 * 但当前阶段先做格式与组织隔离的确定性校验。
 *
 * @param refs 客户端提交的引用列表
 * @param actorOrganizationId 当前用户的组织 ID
 * @returns 批量校验结果
 */
export function validateMentionRefs(
  refs: readonly unknown[],
  actorOrganizationId: number,
): MentionRefValidationResult {
  const checks: MentionRefCheck[] = refs.map((ref, i) => {
    const result = validateSingleMentionRef(ref, actorOrganizationId)
    return { ...result, index: i }
  })

  const rejectedCount = checks.filter((c) => !c.granted).length

  return {
    allGranted: rejectedCount === 0,
    checks,
    rejectedCount,
  }
}

/**
 * 清除孤儿引用：移除在提交文本中没有对应文本的引用。
 *
 * 用于提交前的最后一道防线——即使前端未能正确同步删除，
 * 后端也不会处理无文本对应的孤儿引用。
 *
 * @param text 提交的文本内容
 * @param refs 提及引用列表
 * @returns 清理后的引用列表
 */
export function pruneOrphanRefs(
  text: string,
  refs: readonly MentionReference[],
): MentionReference[] {
  // 委派共享实现：前端提交前清理与服务端复核前清理必须同语义，
  // 各写一份会让「已清 / 仍算孤儿」两侧判断分叉。
  return [...pruneOrphanMentionRefs(text, refs)]
}

/**
 * 检查引用是否扩大了上下文层的来源合格范围。
 *
 * spec Requirement 9 Scenario 2: 上下文装配仍须独立应用其作用域与权限过滤，
 * 不得将提及视为授权。
 *
 * @returns 始终返回 false——提及不提供额外的上下文合格性
 */
export function doesMentionWidenContextEligibility(): boolean {
  return false
}

// ===========================================================================
// 逐实体权限复核（v3-copilot-live-submission-channel 任务 3.1–3.11）
// ===========================================================================

/**
 * 逐实体权限判定接口（注入式）。
 *
 * 按实体类型**批量**判定，避免逐条查询退化为 N+1（design D3）。
 * 返回获准的 entityId 集合；未出现在集合中的 ID 视为不获准。
 *
 * 实现方负责组织隔离范围内的读权限判定；本模块不假设任何域模型。
 */
export type MentionEntityPermissionChecker = (params: {
  readonly organizationId: number
  readonly actorId: number
  readonly entityType: MentionReference['entityType']
  readonly entityIds: readonly number[]
}) => Promise<ReadonlySet<number>>

/**
 * 权限判定不可用。
 *
 * spec REQ：权限复核是**业务决策**而非观察，判定不可用必须阻断回合，
 * 不得把未决引用当作获准（与观察层降级纪律相对）。
 */
export class MentionPermissionUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('提及引用权限判定不可用')
    this.name = 'MentionPermissionUnavailableError'
    this.cause = cause
  }
}

/**
 * 复核结果。
 *
 * **只返回获准引用与被拒计数**——不返回被拒实体的类型、ID、名称或原因明细，
 * 否则可用拒绝原因反推实体存在（spec REQ 非泄露）。
 */
export interface MentionReviewResult {
  readonly granted: readonly MentionReference[]
  readonly rejectedCount: number
}

/**
 * 服务端引用复核主入口。
 *
 * 顺序：
 * 1. 格式与组织隔离（既有 `validateMentionRefs` 纯判定）
 * 2. 孤儿清理（文本中已无对应标签的引用剔除，与前端语义一致）
 * 3. 按实体类型批量逐实体权限判定
 *
 * 任一阶段被拒的引用一律**缺席**，只累加计数。
 */
export async function reviewMentionRefs(params: {
  readonly refs: readonly unknown[]
  readonly text: string
  readonly actorOrganizationId: number
  readonly actorId: number
  readonly permissionChecker: MentionEntityPermissionChecker
}): Promise<MentionReviewResult> {
  const { refs, text, actorOrganizationId, actorId, permissionChecker } = params

  // 1. 格式与组织隔离
  const shapeResult = validateMentionRefs(refs, actorOrganizationId)
  const shapeGranted: MentionReference[] = []
  for (const check of shapeResult.checks) {
    if (check.granted) shapeGranted.push(refs[check.index] as MentionReference)
  }
  let rejectedCount = shapeResult.rejectedCount

  // 2. 孤儿清理
  const afterOrphan = pruneOrphanRefs(text, shapeGranted)
  rejectedCount += shapeGranted.length - afterOrphan.length
  if (afterOrphan.length === 0) return { granted: [], rejectedCount }

  // 3. 按实体类型批量判权
  const byType = new Map<MentionReference['entityType'], number[]>()
  for (const ref of afterOrphan) {
    const bucket = byType.get(ref.entityType)
    if (bucket) bucket.push(ref.entityId)
    else byType.set(ref.entityType, [ref.entityId])
  }

  const grantedIdsByType = new Map<MentionReference['entityType'], ReadonlySet<number>>()
  for (const [entityType, entityIds] of byType) {
    try {
      const grantedIds = await permissionChecker({
        organizationId: actorOrganizationId,
        actorId,
        entityType,
        entityIds,
      })
      grantedIdsByType.set(entityType, grantedIds)
    } catch (error) {
      // 判定不可用：阻断，不默认放行
      throw new MentionPermissionUnavailableError(error)
    }
  }

  const granted: MentionReference[] = []
  for (const ref of afterOrphan) {
    if (grantedIdsByType.get(ref.entityType)?.has(ref.entityId)) granted.push(ref)
    else rejectedCount += 1
  }

  return { granted, rejectedCount }
}
