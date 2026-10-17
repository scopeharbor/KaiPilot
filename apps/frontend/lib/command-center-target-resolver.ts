import { COMMAND_CENTER_REASON_CODES, COMMAND_CENTER_TARGET_KINDS } from '@aiproj/types'

/**
 * 前端 safe-target resolver（§5.5，design D7）。
 *
 * 只消费后端闭集 kind + 白名单 params，拒绝：
 *   - 自由 href/url（DTO 形态上不存在，运行时再校验一次）；
 *   - 跨项目 projectId；
 *   - 任何写/确认句柄字段。
 *
 * 输出统一为「应用内路径或页内动作」；无对应 surface 时返回
 * `target-unavailable`（页面据此留在当前视图并显示 bounded warning），
 * 绝不产生外部跳转或写请求。目标页面/API 自行二次授权——本 resolver
 * 的输出不充当授权或确认句柄。
 */

export interface ResolvedTargetNavigation {
  action: 'navigate'
  /** 应用内相对路径（交给 next/navigation），非自由 URL。 */
  path: string
}

export interface ResolvedTargetInPage {
  action: 'in-page'
  /** 页内只读证据抽屉等宿主动作。 */
  surface: 'health-evidence-drawer'
  diagnosisId: number | null
}

export interface ResolvedTargetUnavailable {
  action: 'unavailable'
  reason: typeof COMMAND_CENTER_REASON_CODES.TARGET_SURFACE_UNAVAILABLE
}

export type ResolvedTarget =
  ResolvedTargetNavigation | ResolvedTargetInPage | ResolvedTargetUnavailable

/** resolver 允许的 params 键闭集（与后端 allowlist 一致的防御性子集）。 */
const ALLOWED_PARAM_KEYS = new Set(['projectId', 'riskId', 'taskId', 'diagnosisId'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * 解析安全下钻目标。任何不合法输入一律返回 unavailable（低敏、无异常抛出），
 * 页面显示 bounded warning 并保持核心投影可读。
 */
export function resolveCommandCenterTarget(
  target: unknown,
  context: { projectId: number },
): ResolvedTarget {
  if (!isPlainRecord(target)) return unavailable()

  const { kind, params } = target
  if (typeof kind !== 'string') return unavailable()
  // 写/确认句柄类字段在 DTO 上不存在；出现即伪造。
  if (Object.keys(params ?? {}).some((k) => !ALLOWED_PARAM_KEYS.has(k))) return unavailable()
  if (!isPlainRecord(params)) return unavailable()

  const projectId = params.projectId !== undefined ? positiveInt(params.projectId) : null
  if (projectId !== null && projectId !== context.projectId) return unavailable()

  switch (kind) {
    case COMMAND_CENTER_TARGET_KINDS.PROJECT_DASHBOARD:
      return navigate(`/projects/${context.projectId}`)
    case COMMAND_CENTER_TARGET_KINDS.RISK_WORKBENCH:
    case COMMAND_CENTER_TARGET_KINDS.RISK_DETAIL: {
      if (kind === COMMAND_CENTER_TARGET_KINDS.RISK_DETAIL) {
        const riskId = positiveInt(params.riskId)
        if (riskId === null) return unavailable()
        return navigate(`/projects/${context.projectId}/risks?risk=${riskId}`)
      }
      return navigate(`/projects/${context.projectId}/risks`)
    }
    case COMMAND_CENTER_TARGET_KINDS.PREDICTION_WORKBENCH:
      return navigate(`/projects/${context.projectId}/predictions`)
    case COMMAND_CENTER_TARGET_KINDS.TASK_DETAIL: {
      const taskId = positiveInt(params.taskId)
      if (taskId === null) return unavailable()
      return navigate(`/projects/${context.projectId}/tasks/${taskId}`)
    }
    case COMMAND_CENTER_TARGET_KINDS.RESOURCE_WORKBENCH:
      return navigate(`/projects/${context.projectId}/resources`)
    case COMMAND_CENTER_TARGET_KINDS.CHANGE_IMPACT:
      return navigate(`/projects/${context.projectId}/change-requests`)
    case COMMAND_CENTER_TARGET_KINDS.HEALTH_EVIDENCE: {
      // 健康诊断专用页面不存在：页内只读证据抽屉（零生成/刷新/确认控件）。
      const diagnosisId = params.diagnosisId !== undefined ? positiveInt(params.diagnosisId) : null
      return {
        action: 'in-page',
        surface: 'health-evidence-drawer',
        diagnosisId,
      }
    }
    case COMMAND_CENTER_TARGET_KINDS.MILESTONE_VIEW:
      // 无独立里程碑详情 surface。
      return unavailable()
    default:
      return unavailable()
  }
}

function navigate(path: string): ResolvedTargetNavigation {
  return { action: 'navigate', path }
}

function unavailable(): ResolvedTargetUnavailable {
  return { action: 'unavailable', reason: COMMAND_CENTER_REASON_CODES.TARGET_SURFACE_UNAVAILABLE }
}

/** 类型收窄助手：消费方判断是否为可导航目标。 */
export function isNavigableTarget(resolved: ResolvedTarget): resolved is ResolvedTargetNavigation {
  return resolved.action === 'navigate'
}
