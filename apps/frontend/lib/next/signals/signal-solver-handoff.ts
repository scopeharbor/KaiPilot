import { signalCodeOf, type ProjectSignal } from '@/lib/api/project-signals'
import type { ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useAuthStore } from '@/stores/auth-store'
export { buildSignalSolverStatement, recommendedTargetForSignal } from './signal-solve-statement'

/**
 * 信号 → 矛盾求解流交接（v3-triz-contradiction-copilot W6 · tasks 6.2；2026-10-12 重做）。
 *
 * 原先点「进入矛盾求解」会把一整段读数原文（`metric=… 阈值 …`）作为用户消息发出，
 * 求解端把这段原文当成「矛盾陈述」去分析：用户看不懂，分析也是对着噪声做的。现在：
 * - 对话里只显示一句短指令「矛盾求解 PROJ-8#S10」（信号编号可复制，在 AI 同事里手动输入同样生效）；
 * - 交给求解端的陈述由信号**翻译成大白话**（哪个项目、出了什么状况、想守住什么却被什么拖累）；
 * - 求解流程仍是「AI 分析 → 选方案 → 选落实方式 → 预览 → 人工确认」，确认落库后信号自动采纳、
 *   从信号建议里消失（RL-01：零自动落库，确认按钮是唯一写入口）。
 */

/** 首轮消息的意图短语（AI 同事据「矛盾求解 + 信号编号」识别为对该信号求解）。 */
export const SIGNAL_SOLVER_INTENT_PHRASE = '矛盾求解'

export interface SignalSolverHandoffInput {
  projectId: number
  signal: ProjectSignal
  permissions?: readonly string[]
  isSuperAdmin?: boolean
}

/** 对话里显示的短指令（纯函数）：`矛盾求解 PROJ-8#S10`。 */
export function buildSignalSolverMessage(input: SignalSolverHandoffInput): string {
  return `${SIGNAL_SOLVER_INTENT_PHRASE} ${signalCodeOf({ ...input.signal, projectId: input.projectId })}`
}

/** 项目空间上下文（AI 同事意图解析的项目域参数注入用；携带结构化 sourceSignalId）。 */
export function signalSolverColleagueContext(
  projectId: number,
  sourceSignalId?: number | null,
  permissions?: readonly string[],
  isSuperAdmin?: boolean,
): ColleagueContext {
  // 首页可以在尚未建立 AI 对话时点击；权限须来自当前登录态，不能继承旧对话身份。
  const auth = useAuthStore.getState()
  const effectivePermissions = permissions ?? auth.permissions
  return {
    contextType: 'project_space',
    currentProjectId: projectId,
    pathname: `/next/projects/${projectId}`,
    sourceSignalId: sourceSignalId ?? null,
    permissions: effectivePermissions,
    isSuperAdmin:
      isSuperAdmin ??
      (effectivePermissions.includes('system:admin') ||
        (permissions === undefined && (auth.user?.isSuperAdmin ?? false))),
  }
}

/**
 * 打开 AI 同事面板并发出「矛盾求解 <信号编号>」。
 * 信号对象先交给 store 暂存（免去再查一次），面板打开是用户显式点击的结果（非自动弹出）。
 */
export function openSignalSolverFlow(input: SignalSolverHandoffInput): void {
  const store = useNextAiColleagueStore.getState()
  store.rememberSignalForSolve({ ...input.signal, projectId: input.projectId })
  store.openPanel()
  void store.submitUserMessage(
    buildSignalSolverMessage(input),
    signalSolverColleagueContext(
      input.projectId,
      input.signal.id,
      input.permissions,
      input.isSuperAdmin,
    ),
  )
}
