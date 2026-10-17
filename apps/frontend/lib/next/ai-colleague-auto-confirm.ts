/**
 * AI 同事全自动：草案生成后由 AI 同事自己修正并确认转正，全程不再询问用户。
 *
 * 只在用户在 AI 同事里明确选择「全自动（包括转为正式项目）」时由联动调用。循环直到转正成功：
 * - 规则引擎 / 反幻觉校验有阻断项 → 先按系统规则自动修正（`validate autoFix`，落新版本），
 *   仍有阻断再请 AI 同事的模型修正（`ai-fix`）：改字段（零写入，带着修改重新校验），或增删任务 /
 *   依赖等结构调整（服务端落新草案版本后载入）；
 * - 确认时服务端产生自动修正（新版本）或版本过期 → 载入最新版本后继续；
 * - 提醒（warning）由 AI 同事代为复核（acknowledgedWarnings=true），并在对话里如实告知条数；
 * - 请求带 `confirmedVia: 'ai_colleague_autopilot'`，服务端照常重算全部校验，审计记为
 *   「由 AI 同事全自动转正」。
 * 只有真的修不动（模型不可用、连续 5 轮没有新修改、轮数用尽）、没有转正权限或用户停止时才停下并说明原因。
 */
import type {
  ConfirmProjectDraftResponse,
  DraftValidationIssue,
  DraftValidationReport,
} from '@aiproj/types'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { classifyConfirmFailure } from '@/components/next/review/NextDraftConfirmModal'
import { isConfirmBlocked } from '@/components/next/review/NextDraftActionBar'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'

/** 修正 + 确认最多几轮（与 AI 同事多步上限一致）。 */
export const AUTOPILOT_MAX_ROUNDS = 30
/** 连续几轮模型没有给出任何新修改才判定修不动。 */
export const AUTOPILOT_MAX_IDLE_ROUNDS = 5

export interface AutopilotFixSummary {
  /** 系统规则自动修正的条数（含确认时服务端产生的自动修正）。 */
  ruleFixes: number
  /** AI 同事的模型修改的字段数。 */
  aiFixes: number
  /** AI 同事做的结构调整数（增删任务 / 依赖等）。 */
  structuralFixes: number
  /** 模型给出的修改理由。 */
  reasons: string[]
  warningCount: number
}

export type AutoConfirmOutcome =
  | ({ kind: 'confirmed'; response: ConfirmProjectDraftResponse } & AutopilotFixSummary)
  | { kind: 'no_permission' }
  | ({ kind: 'unfixable'; message: string; issues: DraftValidationIssue[] } & AutopilotFixSummary)
  | { kind: 'fatal'; message: string }
  | { kind: 'cancelled' }

export interface AutoConfirmOptions {
  /** 用户中途停止全自动（每一轮开始前检查）。 */
  isCancelled?: () => boolean
  /** 进度播报（每一轮修正都会告诉用户在做什么）。 */
  onProgress?: (text: string) => void
  /** AI 同事当前选用的模型（修正阻断项时优先用它）。 */
  model?: { connectionId: number; modelId: number } | null
}

/** 载入服务端最新版本（自动修正 / 版本过期后）：草案、校验、版本号；就地修改已并入新版本，清空。 */
async function reloadLatest(draftId: string): Promise<void> {
  const detail = await aiDraftApi.get(draftId)
  if (!detail.draft || !detail.meta || !detail.validation) {
    throw new Error('新版本草案还没有准备好')
  }
  const store = useAiProjectDraftStore.getState()
  store.setDraftCompleted(detail.draft, detail.meta, detail.validation)
  useAiProjectDraftStore.setState({
    draftId: detail.draftId,
    draftVersion: detail.version,
    pendingModifications: [],
  })
  store.enterReview()
}

function setValidation(report: DraftValidationReport): void {
  useAiProjectDraftStore.setState({ validation: report })
}

