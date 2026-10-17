/**
 * v2-redis-minimum-runtime-support —— Redis 就绪门禁（design D7, task 5.3）。
 *
 * 连接感知的最小就绪检查，平行于 PgCompatibilityGate：
 * - 必要参数完整性（REDIS_HOST / REDIS_PORT）
 * - 连接可达性（PING）
 * - SET/GET/DEL 读写探针（命名空间前缀下）
 * 区分 ready / warning / blocked，输出简体中文脱敏摘要与分类下一步建议。
 * 任一 blocking 存在时禁止把该 Redis 目标声明为可用于承载限流或缓存。
 *
 * 报告绝不包含 password、完整连接串、host/port 或原始异常正文（对齐 D8 白名单）。
 */
import { isRedisEnabled, missingRedisParams, redisLowSensitiveDescription } from '#config/redis'
import { probeRedisReadWrite, type RedisProbeResult } from './redis_connection.js'
import { redisErrorAdvice } from './redis_error.js'

export type RedisGateStatus = 'ready' | 'warning' | 'blocked'

export interface RedisGateIssue {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  message: string
}

export interface RedisGateResult {
  status: RedisGateStatus
  enabled: boolean
  connection: string
  blockingCount: number
  warningCount: number
  infoCount: number
  issues: RedisGateIssue[]
  summary: string
  details: {
    paramsComplete: boolean
    connectionReachable: boolean
    readWriteOk: boolean
  }
}

export interface RedisGateInputs {
  enabled: boolean
  missingParams: string[]
  /** 探针结果；未启用或参数不全时可为 null（不发起连接）。 */
  probe: RedisProbeResult | null
}

/**
 * 纯评估核心：由输入构造门禁结果，无 I/O、无 env、无副作用。
 * 单元测试覆盖全部分支（disabled/params-missing/unreachable/readwrite-fail/ready），
 * 无需 live Redis 或翻转环境变量。报告仅含分类与低敏标识，禁止敏感正文。
 */
export function evaluateRedisGate(inputs: RedisGateInputs): RedisGateResult {
  const { enabled, missingParams, probe } = inputs
  const issues: RedisGateIssue[] = []
  const details = {
    paramsComplete: false,
    connectionReachable: false,
    readWriteOk: false,
  }

  if (!enabled) {
    issues.push({
      severity: 'info',
      code: 'REDIS_DISABLED',
      message: 'Redis 未启用（REDIS_ENABLED 未开），限流与缓存走单节点内存实现',
    })
    return finalizeGate(enabled, issues, details)
  }

  // 1. 参数完整性
  details.paramsComplete = missingParams.length === 0
  if (!details.paramsComplete) {
    issues.push({
      severity: 'blocking',
      code: 'REDIS_PARAMS_MISSING',
      message: `缺少必要连接参数：${missingParams.join(' / ')}；补齐后重试就绪门禁`,
    })
    return finalizeGate(enabled, issues, details)
  }

  // 2 + 3. 连接可达性与读写探针
  const p = probe ?? { reachable: false, readWriteOk: false, error: 'unknown' as const }
  details.connectionReachable = p.reachable
  details.readWriteOk = p.readWriteOk

  if (!p.reachable) {
    issues.push({
      severity: 'blocking',
      code: 'REDIS_CONNECTION_UNREACHABLE',
      message: `连接不可达（${p.error ?? 'unknown'}）：${redisErrorAdvice(p.error ?? 'unknown')}`,
    })
    return finalizeGate(enabled, issues, details)
  }

  if (!p.readWriteOk) {
    issues.push({
      severity: 'blocking',
      code: 'REDIS_READWRITE_FAILED',
      message: `SET/GET/DEL 读写探针失败（${p.error ?? 'unknown'}）：确认实例可写且未只读`,
    })
    return finalizeGate(enabled, issues, details)
  }

  return finalizeGate(enabled, issues, details)
}

function finalizeGate(
  enabled: boolean,
  issues: RedisGateIssue[],
  details: RedisGateResult['details'],
): RedisGateResult {
  const blockingCount = issues.filter((i) => i.severity === 'blocking').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const infoCount = issues.filter((i) => i.severity === 'info').length

  let status: RedisGateStatus = 'ready'
  if (blockingCount > 0) status = 'blocked'
  else if (warningCount > 0) status = 'warning'

  return {
    status,
    enabled,
    connection: redisLowSensitiveDescription(),
    blockingCount,
    warningCount,
    infoCount,
    issues,
    summary: buildGateSummary(status, enabled, blockingCount, warningCount, infoCount),
    details,
  }
}

function buildGateSummary(
  status: RedisGateStatus,
  enabled: boolean,
  blocking: number,
  warning: number,
  info: number,
): string {
  if (!enabled) {
    return '✅ Redis 未启用：默认单节点内存路径可用，无需就绪门禁阻断。'
  }
  if (status === 'blocked') {
    return `❌ Redis 就绪门禁未通过：${blocking} 个 blocking、${warning} 个警告、${info} 条提示。禁止声明该 Redis 可承载限流或缓存。`
  }
  if (status === 'warning') {
    return `⚠️ Redis 就绪门禁通过但有 ${warning} 个警告、${info} 条提示。建议处理后再启用限流器 redis store。`
  }
  return '✅ Redis 就绪门禁通过：连接可达、读写探针成功、参数完整，可承载限流与缓存。'
}

export class RedisReadinessGate {
  /**
   * 执行就绪门禁。timeoutMs 控制单次探针超时。
   * 收集 env（是否启用、缺失参数）与探针结果后交由纯评估核心判定。
   */
  async check(timeoutMs = 5000): Promise<RedisGateResult> {
    const enabled = isRedisEnabled()

    if (!enabled) {
      return evaluateRedisGate({ enabled, missingParams: [], probe: null })
    }

    const missingParams = missingRedisParams()
    if (missingParams.length > 0) {
      return evaluateRedisGate({ enabled, missingParams, probe: null })
    }

    const probe = await probeRedisReadWrite(timeoutMs)
    return evaluateRedisGate({ enabled, missingParams, probe })
  }
}
