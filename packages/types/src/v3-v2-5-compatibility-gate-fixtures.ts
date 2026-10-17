/**
 * v3-v2-5-compatibility-gate-fixtures —— V3/V2.5 兼容治理门测试夹具。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块，零运行时依赖（同 @aiproj/types 其他模块）。
 *
 * # 夹具清单
 * 1. `VALID_COMPATIBILITY_LEDGER_FIXTURE`：合法完整账本（主账本的最小变体）。
 * 2. `MISSING_GA_P0_LEDGER_FIXTURE`：缺 GA P0 表面的账本（校验须报 missing-ga-p0）。
 * 3. `STALE_EVIDENCE_LEDGER_FIXTURE`：证据陈旧（generatedAt 很旧）的账本（规则引擎报 warning）。
 * 4. `ILLEGAL_STATUS_TRANSITION_PAIRS`：非法状态迁移 from/to 对（须被 assertSupportedStatusTransition 拦截）。
 * 5. `HIDDEN_INFRA_PREREQUISITE_SAMPLE_TEXT`：含隐藏基础设施前提的样例文本（规则引擎 blocking 语料）。
 * 6. `UNAUTHORIZED_EXTERNAL_ACTION_SAMPLE_TEXT`：含未授权外部动作的样例文本（规则引擎 blocking 语料）。
 *
 * # 低敏纪律
 * 样例文本仅描述违规行为类别，不含真实凭据、原始载荷或跨租户数据。
 */

import type { CompatibilityLedger, V25SurfaceStatus } from './v3-v2-5-compatibility-gate.js'
import { V25_COMPATIBILITY_LEDGER } from './v3-v2-5-compatibility-gate-ledger.js'

// =============================================================================
// 1. 合法完整账本（主账本的最小变体：换 generatedAt，内容不变）
// =============================================================================

/** 合法完整账本：直接复用主账本全部条目，仅 generatedAt 取同日变体。 */
export const VALID_COMPATIBILITY_LEDGER_FIXTURE: CompatibilityLedger = {
  ...V25_COMPATIBILITY_LEDGER,
  generatedAt: '2026-08-16',
}

// =============================================================================
// 2. 缺 GA P0 表面的账本（校验须报 missing-ga-p0）
// =============================================================================

/** 缺 GA P0 表面的账本：移除 gantt-what-if 与 compiler-orchestration-wiring。 */
export const MISSING_GA_P0_LEDGER_FIXTURE: CompatibilityLedger = {
  ...V25_COMPATIBILITY_LEDGER,
  surfaces: V25_COMPATIBILITY_LEDGER.surfaces.filter(
    (surface) =>
      surface.surfaceId !== 'gantt-what-if' &&
      surface.surfaceId !== 'compiler-orchestration-wiring',
  ),
}

// =============================================================================
// 3. 证据陈旧的账本（generatedAt 很旧；规则引擎应以 warning 而非 blocking 处理）
// =============================================================================

/** 证据陈旧账本：结构完整但 generatedAt 远早于当前刷新日期。 */
export const STALE_EVIDENCE_LEDGER_FIXTURE: CompatibilityLedger = {
  ...V25_COMPATIBILITY_LEDGER,
  generatedAt: '2025-01-01',
}

// =============================================================================
// 4. 非法状态迁移对（须被 assertSupportedStatusTransition 拦截）
// =============================================================================

/** 一对非法状态迁移。 */
export interface IllegalStatusTransitionPair {
  from: V25SurfaceStatus
  to: V25SurfaceStatus
  /** 该对为何非法的低敏说明。 */
  reason: string
}

/**
 * 非法状态迁移样例对：
 * - verified-archived 为终态，任何降级（含 →deferred / →rejected）非法。
 * - rejected 为终态，不得直接变 verified-archived。
 */
export const ILLEGAL_STATUS_TRANSITION_PAIRS: IllegalStatusTransitionPair[] = [
  {
    from: 'verified-archived',
    to: 'deferred',
    reason: '已交付归档事实不得降级为延期项',
  },
  {
    from: 'verified-archived',
    to: 'rejected',
    reason: '已交付归档事实不得改判为已拒绝',
  },
  {
    from: 'verified-archived',
    to: 'conditional',
    reason: '已交付归档事实不得退回授权门',
  },
  {
    from: 'rejected',
    to: 'verified-archived',
    reason: '已裁决拒绝的叙事不得直接变为已交付归档',
  },
]

// =============================================================================
// 5. 隐藏基础设施前提语料（规则引擎 hidden-prerequisite 测试复用）
// =============================================================================

/**
 * 含隐藏基础设施前提的样例文本：把历史 PRD 中的强外部基础设施叙事当作当前实现前提。
 * 低敏：不含真实凭据或载荷，仅描述违规措辞模式。
 */
export const HIDDEN_INFRA_PREREQUISITE_SAMPLE_TEXT = [
  '本 change 的实现前提：部署必须基于 Docker 容器化与 Kubernetes 微服务编排，',
  '数据库强制迁移至 PostgreSQL，缓存强制依赖 Redis 集群与 Kafka 消息队列，',
  '检索层强制引入 VectorDB；/api/v2 已接通并作为默认入口，实时通道切换为 WebSocket 微服务。',
  '以上基础设施到位前，本 change 无法落地。',
].join('')

// =============================================================================
// 6. 未授权外部动作语料（规则引擎 external-action-boundary 测试复用）
// =============================================================================

/**
 * 含未授权外部动作的样例文本：在未获用户明确授权的情况下计划真实外部动作。
 * 低敏：仅描述动作类别，不含真实令牌、回调地址或载荷。
 */
export const UNAUTHORIZED_EXTERNAL_ACTION_SAMPLE_TEXT = [
  '为验证端到端链路，本 change 将直接调用真实 GitHub OAuth 令牌交换接口完成连接，',
  '随后向真实仓库推送写回评论，并接收真实 Webhook 回调做外发 smoke；',
  '最后将 SDK 直接发布到公开 npm registry，并对 720 矩阵跑一轮真实模型评测。',
  '上述动作均不需要额外授权，随本 change 一并完成。',
].join('')