export async function autoConfirmDraft(
  options: AutoConfirmOptions = {},
): Promise<AutoConfirmOutcome> {
  if (!useAuthStore.getState().hasPermission('ai:confirm')) return { kind: 'no_permission' }
  const progress = options.onProgress ?? (() => undefined)
  const summary: AutopilotFixSummary = {
    ruleFixes: 0,
    aiFixes: 0,
    structuralFixes: 0,
    reasons: [],
    warningCount: 0,
  }
  let triedRuleFix = false
  let idleRounds = 0
  let lastIssues: DraftValidationIssue[] = []

  try {
    for (let round = 1; round <= AUTOPILOT_MAX_ROUNDS; round += 1) {
      if (options.isCancelled?.()) return { kind: 'cancelled' }
      const store = useAiProjectDraftStore.getState()
      const { draftId, draft, validation } = store
      if (!draftId || !draft || !validation) {
        return { kind: 'fatal', message: '草案还没有准备好' }
      }

      if (isConfirmBlocked(validation)) {
        lastIssues = [...(validation.blocking ?? [])]
        // 1) 系统规则能自动修的先修（落新版本）
        if (!triedRuleFix && lastIssues.some((issue) => issue.autoFixable)) {
          triedRuleFix = true
          progress(`校验发现 ${lastIssues.length} 个阻断问题，先按系统规则自动修正…`)
          const result = await aiDraftApi.validate(draftId, {
            phase: 'all',
            autoFix: true,
            modifications: store.pendingModifications,
          })
          summary.ruleFixes += result.autoFixDiffs.length
          await reloadLatest(draftId)
          setValidation(result.report)
          continue
        }
        // 2) 其余交给 AI 同事的模型提出字段修改
        progress(
          `还有 ${lastIssues.length} 个阻断问题，AI 同事正在修改草案（第 ${round} 轮）：${lastIssues
            .slice(0, 2)
            .map((issue) => issue.message)
            .join('；')}`,
        )
        let fix: Awaited<ReturnType<typeof aiDraftApi.aiFix>>
        try {
          fix = await aiDraftApi.aiFix(draftId, {
            version: store.draftVersion,
            modifications: store.pendingModifications,
            ...(options.model ?? {}),
          })
        } catch (error) {
          if (classifyConfirmFailure(error, store.draftVersion).kind === 'stale') {
            progress('草案有更新的版本，载入最新版本后继续修正…')
            await reloadLatest(draftId)
            continue
          }
          throw error
        }
        if (fix.unavailable) {
          return {
            kind: 'unfixable',
            message: '组织里没有可用的真实模型来修正草案',
            issues: lastIssues,
            ...summary,
          }
        }
        const changed = fix.applied.length + fix.operations.length
        idleRounds = changed === 0 ? idleRounds + 1 : 0
        summary.aiFixes += fix.applied.length
        summary.structuralFixes += fix.operations.length
        summary.reasons.push(...fix.reasons)
        if (fix.version !== store.draftVersion) {
          // 结构性修正（增删任务 / 依赖）已落新草案版本：字段修改已并入，载入新版本
          await reloadLatest(draftId)
        } else {
          useAiProjectDraftStore.setState({ pendingModifications: fix.modifications })
        }
        setValidation(fix.report)
        if (idleRounds >= AUTOPILOT_MAX_IDLE_ROUNDS) {
          return {
            kind: 'unfixable',
            message: `模型连续 ${AUTOPILOT_MAX_IDLE_ROUNDS} 轮没有给出新的修改`,
            issues: [...(fix.report.blocking ?? [])],
            ...summary,
          }
        }
        continue
      }

      // 3) 没有阻断：全部接受、代为复核提醒，确认转正
      const confirmStore = useAiDraftConfirmStore.getState()
      confirmStore.initSelection(draft)
      const { selection } = useAiDraftConfirmStore.getState()
      if (selection.taskIds.length === 0) {
        return { kind: 'fatal', message: '草案里没有可导入的任务' }
      }
      const roleAssignments = Object.entries(useAiDraftConfirmStore.getState().roleAssignments)
        .filter(([, userIds]) => userIds.length > 0)
        .map(([role, userIds]) => ({ role, userIds }))
      summary.warningCount = validation.warning?.length ?? 0
      progress('校验没有阻断项，AI 同事正在确认转为正式项目…')
      useAiDraftConfirmStore.setState({ isConfirming: true, acknowledgedWarnings: true })
      try {
        const response = await aiDraftApi.confirm(draftId, {
          version: store.draftVersion,
          mode: 'all',
          selection,
          modifications: store.pendingModifications,
          acknowledgedWarnings: true,
          confirmedVia: 'ai_colleague_autopilot',
          ...(roleAssignments.length > 0 ? { roleAssignments } : {}),
        })
        useAiProjectDraftStore.getState().enterConfirmed(response)
        return { kind: 'confirmed', response, ...summary }
      } catch (error) {
        const result = classifyConfirmFailure(error, store.draftVersion)
        if (result.kind === 'autoFix') {
          // 服务端按规则自动修正并升级了版本：AI 同事接受修正，载入新版本后继续
          summary.ruleFixes += result.diffs.length
          progress(`系统按规则自动修正了 ${result.diffs.length} 处，AI 同事已接受，载入新版本继续…`)
          await reloadLatest(draftId)
          continue
        }
        if (result.kind === 'stale') {
          progress('草案有更新的版本，载入最新版本后继续…')
          await reloadLatest(draftId)
          continue
        }
        if (result.kind === 'blocking') {
          setValidation({ ...validation, blocking: result.issues, canConfirm: false })
          continue
        }
        return { kind: 'fatal', message: result.message }
      } finally {
        useAiDraftConfirmStore.setState({ isConfirming: false, confirmModalOpen: false })
      }
    }
  } catch (error) {
    return { kind: 'fatal', message: error instanceof Error ? error.message : String(error) }
  }
  return {
    kind: 'unfixable',
    message: `修正了 ${AUTOPILOT_MAX_ROUNDS} 轮仍未通过校验`,
    issues: lastIssues,
    ...summary,
  }
}

