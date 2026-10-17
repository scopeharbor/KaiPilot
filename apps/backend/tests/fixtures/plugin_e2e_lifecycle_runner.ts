/**
 * plugin-e2e-lifecycle-runner —— v3-plugin-e2e-lifecycle-certification 认证运行器（W5c 任务 2.1~2.4）。
 *
 * 职责：把插件完整生命周期（package verification、install、permission、enable、execute、
 * disable、upgrade、rollback、uninstall、residue inspection 与安全/跨租负例）通过**真实 HTTP API**
 * （Japa apiClient）逐步驱动，并把每一步映射为共享契约 `@aiproj/types` 的
 * `PluginE2EStepResult`，最终产出可 `canonicalizeReport` / `validateCertificationReport`
 * 判定的认证报告。不复制安装状态机——全部走 `/api/v1/organizations/:id/plugin-installations/*`。
 *
 * 语义约定：
 * - 正向步骤：conclusion='pass' 表示该步真实发生且符合预期；失败即 'fail'。
 * - 负例步骤（PLUGIN_E2E_NEGATIVE_STEP_IDS）：'pass' 表示系统**正确阻断**了负例；
 *   若负例未被阻断则为 'fail'（blocking-negative-not-denied）。
 * - 步骤中断：未执行的必需步骤保持 'not-run'，报告经 evaluateReportConclusion 必须 fail。
 *
 * 隔离：由调用方提供 `useAiDatabase` 的每用例 truncate 快照 + 双租户 fixture；
 * 本文件不触碰全局状态，不产生网络外发（hook 回调为进程内确定性 fixture）。
 */
import type { PluginE2EStepId, PluginE2EStepResult } from '@aiproj/types'

/** 低敏相对 evidence ref 前缀（与共享契约一致）。 */
const EVIDENCE_PREFIX = 'fixture:plugin-e2e-cert'

/** 单条步骤记录。 */
export function certStep(
  stepId: PluginE2EStepId,
  conclusion: PluginE2EStepResult['conclusion'],
  reasonCode: PluginE2EStepResult['reasonCode'],
  order: number,
  details?: string,
): PluginE2EStepResult {
  return {
    stepId,
    conclusion,
    reasonCode,
    order,
    evidenceRef: `${EVIDENCE_PREFIX}/${stepId}`,
    ...(details ? { details: details.slice(0, 300) } : {}),
  }
}

/** 兼容 Japa ApiResponse（status 为方法）与普通对象的响应形态。 */
export type CertHttpResponse = {
  status: number | (() => number)
  body: () => any
}

function httpStatus(response: CertHttpResponse): number {
  return typeof response.status === 'function' ? response.status() : response.status
}

/** 认证运行器：按序收集步骤结果；任何异常都不得静默吞掉。 */
export class PluginLifecycleCertRunner {
  readonly steps: PluginE2EStepResult[] = []
  private nextOrder = 1

  /** 记录一步（order 自动递增，稳定排序）。 */
  record(
    stepId: PluginE2EStepId,
    conclusion: PluginE2EStepResult['conclusion'],
    reasonCode: PluginE2EStepResult['reasonCode'] = 'ok',
    details?: string,
  ): void {
    this.steps.push(certStep(stepId, conclusion, reasonCode, this.nextOrder++, details))
  }

  /**
   * 断言正向 API 步骤成功；HTTP 非 2xx 时记录 fail 并抛出（中断后续步骤）。
   * 返回响应 JSON 的 data 字段。
   */
  async apiOk(
    stepId: PluginE2EStepId,
    promise: Promise<CertHttpResponse>,
    details?: string,
  ): Promise<any> {
    const response = await promise
    const status = httpStatus(response)
    if (status < 200 || status >= 300) {
      const errCode = response.body()?.error?.code ?? `http-${status}`
      this.record(stepId, 'fail', 'unknown-error', `${stepId} rejected: ${errCode}`)
      throw new Error(`certification step ${stepId} failed: ${errCode}`)
    }
    this.record(stepId, 'pass', 'ok', details)
    return response.body().data
  }

  /**
   * 断言负例被正确阻断；未阻断时记录 blocking-negative-not-denied 并抛出。
   * `expectedCodes` 为可接受的稳定错误码集合。
   */
  async apiMustDeny(
    stepId: PluginE2EStepId,
    promise: Promise<CertHttpResponse>,
    expectedCodes: string[],
  ): Promise<void> {
    const response = await promise
    const status = httpStatus(response)
    const errCode = response.body()?.error?.code ?? ''
    const denied = status >= 400 && expectedCodes.includes(errCode)
    if (!denied) {
      this.record(
        stepId,
        'fail',
        'blocking-negative-not-denied',
        `${stepId} not denied (status=${httpStatus(response)}, code=${errCode || 'none'})`,
      )
      throw new Error(`certification negative ${stepId} was not denied`)
    }
    this.record(stepId, 'pass', 'ok', `denied as ${errCode}`)
  }

  /** 记录一个不经 HTTP 的判定步骤（如残留扫描、健康证据断言）。 */
  judge(
    stepId: PluginE2EStepId,
    passed: boolean,
    failureReason: PluginE2EStepResult['reasonCode'],
    details?: string,
  ): void {
    this.record(stepId, passed ? 'pass' : 'fail', passed ? 'ok' : failureReason, details)
  }

  /** 中断语义：把尚未记录的必需步骤补记为 not-run（供中断测试构造 fail 报告）。 */
  markUnrun(requiredIds: readonly PluginE2EStepId[]): void {
    for (const id of requiredIds) {
      if (!this.steps.some((s) => s.stepId === id)) {
        this.steps.push(certStep(id, 'not-run', 'missing-required-step', this.nextOrder++))
      }
    }
  }
}

/** 安装命令两步流（preview → confirm），返回 preview 与最终 installation。 */
export async function installCommandFlow(
  client: any,
  token: string,
  organizationId: number,
  payload: Record<string, unknown>,
): Promise<{ preview: any; installation: any }> {
  const previewResponse = await client
    .post(`/api/v1/organizations/${organizationId}/plugin-installations/commands/preview`)
    .bearerToken(token)
    .json(payload)
  const previewBody = previewResponse.body()
  if (previewResponse.status !== 200) {
    return { preview: previewBody, installation: null }
  }
  const preview = previewBody.data
  const isEnable = payload.action === 'enable'
  const confirmResponse = await client
    .post(`/api/v1/organizations/${organizationId}/plugin-installations/commands/confirm`)
    .bearerToken(token)
    .json({
      previewHandle: preview.previewHandle,
      previewDigest: preview.previewDigest,
      ...(isEnable
        ? { permissionConfirmed: true, permissionDigest: preview.permissionDigest }
        : {}),
    })
  return {
    preview,
    installation:
      confirmResponse.status === 200 ? confirmResponse.body().data : confirmResponse.body(),
  }
}

/** 残留扫描输入（低敏计数投影，不含业务内容）。 */
export interface ResidueScanInput {
  organizationRows: Array<{ status: string }>
  otherTenantRows: number
  activeOtherPluginRows: number
}

/** 残留判定：本租允许保留的只有软卸载/预期终态行；他租必须零行；无孤儿启用行。 */
export function evaluateResidueScan(input: ResidueScanInput): boolean {
  const nonTerminal = input.organizationRows.filter((r) => r.status === 'enabled')
  if (input.otherTenantRows !== 0) return false
  if (input.activeOtherPluginRows !== 0) return false
  // 卸载闭环后不允许仍处于 enabled 的孤儿授权（installed 属预期中间态时由调用方放宽）
  return nonTerminal.length === 0
}
