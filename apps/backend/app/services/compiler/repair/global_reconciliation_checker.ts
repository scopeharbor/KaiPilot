/**
 * @aiproj/backend —— Global Reconciliation Checker（tasks 7.1–7.8）。
 *
 * 在关键 V-Gate 后或 Compiler run 结束前执行一次全局对账。
 * 只输出 finding、candidate patch ref 或 review item，禁止直接 mutate PDM。
 *
 * @aiproj/backend
 */

import type { ReconciliationReport, ReconciliationFinding } from '@aiproj/compiler-spec'

// ── PDM Snapshot Types ──

export interface ReconciliationPdmInput {
  tasks?: Record<
    string,
    {
      id: string
      name: string
      wbsNodeId?: string
      workPackageId?: string
      plannedStart?: string
      plannedEnd?: string
      duration?: number
      organizationId?: string
      projectId?: string
    }
  >
  milestones?: Record<string, { id: string; name: string; date: string; dependsOn?: string[] }>
  wbsNodes?: Record<
    string,
    { id: string; parentId?: string; projectId?: string; organizationId?: string; type: string }
  >
  resources?: Record<
    string,
    {
      id: string
      name: string
      allocations?: { taskId: string; hours: number }[]
      capacity?: number
    }
  >
  risks?: Record<
    string,
    { id: string; name: string; relatedTaskIds?: string[]; projectId?: string }
  >
  workPackages?: Record<string, { id: string; wbsNodeId: string; projectId: string }>
  computedSchedule?: Record<string, { taskId: string; plannedStart: string; plannedEnd: string }>
}

// ── PDM Computed Input ──

export interface PdmComputedInput {
  schedules?: Record<string, { plannedStart: string; plannedEnd: string }>
  completionStatus?: Record<string, string>
  validationSummaries?: Record<string, { status: string }>
}

// ── Rule Registry ──

export interface ReconciliationRule {
  ruleId: string
  name: string
  description: string
  check(input: ReconciliationPdmInput, computed?: PdmComputedInput): ReconciliationFinding[]
}

/** 创建 ReconciliationFinding 的 helper。 */
function finding(
  ruleId: string,
  severity: ReconciliationFinding['severity'],
  entityIds: string[],
  description: string,
  opts?: {
    affectedFields?: string[]
    requiresHumanReview?: boolean
    expected?: string
    actual?: string
    candidatePatchRef?: string
    createdAt?: string
  },
): ReconciliationFinding {
  return {
    findingId: `${ruleId.toLowerCase()}-${entityIds.join('-') || 'all'}-${opts?.createdAt ?? Date.now()}`,
    ruleId,
    severity,
    entityIds,
    affectedFields: opts?.affectedFields ?? [],
    description,
    requiresHumanReview: opts?.requiresHumanReview ?? false,
    expected: opts?.expected,
    actual: opts?.actual,
    candidatePatchRef: opts?.candidatePatchRef,
    createdAt: opts?.createdAt ?? new Date().toISOString(),
  }
}

// ── Checker ──

export class GlobalReconciliationChecker {
  readonly #rules: ReconciliationRule[]
  readonly #compilerRunId: number

  constructor(compilerRunId: number, rules?: ReconciliationRule[]) {
    this.#compilerRunId = compilerRunId
    this.#rules = rules ?? [
      new WbsTaskAlignmentRule(),
      new ScheduleMilestoneRule(),
      new ResourceLoadRule(),
      new RiskTaskRule(),
      new PdmLedgerStateRule(),
    ]
  }

  /**
   * 7.1: 执行全量对账。
   */
  check(input: ReconciliationPdmInput, computed?: PdmComputedInput): ReconciliationReport {
    const allFindings: ReconciliationFinding[] = []
    const now = new Date().toISOString()

    for (const rule of this.#rules) {
      try {
        const ruleFindings = rule.check(input, computed)
        allFindings.push(...ruleFindings)
      } catch {
        allFindings.push(
          finding(
            rule.ruleId,
            'warning',
            [],
            `Error executing reconciliation rule ${rule.ruleId}`,
            { createdAt: now },
          ),
        )
      }
    }

    const blockingCount = allFindings.filter((f) => f.severity === 'blocking').length
    const warningCount = allFindings.filter((f) => f.severity === 'warning').length
    const infoCount = allFindings.filter((f) => f.severity === 'info').length
    const candidatePatchFindings = allFindings.filter((f) => f.candidatePatchRef)

    return {
      reportId: `rc-${this.#compilerRunId}-${now}`,
      compilerRunId: this.#compilerRunId,
      scope: 'global',
      rulesetVersion: '2.0',
      summary: {
        totalFindings: allFindings.length,
        blockingCount,
        warningCount,
        infoCount,
        candidatePatches: candidatePatchFindings.length,
        reviewItems: allFindings.filter((f) => f.requiresHumanReview).length,
      },
      findings: allFindings,
      candidatePatchRefs: candidatePatchFindings.map((f) => f.candidatePatchRef!).filter(Boolean),
      blockingItems: allFindings.filter((f) => f.severity === 'blocking').map((f) => f.findingId),
      warnings: allFindings.filter((f) => f.severity === 'warning').map((f) => f.findingId),
      evidenceRefs: [],
      generatedAt: now,
    }
  }
}