function fixSentence(outcome: AutopilotFixSummary): string {
  const parts = [
    outcome.ruleFixes > 0 ? `系统规则自动修正 ${outcome.ruleFixes} 处` : null,
    outcome.aiFixes > 0 ? `AI 同事修改 ${outcome.aiFixes} 个字段` : null,
    outcome.structuralFixes > 0
      ? `AI 同事调整 ${outcome.structuralFixes} 处结构（增删任务 / 依赖）`
      : null,
    outcome.warningCount > 0 ? `${outcome.warningCount} 条提醒已代为复核` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `（${parts.join('，')}）` : ''
}

/** 结果在对话里怎么说。 */
export function describeAutoConfirmOutcome(outcome: AutoConfirmOutcome): string {
  const manual = '可以到 [生成剧场](/next/create) 查看草案。'
  switch (outcome.kind) {
    case 'confirmed': {
      const counts = outcome.response.createdCounts
      return [
        `全自动完成 ✅ 正式项目已创建：[打开项目](/next/projects/${outcome.response.projectId})。`,
        `导入了 ${counts.tasks} 个任务、${counts.wbsNodes} 个 WBS 节点、${counts.dependencies} 条依赖、${counts.milestones} 个里程碑、${counts.risks} 条风险，规则校验与反幻觉检查全部通过${fixSentence(outcome)}。`,
        outcome.reasons.length > 0 ? `修改说明：${outcome.reasons.slice(0, 3).join('；')}` : null,
        '之后要调整请发起「变更」，或直接告诉我改哪里。',
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'unfixable': {
      const list = outcome.issues
        .slice(0, 3)
        .map((issue) => `- ${issue.message}`)
        .join('\n')
      return [
        `全自动没能转正：${outcome.message}${fixSentence(outcome)}。剩下的问题：`,
        list,
        manual,
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'no_permission':
      return `当前账号没有转正权限（缺少 ai:confirm），草案已生成但没有转为正式项目。请联系项目管理员。${manual}`
    case 'fatal':
      return `全自动转正没有完成：${outcome.message}。${manual}`
    case 'cancelled':
      return `已停止全自动，草案没有转为正式项目。${manual}`
  }
}
