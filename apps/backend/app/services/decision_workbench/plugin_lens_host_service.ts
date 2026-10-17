import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import {
  PMO_DECISION_MAX_BYTES_PER_SOURCE,
  pmoDecisionScanPasses,
  scanPmoDecisionSensitive,
  type PmoDecisionFinding,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 插件 lens 宿主适配层（tasks 8.1/8.2，design D6）。
 *
 * 红线：
 *   - 插件 lens 只消费宿主过滤后的 bounded packet；输出经 schema/大小/超时/
 *     forbidden-field/二次扫描校验，任何违规 isolate 为低敏 finding。
 *   - 插件没有能力创建 outcome 或 handoff；输出不改变 source facts、readiness、
 *     option ordering、eligibility 或正式数据。
 *   - provenance 快照：记录 lens id/version/plugin identity；插件停用/卸载后旧
 *     decision snapshot 仍可追溯，但不能重新执行旧 lens（注册表移除即失效）。
 */

export interface PluginLensBoundedPacket {
  caseId: number
  /** 仅含当前 actor 已授权来源的低敏事实键值。 */
  facts: Array<{ key: string; value: number | string | boolean | null }>
  optionLabels: string[]
}

export interface PluginLensAdvisory {
  lensId: string
  pluginId: string
  lensVersion: string
  /** 非信任草稿评注：仅作展示，绝不进入确定性核心。 */
  commentary: string
}

export interface PluginLensResult {
  status: 'ok' | 'isolated' | 'unavailable'
  advisory: PluginLensAdvisory | null
  finding: PmoDecisionFinding | null
}

export interface PluginLensRegistration {
  lensId: string
  pluginId: string
  lensVersion: string
  ownerUserId: number
  /** 宿主回调：只收到 bounded packet，不得触网/写库（由测试 spy 保证）。 */
  execute: (packet: PluginLensBoundedPacket) => Promise<{ commentary: string }>
}

const MAX_COMMENTARY_CHARS = 2000
const LENS_TIMEOUT_MS = 5_000

export class PluginLensRegistry {
  private readonly lenses = new Map<string, PluginLensRegistration>()

  register(registration: PluginLensRegistration): void {
    if (
      !registration.lensId.trim() ||
      !registration.pluginId.trim() ||
      !registration.lensVersion.trim()
    ) {
      throw new ValidationException('插件 lens 注册信息不完整', {
        code: 'LENS_REGISTRATION_INVALID',
      })
    }
    const key = this.keyOf(registration.lensId, registration.pluginId)
    if (this.lenses.has(key)) {
      throw new ValidationException('重复注册同 lensId+pluginId', { code: 'LENS_DUPLICATE' })
    }
    this.lenses.set(key, registration)
  }

  unregister(lensId: string, pluginId: string): void {
    this.lenses.delete(this.keyOf(lensId, pluginId))
  }

  get(lensId: string, pluginId: string): PluginLensRegistration | null {
    return this.lenses.get(this.keyOf(lensId, pluginId)) ?? null
  }

  list(): PluginLensRegistration[] {
    return [...this.lenses.values()]
  }

  private keyOf(lensId: string, pluginId: string): string {
    return `${pluginId}::${lensId}`
  }
}

@inject()
export default class PluginLensHostService {
  public readonly registry = new PluginLensRegistry()

  constructor(private readonly policy: DecisionWorkbenchPolicy) {}

  async execute(input: {
    user: User
    organizationId: number
    lensId: string
    pluginId: string
    packet: PluginLensBoundedPacket
    now?: number
  }): Promise<PluginLensResult> {
    // 权限：显式请求 AI/插件叙述走 request_ai 门。
    if (
      !(await this.policy.can(input.user, 'pmo_decision:request_ai' as never, input.organizationId))
    ) {
      throw new PermissionDeniedException('无权触发插件 lens')
    }

    const lens = this.registry.get(input.lensId, input.pluginId)
    if (!lens) {
      // 卸载/停用后不可重新执行旧 lens（provenance 仍可由历史 snapshot 追溯）。
      return isolated('LENS_UNAVAILABLE', `lens ${input.lensId} 未注册或已卸载`)
    }

    try {
      const raw = await Promise.race([
        lens.execute(input.packet),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LENS_TIMEOUT')), LENS_TIMEOUT_MS),
        ),
      ])

      const commentary = String(raw?.commentary ?? '')
      if (commentary.length > MAX_COMMENTARY_CHARS) {
        return isolated('LENS_OVERSIZE', 'lens 输出超过大小预算')
      }
      const candidate = {
        lensId: input.lensId,
        pluginId: input.pluginId,
        lensVersion: lens.lensVersion,
        commentary,
      }
      if (JSON.stringify(candidate).length > PMO_DECISION_MAX_BYTES_PER_SOURCE) {
        return isolated('LENS_OVERSIZE', 'lens 输出超过字节预算')
      }
      // 二次扫描：forbidden 键 / secret 形态值 / direct-write 尝试一律隔离。
      const findings = scanPmoDecisionSensitive(candidate)
      if (findings.length > 0 || containsDirectWrite(commentary)) {
        return isolated(
          findings.length > 0 ? 'LENS_SENSITIVE_BLOCKED' : 'LENS_DIRECT_WRITE_BLOCKED',
          'lens 输出未通过安全扫描',
        )
      }
      return {
        status: 'ok',
        advisory: candidate,
        finding: null,
      }
    } catch (error) {
      const message = (error as Error)?.message ?? ''
      return isolated(
        message === 'LENS_TIMEOUT' ? 'LENS_TIMEOUT' : 'LENS_ERROR',
        'lens 执行失败或超时，已隔离',
      )
    }
  }
}

function isolated(reasonCode: string, message: string): PluginLensResult {
  return {
    status: 'isolated',
    advisory: null,
    finding: { code: reasonCode, severity: 'warning', message },
  }
}

/** direct-write 关键词检测：评注中试图给出写指令即隔离。 */
function containsDirectWrite(commentary: string): boolean {
  return /directWrite|"op"\s*:\s*"(update|delete|insert)"|INSERT\s+INTO|UPDATE\s+\w+\s+SET/i.test(
    commentary,
  )
}

export function assertPluginPayloadSafe(payload: unknown): void {
  if (!pmoDecisionScanPasses(payload)) {
    throw new ValidationException('插件载荷包含敏感字段', { code: 'PAYLOAD_SENSITIVE' })
  }
}