// ============================================================================
// 7.2: WBS / Task 归属对账
// ============================================================================

class WbsTaskAlignmentRule implements ReconciliationRule {
  readonly ruleId = 'RC-WBS-01'
  readonly name = 'WBS/Task Alignment'
  readonly description = 'Check that tasks have valid WBS/work package parent'

  check(input: ReconciliationPdmInput): ReconciliationFinding[] {
    const findings: ReconciliationFinding[] = []
    const now = new Date().toISOString()

    if (!input.tasks || !input.wbsNodes) return findings

    for (const [taskId, task] of Object.entries(input.tasks)) {
      if (!task.workPackageId && !task.wbsNodeId) {
        findings.push(
          finding(
            this.ruleId,
            'warning',
            [taskId],
            `Task "${task.name}" (${taskId}) has no WBS/work package parent`,
            { affectedFields: ['workPackageId', 'wbsNodeId'], createdAt: now },
          ),
        )
      }

      if (task.wbsNodeId && input.wbsNodes && !input.wbsNodes[task.wbsNodeId]) {
        findings.push(
          finding(
            this.ruleId,
            'blocking',
            [taskId, task.wbsNodeId],
            `Task "${task.name}" references non-existent WBS node "${task.wbsNodeId}"`,
            { affectedFields: ['wbsNodeId'], createdAt: now },
          ),
        )
      }

      if (task.projectId && task.organizationId) {
        findings.push(
          finding(
            this.ruleId,
            'info',
            [taskId],
            `Task "${task.name}" org check (project: ${task.projectId})`,
            { createdAt: now },
          ),
        )
      }
    }

    return findings
  }
}

// ============================================================================
// 7.3: Schedule / Milestone 对账
// ============================================================================

class ScheduleMilestoneRule implements ReconciliationRule {
  readonly ruleId = 'RC-SCH-01'
  readonly name = 'Schedule/Milestone Alignment'
  readonly description = 'Check milestone dates against task schedules'

  check(input: ReconciliationPdmInput, computed?: PdmComputedInput): ReconciliationFinding[] {
    const findings: ReconciliationFinding[] = []
    const now = new Date().toISOString()

    if (!input.milestones) return findings

    for (const [msId, ms] of Object.entries(input.milestones)) {
      if (ms.dependsOn && input.tasks) {
        for (const depTaskId of ms.dependsOn) {
          const depTask = input.tasks[depTaskId]
          if (depTask && depTask.plannedEnd) {
            if (ms.date < depTask.plannedEnd) {
              findings.push(
                finding(
                  this.ruleId,
                  'blocking',
                  [msId, depTaskId],
                  `Milestone "${ms.name}" date (${ms.date}) is before dependency task "${depTask.name}" end (${depTask.plannedEnd})`,
                  {
                    affectedFields: ['date', 'plannedEnd'],
                    expected: depTask.plannedEnd,
                    actual: ms.date,
                    requiresHumanReview: true,
                    createdAt: now,
                  },
                ),
              )
            }
          }
        }
      }
    }

    if (computed?.schedules && input.tasks) {
      for (const [taskId, schedule] of Object.entries(computed.schedules)) {
        const task = input.tasks[taskId]
        if (task && task.plannedStart && task.plannedStart !== schedule.plannedStart) {
          findings.push(
            finding(
              this.ruleId,
              'warning',
              [taskId],
              `Task plannedStart (${task.plannedStart}) differs from computed schedule (${schedule.plannedStart})`,
              {
                affectedFields: ['plannedStart'],
                expected: schedule.plannedStart,
                actual: task.plannedStart,
                createdAt: now,
              },
            ),
          )
        }
      }
    }

    return findings
  }
}

// ============================================================================
// 7.4: Resource Load 对账
// ============================================================================

