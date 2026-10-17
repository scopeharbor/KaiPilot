/**
 * ai-draft-generation / T037 —— 草案确认导入（design D6/D7，tasks 6.1~6.6 + 4.3/4.4）。
 *
 * 单事务内创建正式项目及关联 WBS/任务/依赖/里程碑/验收标准，失败整体回滚。
 * 确认前强制走 T038 校验契约（`draftValidationGateway`）：
 *   - blocking → 禁止确认（ValidationException）；
 *   - autoFixDiffs → 落新版本（origin='auto_fixed'）并要求重新确认，不导入；
 *   - warning 且未显式确认 → 拒绝，要求 acknowledgedWarnings=true。
 * 红线：本服务是唯一允许写正式业务表的草案链路入口，且仅在人工确认后触发。
 */

import { ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import WbsNode from '#models/wbs_node'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import Milestone from '#models/milestone'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import AiProjectDraftConfirmation from '#models/ai_project_draft_confirmation'
import RiskService from '#services/risk_service'
import { PROJECT_ROLE_TEMPLATES } from '#services/project_role_templates'
import { normalizeStatus } from '#services/task_status_machine'
import { applyGenerationQualityGate, draftValidationGateway } from './validation_gateway.ts'
import { validateSemanticGrounding } from './semantic_grounding_gate.ts'
import { applyModifications, filterDraftBySelection } from './import_selection.ts'
import { planTaskAssignees } from './member_assignment.ts'
import OrganizationMember from '#models/organization_member'
import { ProjectRoleName } from '#rbac'
import type { DraftSelectionDropCounts } from './import_selection.ts'
export { applyModifications } from './import_selection.ts'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import type {
  ConfirmProjectDraftRequest,
  DraftImportCounts,
  DraftValidationReport,
  ProjectDraft,
  ProjectDraftRiskHint,
  ProjectDraftWbsNode,
  RiskCategory,
} from '@aiproj/types'

export interface ImportActor {
  organizationId: number
  userId: number
  requestId?: string | null
}

export interface ImportDraftResult {
  projectId: number
  createdCounts: DraftImportCounts
  importedVersion: number
  validation: DraftValidationReport
  selectionSummary: Record<string, unknown>
}

/**
 * 任务描述 = 模型描述 + 可执行说明（为什么做 / 输入 / 产出 / 完成标准 / 步骤清单 / 验收人），
 * 导入后在任务详情里直接可读，步骤写成可勾选清单。
 */
function composeTaskDescription(task: ProjectDraft['tasks'][number]): string | null {
  const base = task.description.value?.trim() ?? ''
  const execution = task.execution
  if (!execution) return base || null
  const list = (items: string[], checkbox = false) =>
    items.map((item) => `${checkbox ? '- [ ] ' : '- '}${item}`).join('\n')
  const sections = [
    base,
    execution.purpose ? `**为什么做**：${execution.purpose}` : '',
    execution.inputs.length ? `**输入**：\n${list(execution.inputs)}` : '',
    execution.outputs.length ? `**产出**：\n${list(execution.outputs)}` : '',
    execution.doneCriteria.length ? `**完成标准**：\n${list(execution.doneCriteria)}` : '',
    execution.steps.length ? `**执行步骤**：\n${list(execution.steps, true)}` : '',
    execution.reviewerRole ? `**验收人**：${execution.reviewerRole}` : '',
  ].filter(Boolean)
  return sections.join('\n\n') || null
}

function toDate(value: string | null | undefined): DateTime | null {
  if (!value) return null
  const dt = DateTime.fromISO(value)
  return dt.isValid ? dt : null
}

@inject()
export default class ProjectDraftImportService {
  constructor(private riskService: RiskService) {}
  /**
   * 确认导入。前置：调用方已通过 `policy.canConfirm`（ai:confirm + project:create）。
   */
  async import(
    session: AiProjectDraft,
    request: ConfirmProjectDraftRequest,
    actor: ImportActor,
  ): Promise<ImportDraftResult> {
    if (session.projectId) {
      throw new ValidationException('该草案已确认导入，不能重复导入')
    }

    const active = await AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .orderBy('version', 'desc')
      .first()
    if (!active || !active.draft) {
      throw new ValidationException('草案尚无可确认的活动版本')
    }
    if (request.version !== active.version) {
      throw new ValidationException('草案版本已过期，请刷新后重新确认', {
        details: { expected: active.version, received: request.version },
      })
    }

    // —— 服务端重算：字段修改 → 部分过滤（design D6，禁止信任前端结果） ——
    const modified = applyModifications(active.draft, request.modifications)
    let effective: ProjectDraft = modified
    let dropped: DraftSelectionDropCounts | null = null
    if (request.mode === 'partial') {
      if (!request.selection) {
        throw new ValidationException('部分导入必须提供选择集')
      }
      const filtered = filterDraftBySelection(modified, request.selection)
      effective = filtered.draft
      dropped = filtered.dropped
    }
    const changed = (request.modifications?.length ?? 0) > 0 || request.mode === 'partial'

    // —— 确认前校验契约（tasks 4.3/4.4） ——
    const validationReport = draftValidationGateway.validate({
      draft: effective,
      phase: 'validating',
      selection: request.mode === 'partial' ? request.selection : null,
    })
    const selfCheckReport = draftValidationGateway.validate({
      draft: effective,
      phase: 'self_checking',
      selection: request.mode === 'partial' ? request.selection : null,
    })
    const structuralReport = this.withSelfCheckAdvisories(validationReport, selfCheckReport)
    const semanticIssues = active.meta?.groundingManifest
      ? validateSemanticGrounding(effective, active.meta.groundingManifest).blocking
      : []
    const report = active.meta
      ? applyGenerationQualityGate(structuralReport, {
          meta: active.meta,
          qualityIssues: semanticIssues,
        })
      : structuralReport
    if (report.blocking.length > 0) {
      throw new ValidationException('草案未通过校验，禁止确认导入', {
        details: { blocking: report.blocking },
      })
    }
    if (report.autoFixDiffs.length > 0) {
      // 自动修正差异只落草案版本，要求用户重新确认后才能导入（tasks 4.4）。
      const fixedDraft = applyModifications(
        effective,
        report.autoFixDiffs.map((d) => ({ path: d.path, value: d.after as never })),
      )
      const nextVersion = session.currentVersion + 1
      await AiProjectDraftVersion.query()
        .where('draft_id', session.id)
        .where('status', 'active')
        .update({ status: 'superseded' })
      await AiProjectDraftVersion.create({
        draftId: session.id,
        version: nextVersion,
        origin: 'auto_fixed',
        status: 'active',
        draft: fixedDraft,
        meta: active.meta,
        validation: report,
      })
      session.currentVersion = nextVersion
      session.status = 'reviewing'
      await session.save()
      throw new ValidationException('校验产生了自动修正，请复核新版本后重新确认', {
        details: { autoFixDiffs: report.autoFixDiffs, version: nextVersion },
      })
    }
    if (report.warning.length > 0 && !request.acknowledgedWarnings) {
      throw new ValidationException('存在需人工确认的高影响项，请确认后重试', {
        details: { warning: report.warning },
      })
    }

    // —— 单事务导入正式数据 ——
    const { projectId, createdCounts } = await db.transaction(async (trx) => {
      const project = await this.createProject(
        trx,
        effective,
        actor,
        session,
        active.meta?.planInsights?.workCalendar.changeFreezeWindows ?? [],
      )
      const wbsIdMap = await this.importWbs(trx, project, effective)
      const { taskIdMap, acceptanceCount } = await this.importTasks(
        trx,
        project.id,
        effective,
        wbsIdMap,
      )
      await this.assignMembers(trx, project, effective, taskIdMap, request, actor.userId)
      const dependencies = await this.importDependencies(trx, effective, taskIdMap)
      const milestones = await this.importMilestones(trx, project.id, effective, taskIdMap)

      // risk-register-and-ai-suggestions: 导入选中的风险提示到正式 risks 表
      const riskCount = await this.importRisks(
        trx,
        project.id,
        Number(project.organizationId),
        effective.riskHints,
        session.draftUid,
        Number(active.version),
        actor.userId,
      )

      const counts: DraftImportCounts = {
        wbsNodes: wbsIdMap.size,
        tasks: taskIdMap.size,
        dependencies,
        milestones,
        acceptanceCriteria: acceptanceCount,
        risks: riskCount,
      }

      // 回填草案会话 + 未选策略决定的收尾状态（tasks 6.6）。
      const importedVersion = changed ? session.currentVersion + 1 : active.version
      if (changed) {
        await AiProjectDraftVersion.query({ client: trx })
          .where('draft_id', session.id)
          .where('status', 'active')
          .update({ status: 'superseded' })
        await AiProjectDraftVersion.create(
          {
            draftId: session.id,
            version: importedVersion,
            origin: 'modified',
            status: 'active',
            draft: effective,
            meta: active.meta,
            validation: report,
          },
          { client: trx },
        )
        session.currentVersion = importedVersion
      }
      session.projectId = project.id
      session.status = this.resolveSessionStatus(request)
      session.useTransaction(trx)
      await session.save()

      const selectionSummary = {
        mode: request.mode,
        unselectedStrategy: request.selection?.unselectedStrategy ?? null,
        dropped,
        created: counts,
      }
      await AiProjectDraftConfirmation.create(
        {
          draftId: session.id,
          version: importedVersion,
          mode: request.mode,
          selectionSummary,
          validationSummary: this.validationSummary(report),
          projectId: project.id,
          confirmedBy: actor.userId,
        },
        { client: trx },
      )

      return { projectId: project.id, createdCounts: counts }
    })

    return {
      projectId,
      createdCounts,
      importedVersion: changed ? session.currentVersion : active.version,
      validation: report,
      selectionSummary: {
        mode: request.mode,
        unselectedStrategy: request.selection?.unselectedStrategy ?? null,
        dropped,
        created: createdCounts,
      },
    }
  }

  /** 未选内容处理策略 → 草案会话收尾状态（discard 关闭；save_as_draft/ask_later 保留可复用）。 */
  private resolveSessionStatus(
    request: ConfirmProjectDraftRequest,
  ): 'confirmed' | 'saved' | 'reviewing' {
    if (request.mode === 'all') return 'confirmed'
    switch (request.selection?.unselectedStrategy) {
      case 'save_as_draft':
        return 'saved'
      case 'ask_later':
        return 'reviewing'
      default:
        return 'confirmed'
    }
  }

  private withSelfCheckAdvisories(
    validationReport: DraftValidationReport,
    selfCheckReport: DraftValidationReport,
  ): DraftValidationReport {
    const selfCheckWarnings = [...selfCheckReport.blocking, ...selfCheckReport.warning].map(
      (issue) => ({
        ...issue,
        severity: 'warning' as const,
      }),
    )

    return {
      ...validationReport,
      warning: [...validationReport.warning, ...selfCheckWarnings],
      info: [...validationReport.info, ...selfCheckReport.info],
      ruleResults: [...validationReport.ruleResults, ...selfCheckWarnings, ...selfCheckReport.info],
      canConfirm: validationReport.blocking.length === 0,
    }
  }

  private async createProject(
    trx: TransactionClientContract,
    draft: ProjectDraft,
    actor: ImportActor,
    session: AiProjectDraft,
    changeFreezeWindows: ReadonlyArray<{ start: string; end: string; label: string }> = [],
  ): Promise<Project> {
    const charter = draft.charter
    const acceptanceForProject = draft.acceptanceCriteria
      .filter((a) => a.linkedTaskId === null)
      .map((a) => a.statement.value)

    const project = await Project.create(
      {
        organizationId: actor.organizationId,
        name: charter.title.value,
        description: charter.vision.value ?? null,
        category: draft.projectType,
        status: 'planning',
        priority: 'medium',
        startDate: toDate(charter.startDate.value),
        endDate: toDate(charter.endDate.value),
        currency: 'CNY',
        settings: {
          source: 'ai_draft',
          draftUid: session.draftUid,
          acceptanceCriteria: acceptanceForProject,
          // AI 只能建议工作日历变更；正式保存必须走项目设置专用端点。
          // 封网窗口来自用户原始描述（已随草案经人工确认），只作日历展示与投产排期参考，不改工作日。
          ...(changeFreezeWindows.length > 0
            ? { changeFreezeWindows: changeFreezeWindows.map((window) => ({ ...window })) }
            : {}),
          // 治理文档（RACI、质量门准入准出、投产窗口）随草案经人工确认，作为项目参考资料保存。
          ...(draft.governance ? { aiGovernance: draft.governance } : {}),
        },
        aiMetadata: { draftUid: session.draftUid, version: session.currentVersion },
        createdBy: actor.userId,
      },
      { client: trx },
    )

    const roles: ProjectRole[] = []
    for (const template of PROJECT_ROLE_TEMPLATES) {
      const role = await ProjectRole.create(
        {
          projectId: project.id,
          name: template.name,
          description: template.description,
          permissions: [...template.permissions],
          isSystem: true,
        },
        { client: trx },
      )
      roles.push(role)
    }
    const ownerRole = roles.find((r) => r.name === 'Project Owner') ?? roles[0]
    await ProjectMember.create(
      {
        projectId: project.id,
        userId: actor.userId,
        projectRoleId: ownerRole.id,
        isActive: true,
      },
      { client: trx },
    )

    return project
  }

  /** 建根节点 + 按草案树插入 WBS，返回 draftNodeId → dbNodeId 映射（不含根）。 */
  private async importWbs(
    trx: TransactionClientContract,
    project: Project,
    draft: ProjectDraft,
  ): Promise<Map<string, number>> {
    const root = await WbsNode.create(
      {
        projectId: project.id,
        parentId: null,
        path: null,
        code: null,
        name: project.name,
        depth: 0,
        isLeaf: draft.wbs.length === 0,
        collapsed: false,
        displayOrder: 0,
        taskId: null,
      },
      { client: trx },
    )
    root.path = `/${root.id}/`
    root.code = '1'
    await root.save()
    project.wbsRootId = root.id
    project.useTransaction(trx)
    await project.save()

    const map = new Map<string, number>()
    const insert = async (
      draftNode: ProjectDraftWbsNode,
      parentId: number,
      parentPath: string,
      parentCode: string,
      depth: number,
      order: number,
    ): Promise<void> => {
      const node = await WbsNode.create(
        {
          projectId: project.id,
          parentId,
          path: null,
          code: null,
          name: draftNode.name.value,
          depth,
          isLeaf: draftNode.children.length === 0,
          collapsed: false,
          displayOrder: order,
          taskId: null,
        },
        { client: trx },
      )
      node.path = `${parentPath}${node.id}/`
      node.code = `${parentCode}.${order + 1}`
      await node.save()
      map.set(draftNode.id, node.id)
      for (let i = 0; i < draftNode.children.length; i++) {
        await insert(draftNode.children[i], node.id, node.path, node.code, depth + 1, i)
      }
    }

    for (let i = 0; i < draft.wbs.length; i++) {
      await insert(draft.wbs[i], root.id, root.path, root.code, 1, i)
    }
    return map
  }

  /** 插入任务并回填 WBS 叶节点 task_id；同时把验收标准挂到任务/项目。 */
  /** 按审查页的人员分配把任务指派给组织成员，并把被指派的人加入项目。 */
  private async assignMembers(
    trx: TransactionClientContract,
    project: Project,
    draft: ProjectDraft,
    taskIdMap: Map<string, number>,
    request: ConfirmProjectDraftRequest,
    actorUserId: number,
  ): Promise<void> {
    const requested = new Set(
      (request.roleAssignments ?? []).flatMap((assignment) => assignment.userIds),
    )
    for (const task of draft.tasks) {
      const code = /成员#(\d+)/u.exec(task.assigneeHint.value ?? '')
      if (code) requested.add(Number(code[1]))
    }
    if (requested.size === 0) return
    const members = await OrganizationMember.query({ client: trx })
      .where('organization_id', Number(project.organizationId))
      .whereIn('user_id', [...requested])
    const allowed = new Set(members.map((member) => Number(member.userId)))
    const plan = planTaskAssignees(draft, request.roleAssignments ?? [], allowed)
    if (plan.size === 0) return
    const memberRole = await ProjectRole.query({ client: trx })
      .where('project_id', project.id)
      .where('name', ProjectRoleName.MEMBER)
      .first()
    for (const userId of new Set(plan.values())) {
      if (userId === actorUserId || !memberRole) continue
      await ProjectMember.create(
        { projectId: project.id, userId, projectRoleId: memberRole.id, isActive: true },
        { client: trx },
      )
    }
    for (const [draftTaskId, userId] of plan) {
      const taskId = taskIdMap.get(draftTaskId)
      if (!taskId) continue
      await Task.query({ client: trx }).where('id', taskId).update({ assigneeId: userId })
    }
  }

  private async importTasks(
    trx: TransactionClientContract,
    projectId: number,
    draft: ProjectDraft,
    wbsIdMap: Map<string, number>,
  ): Promise<{ taskIdMap: Map<string, number>; acceptanceCount: number }> {
    // 预聚合任务级验收标准。
    const acceptanceByTask = new Map<string, string[]>()
    for (const ac of draft.acceptanceCriteria) {
      if (ac.linkedTaskId) {
        const list = acceptanceByTask.get(ac.linkedTaskId) ?? []
        list.push(ac.statement.value)
        acceptanceByTask.set(ac.linkedTaskId, list)
      }
    }

    const taskIdMap = new Map<string, number>()
    const linkedWbs = new Set<number>()
    for (let i = 0; i < draft.tasks.length; i++) {
      const t = draft.tasks[i]
      const dbWbsId = wbsIdMap.get(t.wbsNodeId) ?? null
      const acceptance = acceptanceByTask.get(t.id)
      const created = await Task.create(
        {
          projectId,
          name: t.name.value,
          description: composeTaskDescription(t),
          status: normalizeStatus(t.status) ?? 'not_started',
          priority: 'medium',
          taskType: 'task',
          startDate: toDate(t.startDate.value),
          endDate: toDate(t.endDate.value),
          durationDays: t.durationDays.value,
          wbsNodeId: dbWbsId,
          kanbanRank: i,
          aiMetadata: {
            draftTaskId: t.id,
            assigneeHint: t.assigneeHint.value,
            ...(typeof t.headcount === 'number' && t.headcount > 1
              ? { headcount: t.headcount }
              : {}),
          },
          customFields:
            acceptance || t.execution
              ? {
                  ...(acceptance ? { acceptanceCriteria: acceptance } : {}),
                  ...(t.execution ? { execution: t.execution } : {}),
                }
              : null,
        },
        { client: trx },
      )
      taskIdMap.set(t.id, created.id)
      // WBS 叶节点回填 task_id（每节点仅链首个任务）。
      if (dbWbsId && !linkedWbs.has(dbWbsId)) {
        linkedWbs.add(dbWbsId)
        await WbsNode.query({ client: trx }).where('id', dbWbsId).update({ task_id: created.id })
      }
    }
    return { taskIdMap, acceptanceCount: draft.acceptanceCriteria.length }
  }

  private async importDependencies(
    trx: TransactionClientContract,
    draft: ProjectDraft,
    taskIdMap: Map<string, number>,
  ): Promise<number> {
    let count = 0
    for (const d of draft.dependencies) {
      const pre = taskIdMap.get(d.predecessorId)
      const suc = taskIdMap.get(d.successorId)
      if (!pre || !suc) continue
      await TaskDependency.create(
        {
          predecessorId: pre,
          successorId: suc,
          // DB CHECK 约束为小写枚举（fs/ss/ff/sf）；草案类型为大写，落库前归一。
          type: d.type.toLowerCase(),
          lagDays: d.lagDays.value,
        },
        { client: trx },
      )
      count += 1
    }
    return count
  }

  private async importMilestones(
    trx: TransactionClientContract,
    projectId: number,
    draft: ProjectDraft,
    taskIdMap: Map<string, number>,
  ): Promise<number> {
    let count = 0
    for (let i = 0; i < draft.milestoneHints.length; i++) {
      const m = draft.milestoneHints[i]
      const created = await Milestone.create(
        {
          projectId,
          name: m.name.value,
          description: null,
          status: 'not_started',
          plannedDate: toDate(m.targetDate.value),
          autoCalculated: true,
          displayOrder: i,
        },
        { client: trx },
      )
      for (const tid of m.linkedTaskIds) {
        const dbTask = taskIdMap.get(tid)
        if (dbTask) {
          await Task.query({ client: trx }).where('id', dbTask).update({ milestone_id: created.id })
        }
      }
      count += 1
    }
    return count
  }

  /**
   * risk-register-and-ai-suggestions: 将草案 riskHints 转换为正式风险（Task 8.1）。
   * 在同一事务内批量创建，source = "ai_draft"；未选中的 riskHints 不落库。
   */
  private async importRisks(
    trx: TransactionClientContract,
    projectId: number,
    organizationId: number,
    riskHints: ProjectDraftRiskHint[],
    draftId: string,
    draftVersion: number,
    actorUserId: number,
  ): Promise<number> {
    if (!riskHints || riskHints.length === 0) return 0

    const selectedRiskData = riskHints
      .filter((h) => h.description.value.trim().length > 0)
      .map((h) => this.riskHintToRiskData(h))

    if (selectedRiskData.length === 0) return 0

    const risks = await this.riskService.batchCreateFromDraft({
      trx,
      organizationId,
      projectId,
      draftId,
      draftVersion,
      selectedRiskHints: selectedRiskData,
      actorUserId,
    })

    return risks.length
  }

  /** 将草案 riskHint 转换为 RiskService 可接受的格式。 */
  private riskHintToRiskData(hint: ProjectDraftRiskHint) {
    // 等级映射到概率/影响
    const levelMap: Record<
      string,
      { probability: number; impact: number; category: RiskCategory }
    > = {
      low: { probability: 2, impact: 2, category: 'other' },
      medium: { probability: 3, impact: 3, category: 'other' },
      high: { probability: 4, impact: 4, category: 'technical' },
    }
    const mapped = levelMap[hint.level.value] ?? levelMap.medium!

    return {
      id: hint.id,
      title: hint.description.value.slice(0, 200),
      description: hint.description.value,
      category: mapped.category,
      probability: mapped.probability,
      impact: mapped.impact,
      mitigation: hint.mitigation.value,
      aiMarker: hint.description.marker ?? {
        confidence: 0.5,
        source: 'inferred' as const,
        reason: 'AI 草案生成',
        needsConfirmation: true,
      },
    }
  }

  private validationSummary(report: DraftValidationReport): Record<string, unknown> {
    return {
      overallRiskLevel: report.overallRiskLevel,
      confidenceScore: report.confidenceScore,
      blocking: report.blocking.length,
      warning: report.warning.length,
      info: report.info.length,
      canConfirm: report.canConfirm,
    }
  }
}
