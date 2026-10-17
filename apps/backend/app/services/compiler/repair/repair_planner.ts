/**
 * @aiproj/backend —— Repair Planner（tasks 2.5）。
 *
 * 基于 issue、Ledger state、Manifest entity registry 和 policy profile 生成 Repair Plan。
 *
 * @aiproj/backend
 */

import type { RepairBudget, RepairIssue, RepairPlan, RepairPlanItem } from '@aiproj/compiler-spec'
import { DEFAULT_REPAIR_BUDGET } from '@aiproj/compiler-spec'
import { RepairBudgetGuard } from './repair_budget_guard.js'
import type { BudgetState } from './repair_budget_guard.js'

export interface ManifestEntityState {
  entityId: string
  status: 'committed_to_pdm' | 'failed_retryable' | 'needs_human_review' | 'in_progress' | 'pending'
  attemptCount: number
}

export interface PlannerContext {
  compilerRunId: number
  stageId: string
  policyProfile?: string
  budget?: Partial<RepairBudget>
  manifestEntities: ManifestEntityState[]
  initialState?: Partial<BudgetState>
}

/** Plan item factory. */
function planItem(
  itemId: string,
  issueId: string,
  strategy: RepairPlanItem['strategy'],
  entityIds: string[],
  stageId: string,
  opts?: { priority?: number; executable?: boolean; blockedReason?: string },
): RepairPlanItem {
  return {
    itemId,
    issueId,
    strategy,
    entityIds,
    stageId,
    priority: opts?.priority ?? 0,
    executable: opts?.executable ?? true,
    blockedReason: opts?.blockedReason,
  }
}

export class RepairPlanner {
  /**
   * 生成 Repair Plan。
   */
  plan(issues: RepairIssue[], context: PlannerContext): RepairPlan {
    const budget: RepairBudget = { ...DEFAULT_REPAIR_BUDGET, ...context.budget }
    const budgetGuard = new RepairBudgetGuard(budget, context.initialState)
    const items: RepairPlanItem[] = []
    const blockedItems: RepairPlan['blockedItems'] = []
    const now = new Date().toISOString()

    // 建立 entity -> status 查找表
    const entityStatusMap = new Map<string, ManifestEntityState>()
    for (const entity of context.manifestEntities) {
      entityStatusMap.set(entity.entityId, entity)
    }

    // 按优先级排序：blocking > warning > info
    const sortedIssues = [...issues].sort((a, b) => {
      const sevOrder: Record<string, number> = { blocking: 0, warning: 1, info: 2 }
      return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
    })

    for (const issue of sortedIssues) {
      const planItemId = `pi-${issue.issueId}`

      // 6.3: 只处理 Manifest 登记实体
      for (const entityId of issue.entityIds) {
        if (!entityStatusMap.has(entityId)) {
          blockedItems.push({
            itemId: `${planItemId}-unenrolled`,
            issueId: issue.issueId,
            reason: 'skipped_by_policy',
            description: `Entity ${entityId} not in Manifest registry`,
          })
          continue
        }
      }

      // 6.4: 已完成实体禁止重新生成
      const hasCommittedEntity = issue.entityIds.some(
        (eid) => entityStatusMap.get(eid)?.status === 'committed_to_pdm',
      )
      if (hasCommittedEntity) {
        blockedItems.push({
          itemId: `${planItemId}-committed`,
          issueId: issue.issueId,
          reason: 'skipped_by_policy',
          description: 'Entity already committed to PDM, skipping LLM regeneration',
        })
        continue
      }

      // 2.3: Soft advisory -> advisory item (not auto-fix)
      if (issue.source === 'soft_evaluator') {
        items.push(
          planItem(planItemId, issue.issueId, 'human_review', issue.entityIds, issue.stageId, {
            priority: 2,
          }),
        )
        continue
      }

      // 不可修复
      if (issue.repairability === 'not_repairable') {
        blockedItems.push({
          itemId: planItemId,
          issueId: issue.issueId,
          reason: 'not_repairable',
          description: issue.description,
        })
        continue
      }

      // 6.5: needs_human_review -> blocking review item
      if (issue.repairability === 'human_review_required') {
        items.push(
          planItem(planItemId, issue.issueId, 'human_review', issue.entityIds, issue.stageId, {
            priority: 0,
            executable: false,
            blockedReason: 'requires_human_review',
          }),
        )
        continue
      }

      // budget guard check
      const check = budgetGuard.canAttempt(planItemId)
      if (!check.allowed) {
        blockedItems.push({
          itemId: planItemId,
          issueId: issue.issueId,
          reason: (check.reason as any) ?? 'budget_exhausted',
          description: issue.description,
        })
        continue
      }

      // 可修复 -> executable plan item
      items.push(
        planItem(
          planItemId,
          issue.issueId,
          issue.suggestedStrategy ?? 'deterministic_auto_fix',
          issue.entityIds,
          issue.stageId,
          {
            priority: issue.severity === 'blocking' ? 0 : 1,
          },
        ),
      )
    }

    return {
      planId: `rp-${context.compilerRunId}-${context.stageId}-${now}`,
      compilerRunId: context.compilerRunId,
      policyProfile: context.policyProfile ?? 'default',
      cascadeDepth: 0,
      budget,
      items,
      blockedItems,
      evidenceRefs: [],
      createdAt: now,
    }
  }
}