class ResourceLoadRule implements ReconciliationRule {
  readonly ruleId = 'RC-RES-01'
  readonly name = 'Resource Load Alignment'
  readonly description = 'Check resource allocation completeness and load'

  check(input: ReconciliationPdmInput): ReconciliationFinding[] {
    const findings: ReconciliationFinding[] = []
    const now = new Date().toISOString()

    if (!input.resources) return findings

    for (const [resId, res] of Object.entries(input.resources)) {
      if (!res.allocations || res.allocations.length === 0) {
        findings.push(
          finding(this.ruleId, 'info', [resId], `Resource "${res.name}" has no task allocations`, {
            affectedFields: ['allocations'],
            createdAt: now,
          }),
        )
      }

      if (res.allocations && res.capacity !== undefined) {
        const totalHours = res.allocations.reduce((sum, a) => sum + (a.hours ?? 0), 0)
        if (totalHours > res.capacity) {
          findings.push(
            finding(
              this.ruleId,
              'warning',
              [resId],
              `Resource "${res.name}" is overloaded: ${totalHours}h allocated vs ${res.capacity}h capacity`,
              {
                affectedFields: ['allocations', 'capacity'],
                expected: `${res.capacity}`,
                actual: `${totalHours}`,
                createdAt: now,
              },
            ),
          )
        }
      }
    }

    return findings
  }
}

// ============================================================================
// 7.5: Risk / Task 对账
// ============================================================================

class RiskTaskRule implements ReconciliationRule {
  readonly ruleId = 'RC-RSK-01'
  readonly name = 'Risk/Task Alignment'
  readonly description = 'Check risk references to tasks'

  check(input: ReconciliationPdmInput): ReconciliationFinding[] {
    const findings: ReconciliationFinding[] = []
    const now = new Date().toISOString()

    if (!input.risks) return findings

    for (const [riskId, risk] of Object.entries(input.risks)) {
      if (!risk.relatedTaskIds || risk.relatedTaskIds.length === 0) {
        findings.push(
          finding(
            this.ruleId,
            'warning',
            [riskId],
            `Risk "${risk.name}" has no related tasks — potentially orphaned`,
            { createdAt: now },
          ),
        )
        continue
      }

      for (const taskId of risk.relatedTaskIds) {
        if (!input.tasks || !input.tasks[taskId]) {
          findings.push(
            finding(
              this.ruleId,
              'blocking',
              [riskId, taskId],
              `Risk "${risk.name}" references non-existent task "${taskId}"`,
              { affectedFields: ['relatedTaskIds'], createdAt: now },
            ),
          )
        }
      }

      if (risk.projectId && input.tasks) {
        for (const taskId of risk.relatedTaskIds) {
          const task = input.tasks[taskId]
          if (task && task.projectId && task.projectId !== risk.projectId) {
            findings.push(
              finding(
                this.ruleId,
                'warning',
                [riskId, taskId],
                `Risk "${risk.name}" (project ${risk.projectId}) references task from different project`,
                { createdAt: now },
              ),
            )
          }
        }
      }
    }

    return findings
  }
}

// ============================================================================
// 7.6: PDM Computed / Validation / Ledger 对账
// ============================================================================

class PdmLedgerStateRule implements ReconciliationRule {
  readonly ruleId = 'RC-PDM-01'
  readonly name = 'PDM/Ledger State Alignment'
  readonly description = 'Check PDM computed, validation, and Ledger status consistency'

  check(_input: ReconciliationPdmInput, computed?: PdmComputedInput): ReconciliationFinding[] {
    const findings: ReconciliationFinding[] = []
    const now = new Date().toISOString()

    if (computed?.completionStatus) {
      for (const [entityId, status] of Object.entries(computed.completionStatus)) {
        if (status === 'outdated') {
          findings.push(
            finding(
              this.ruleId,
              'warning',
              [entityId],
              `PDM computed for entity "${entityId}" is outdated — needs recompute`,
              { createdAt: now },
            ),
          )
        }
      }
    }

    if (computed?.validationSummaries) {
      for (const [entityId, summary] of Object.entries(computed.validationSummaries)) {
        if (summary.status === 'failed' || summary.status === 'blocking') {
          findings.push(
            finding(
              this.ruleId,
              'blocking',
              [entityId],
              `Validation for entity "${entityId}" has blocking status: ${summary.status}`,
              { requiresHumanReview: true, createdAt: now },
            ),
          )
        }
      }
    }

    return findings
  }
}
