// @aiproj/backend — TenantConnectionPoolManager（v3-multitenant-connection-pool-management §3）。
//
// 进程内逻辑租户 lease 管理器：在物理连接池（Lucid/Knex/Redis/provider SDK）之上
// 管理逻辑 lease，提供租户级预算、有界队列公平轮转、全局/租户上限、abort/timeout/
// retry/degraded/circuit-open 决策与 release idempotency。
//
// 设计依据 design.md：
// - Decision 1：逻辑 lease，不为每个租户创建物理 pool。
// - Decision 3：全局上限 + 租户上限 + 有界队列，公平轮转防饿死。
// - Decision 4：wrapper 在副作用前 acquire、finally release。
// - Decision 5：观测低敏化，租户标签只用 scope hash。
// - Decision 6：P0 进程内 limiter，不依赖 Redis；多实例公平性仅预留接口。
//
// 时钟与调度抽象（FakeClock/TestScheduler）：为确定性测试注入可控时间源与 timer，
// 避免真实 setTimeout 导致测试 flaky。生产环境使用 SystemClock/SystemScheduler。
//
// 与 TenantConnectionPoolCatalog 的关系：catalog 是预算事实源，manager 消费 catalog
// 解析 budget 并执行 acquire/release；未登记资源 fail closed。

import TenantConnectionPoolCatalog from '#services/tenant_connection_pool_catalog'
import { ConnectionPoolUnavailableException } from '#exceptions/api_exception'
import {
  type TcpmAcquireRequest,
  type TcpmAcquireResult,
  type TcpmCircuitState,
  type TcpmDegradedReason,
  type TcpmPoolDecision,
  type TcpmPoolErrorCode,
  type TcpmPoolMetricsLabel,
  type TcpmTenantConnectionBudget,
  type TcpmTenantConnectionLease,
  TCPM_POOL_ERROR_CODES,
  tcpmBuildLease,
  tcpmBuildMetricsLabel,
  tcpmResolveBudget,
  tcpmValidateMetricsLabel,
} from '@aiproj/types/multitenant-connection-pool-management'
import type { TenantContext } from '@aiproj/types/multitenant-isolation-architecture'

// ──────────────────────────────────────────────
// 时钟与调度抽象（确定性测试 hook，§3.6 fake-clock）
// ──────────────────────────────────────────────

/**
 * 时钟抽象：返回当前单调毫秒时间。
 * 测试注入 FakeClock 控制时间；生产用 SystemClock。
 */
export interface PoolClock {
  now(): number
}

/** 生产时钟：Date.now()。 */
export class SystemPoolClock implements PoolClock {
  now(): number {
    return Date.now()
  }
}

/**
 * 调度抽象：延迟执行回调，返回可取消句柄。
 * 测试注入 TestScheduler 同步/受控触发；生产用 SystemScheduler（setTimeout）。
 */
export interface PoolScheduler {
  /** 延迟 delayMs 后执行 fn；返回取消函数。 */
  schedule(delayMs: number, fn: () => void): () => void
}

/** 生产调度器：setTimeout。 */
export class SystemPoolScheduler implements PoolScheduler {
  schedule(delayMs: number, fn: () => void): () => void {
    const id = setTimeout(fn, delayMs)
    return () => clearTimeout(id)
  }
}

/**
 * 测试用假时钟：时间不自动推进，需手动 tick()。
 * 配合 TestScheduler 使用，所有 schedule 的回调在 tick 时按到期顺序触发。
 */
export class FakePoolClock implements PoolClock {
  #now: number
  constructor(initial = 0) {
    this.#now = initial
  }
  now(): number {
    return this.#now
  }
  tick(ms: number): void {
    this.#now += ms
  }
  set(ms: number): void {
    this.#now = ms
  }
}

/**
 * 测试用调度器：不真正 setTimeout，记录所有 schedule 调用供测试断言。
 * 真正的受控等待由 PoolManager 的 #waiters 队列 + FakePoolClock.tick 驱动
 * （acquire 超时通过 tickForTest → purgeExpiredWaiters 触发，而非依赖此调度器）。
 * 本类仅在需要断言「manager 是否排定了超时检查」时使用。
 */
export class TestPoolScheduler implements PoolScheduler {
  readonly scheduled: { delayMs: number; cancelled: boolean }[] = []

  schedule(delayMs: number, _fn: () => void): () => void {
    const entry = { delayMs, cancelled: false }
    this.scheduled.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
}

// ──────────────────────────────────────────────
// 内部数据结构
// ──────────────────────────────────────────────

/** 一个等待中的 acquire 请求（已入队）。 */
interface WaitingAcquire {
  budget: TcpmTenantConnectionBudget
  operationKind: string
  requestId: string
  idempotencyKey?: string | null
  deadlineMs: number // 绝对到期时刻（clock.now + acquireTimeoutMs）
  enqueueAt: number
  abortSignal?: AbortSignal | null
  /** resolve/reject 由 acquire 调用方持有；manager 在 grant/timeout/reject 时调用 */
  resolve: (result: TcpmAcquireResult) => void
  /** 入队序号，用于稳定排序 */
  seq: number
  /**
   * 取消已排定的超时检查。waiter 被授予/超时/取消后必须调用，
   * 否则生产 setTimeout 会把 acquireTimeoutMs 期间的事件循环一直挂住。
   */
  cancelTimer?: () => void
}

/** 每个资源的运行态：活跃 lease + 等待队列 + circuit 状态。 */
interface PoolResourceState {
  /** 活跃 lease：leaseId → lease + organizationId */
  readonly active: Map<string, { lease: TcpmTenantConnectionLease; organizationId: number }>
  /** 每租户活跃计数 */
  readonly tenantActive: Map<number, number>
  /** 等待队列（按入队序号排序；公平轮转按租户分组） */
  waiters: WaitingAcquire[]
  /** circuit breaker 状态 */
  circuitState: TcpmCircuitState
  /** 连续失败计数（用于触发 open） */
  consecutiveFailures: number
  /** circuit open 起始时刻；resetTimeoutMs 后转 half_open */
  circuitOpenedAt: number
  /** half_open 状态下已发放的探测 lease 数 */
  halfOpenProbes: number
}

// ──────────────────────────────────────────────
// Pool Manager 选项
// ──────────────────────────────────────────────

export interface TenantConnectionPoolManagerOptions {
  clock?: PoolClock
  scheduler?: PoolScheduler
  /**
   * 低敏 metrics 发射回调（§4.5）。manager 在每个决策点调用。
   * 调用方负责注入 MetricsPort（生产 MemoryMetricsSink / 测试 TestMetricsSink）。
   */
  onMetrics?: (label: TcpmPoolMetricsLabel) => void
}

// ──────────────────────────────────────────────
// 非泄露异常
// ──────────────────────────────────────────────

/**
 * 连接池异常基类：非泄露错误体。
 * 不携带 provider 原始错误、连接串、token 或租户业务数据。
 * API 层（§6.5）据此映射 CONNECTION_POOL_* 错误码。
 */
export class TenantConnectionPoolError extends ConnectionPoolUnavailableException {
  readonly errorCode: TcpmPoolErrorCode

  /**
   * @param status HTTP 状态：默认 503（暂时不可用）。
   *   system scope 拒绝用 403——它是权限判定而非容量问题。
   */
  constructor(errorCode: TcpmPoolErrorCode, message: string, status = 503) {
    super(errorCode, message, status)
    this.errorCode = errorCode
  }
}

/**
 * 资源未登记（fail closed）。
 *
 * message 不回显 resourceKey：这些异常会经 ApiException 渲染给调用方，
 * 把 catalog 键回显出去等于让外部探测内部资源目录。键只留在实例属性上供服务端排错。
 */
export class ConnectionPoolResourceNotRegisteredException extends TenantConnectionPoolError {
  readonly resourceKey: string
  constructor(resourceKey: string) {
    super('CONNECTION_POOL_RESOURCE_NOT_REGISTERED', '连接资源不可用')
    this.resourceKey = resourceKey
  }
}

/** 连接池耗尽（队列满）。 */
export class ConnectionPoolExhaustedException extends TenantConnectionPoolError {
  constructor() {
    super('CONNECTION_POOL_EXHAUSTED', '连接池已耗尽，请稍后重试')
  }
}

/** acquire 超时。 */
export class ConnectionPoolTimeoutException extends TenantConnectionPoolError {
  constructor() {
    super('CONNECTION_POOL_TIMEOUT', '获取连接超时')
  }
}

/** 熔断打开。 */
export class ConnectionPoolCircuitOpenException extends TenantConnectionPoolError {
  constructor() {
    super('CONNECTION_POOL_CIRCUIT_OPEN', '连接熔断中，暂不可用')
  }
}

/** system scope 被拒（catalog 不允许）。 */
export class ConnectionPoolSystemScopeDeniedException extends TenantConnectionPoolError {
  readonly resourceKey: string
  constructor(resourceKey: string) {
    // 同上：不把 resourceKey 写进对外 message。
    super('CONNECTION_POOL_SYSTEM_SCOPE_DENIED', '不允许的维护范围', 403)
    this.resourceKey = resourceKey
  }
}

/**
 * 连接池降级异常：fallback_mode=degraded_local 且降级不可用时抛出。
 * 通常降级会返回 degraded lease 而非抛错；仅在降级路径也失败时使用。
 */
export class ConnectionPoolDegradedException extends TenantConnectionPoolError {
  constructor() {
    super('CONNECTION_POOL_DEGRADED', '连接降级模式不可用')
  }
}

// ──────────────────────────────────────────────
// TenantConnectionPoolManager
// ──────────────────────────────────────────────

/**
 * 租户连接池管理器：进程内逻辑 lease 治理。
 *
 * 核心不变量：
 * 1. 每个活跃 lease 同时占用「全局活跃」与「租户活跃」两个配额。
 * 2. acquire 时若租户或全局超额 → 入有界队列；队列满 → reject（不泄露其他租户状态）。
 * 3. release 幂等：同一 leaseId 多次 release 只减一次计数。
 * 4. 等待超时 / abort → 从队列移除，返回 timeout/cancelled，不占用活跃配额。
 * 5. circuit open 时新 acquire 直接拒绝（half_open 仅放行探测）。
 * 6. 所有决策点发射低敏 metrics label（scope hash，无组织名/邮箱/token）。
 */
export default class TenantConnectionPoolManager {
  readonly #clock: PoolClock
  readonly #scheduler: PoolScheduler
  readonly #onMetrics?: (label: TcpmPoolMetricsLabel) => void
  readonly #states = new Map<string, PoolResourceState>()
  #seq = 0
  #leaseCounter = 0

  constructor(options: TenantConnectionPoolManagerOptions = {}) {
    this.#clock = options.clock ?? new SystemPoolClock()
    this.#scheduler = options.scheduler ?? new SystemPoolScheduler()
    this.#onMetrics = options.onMetrics
  }

  // ── 内部辅助 ──

  #stateOf(resourceKey: string): PoolResourceState {
    let s = this.#states.get(resourceKey)
    if (!s) {
      s = {
        active: new Map(),
        tenantActive: new Map(),
        waiters: [],
        circuitState: 'closed',
        consecutiveFailures: 0,
        circuitOpenedAt: 0,
        halfOpenProbes: 0,
      }
      this.#states.set(resourceKey, s)
    }
    return s
  }

  /** 全局活跃总数（某 resource）。 */
  #globalActive(resourceKey: string): number {
    return this.#stateOf(resourceKey).active.size
  }

  /** 某租户在某 resource 的活跃数。 */
  #tenantActive(resourceKey: string, organizationId: number): number {
    return this.#stateOf(resourceKey).tenantActive.get(organizationId) ?? 0
  }

  #emitMetrics(params: {
    lease: TcpmTenantConnectionLease | null
    budget: TcpmTenantConnectionBudget
    decision: TcpmPoolDecision
    durationMs: number
    retryCount: number
    circuitState: TcpmCircuitState
    queueWaitMs: number
    timeoutMs: number
    actorRef: string
    /** 终态决策的低敏错误码（供审计分类，如 system scope denied vs 队列耗尽）。 */
    errorCode?: TcpmPoolErrorCode | null
    /** lease 为 null 的拒绝路径显式带上低敏 operationKind/requestId。 */
    operationKind?: string
    requestId?: string
    degradedReason?: TcpmDegradedReason | null
    /** system maintenance scope 标记（放行/拒绝都要落低敏审计）。 */
    isSystemScope?: boolean
  }): void {
    if (!this.#onMetrics) return
    const label = tcpmBuildMetricsLabel(params)
    // 防御性校验：若 label 含禁止字段则不发射（不应发生，纯函数已剔除）
    const violations = tcpmValidateMetricsLabel(label)
    if (violations.length > 0) return
    this.#onMetrics(label)
  }

  /** 生成唯一 leaseId。 */
  #nextLeaseId(): string {
    this.#leaseCounter += 1
    return `lease-${this.#leaseCounter}`
  }

  // ── circuit breaker ──

  /**
   * 检查 circuit 状态并按 resetTimeoutMs 推进 open→half_open。
   * 返回当前有效 circuit 状态。
   */
  #resolveCircuitState(state: PoolResourceState, resetTimeoutMs: number): TcpmCircuitState {
    if (state.circuitState === 'open') {
      if (this.#clock.now() - state.circuitOpenedAt >= resetTimeoutMs) {
        state.circuitState = 'half_open'
        state.halfOpenProbes = 0
      }
    }
    return state.circuitState
  }

  #tripCircuit(state: PoolResourceState, failureThreshold: number): void {
    state.consecutiveFailures += 1
    if (state.circuitState !== 'open' && state.consecutiveFailures >= failureThreshold) {
      state.circuitState = 'open'
      state.circuitOpenedAt = this.#clock.now()
      state.halfOpenProbes = 0
    }
  }

  #onSuccess(state: PoolResourceState): void {
    if (state.circuitState === 'half_open') {
      // 探测成功 → 恢复 closed
      state.circuitState = 'closed'
      state.consecutiveFailures = 0
      state.halfOpenProbes = 0
    } else if (state.circuitState === 'closed') {
      state.consecutiveFailures = 0
    }
  }

  // ── 队列公平轮转 ──

  /**
   * 从等待队列中按公平轮转选取下一个可授予的 waiter。
   * 公平策略：round-robin 按租户——每次授予跳过当前已轮到的租户，
   * 优先选择「当前活跃数最少」的租户的最早入队请求，防止单租户饿死其他租户。
   *
   * 简化实现：在所有 waiter 中，按（租户当前活跃数升序, 入队序号升序）选取。
   * 这保证活跃多的租户排队靠后，新租户总能插队获得首个 lease。
   */
  #pickNextWaiter(
    resourceKey: string,
    skipped?: ReadonlySet<WaitingAcquire>,
  ): WaitingAcquire | null {
    const state = this.#stateOf(resourceKey)
    const candidates = skipped ? state.waiters.filter((w) => !skipped.has(w)) : state.waiters
    if (candidates.length === 0) return null
    // 按「租户活跃数升序、入队序号升序」排序取第一个
    const sorted = [...candidates].sort((a, b) => {
      const ta = this.#tenantActive(resourceKey, a.budget.organizationId)
      const tb = this.#tenantActive(resourceKey, b.budget.organizationId)
      if (ta !== tb) return ta - tb
      return a.seq - b.seq
    })
    return sorted[0]
  }

  /**
   * 尝试授予队列中的 waiter（release 后调用）。
   * 按公平策略选取下一个可授予的 waiter。
   */
  #drainQueue(resourceKey: string): void {
    const state = this.#stateOf(resourceKey)
    // 先清理已过期/已取消的 waiter
    this.#purgeExpiredWaiters(resourceKey)
    if (state.waiters.length === 0) return

    const budget = state.waiters[0]?.budget
    if (!budget) return
    const circuitState = this.#resolveCircuitState(state, budget.circuitPolicy.resetTimeoutMs)
    if (circuitState === 'open') return // 熔断中不授予

    // 本轮无法授予的 waiter 记入 skipped 后不再重选。
    // 原实现只在「所有 waiter 同租户」时退出，否则 `continue` 会让排序结果原样再选一次
    // 同一个 waiter——只要有 ≥2 个租户同时触顶且全局配额尚有余量（globalLimit 大于
    // 当前活跃租户的 tenantLimit 之和，例如 env 调大 `*_GLOBAL_LIMIT` 后），
    // 这个循环就永不终止，release 调用会挂死整个进程。
    const skipped = new Set<WaitingAcquire>()
    while (state.waiters.length > 0) {
      // 检查全局配额（与具体 waiter 无关，放在挑选前）
      if (this.#globalActive(resourceKey) >= budget.globalLimit) break
      const next = this.#pickNextWaiter(resourceKey, skipped)
      if (!next) break
      if (this.#tenantActive(resourceKey, next.budget.organizationId) >= next.budget.tenantLimit) {
        // 该租户仍超额：本轮跳过它（授予只会让其他租户活跃数更高，不会解锁本项）
        skipped.add(next)
        continue
      }
      // half_open 限流：仅放行探测数
      if (
        circuitState === 'half_open' &&
        state.halfOpenProbes >= budget.circuitPolicy.halfOpenProbeLimit
      ) {
        break
      }
      // 从队列移除并授予
      const idx = state.waiters.indexOf(next)
      if (idx === -1) break
      state.waiters.splice(idx, 1)
      if (circuitState === 'half_open') state.halfOpenProbes += 1
      this.#grant(next)
    }
  }

  /** 授予一个 waiter lease。 */
  #grant(waiter: WaitingAcquire): void {
    waiter.cancelTimer?.()
    const lease = tcpmBuildLease({
      leaseId: this.#nextLeaseId(),
      budget: waiter.budget,
      operationKind: waiter.operationKind,
      requestId: waiter.requestId,
      idempotencyKey: waiter.idempotencyKey,
      deadlineMs: this.#clock.now() + waiter.budget.operationTimeoutMs,
      grantedAt: this.#clock.now(),
      queueWaitMs: this.#clock.now() - waiter.enqueueAt,
    })
    const state = this.#stateOf(waiter.budget.resourceKey)
    state.active.set(lease.leaseId, { lease, organizationId: waiter.budget.organizationId })
    state.tenantActive.set(
      waiter.budget.organizationId,
      (state.tenantActive.get(waiter.budget.organizationId) ?? 0) + 1,
    )

    const queueWaitMs = this.#clock.now() - waiter.enqueueAt
    this.#emitMetrics({
      lease,
      budget: waiter.budget,
      decision: 'granted',
      durationMs: 0,
      retryCount: 0,
      circuitState: state.circuitState,
      queueWaitMs,
      timeoutMs: waiter.budget.operationTimeoutMs,
      actorRef: waiter.budget.scopeHash, // 低敏 actor ref 用 scope hash
    })
    waiter.resolve({ decision: 'granted', lease, queueWaitMs })
  }

  /** 清理已过期或已 abort 的 waiter，触发它们的 timeout/cancelled 决策。 */
  #purgeExpiredWaiters(resourceKey: string): void {
    const state = this.#stateOf(resourceKey)
    const now = this.#clock.now()
    const remaining: WaitingAcquire[] = []
    for (const w of state.waiters) {
      const expired = now >= w.deadlineMs
      const aborted = w.abortSignal?.aborted === true
      if (expired || aborted) {
        w.cancelTimer?.()
        const decision: TcpmPoolDecision = aborted ? 'cancelled' : 'timeout'
        const errorCode: TcpmPoolErrorCode | undefined = aborted
          ? undefined
          : 'CONNECTION_POOL_TIMEOUT'
        const queueWaitMs = now - w.enqueueAt
        this.#emitMetrics({
          lease: null,
          budget: w.budget,
          decision,
          durationMs: queueWaitMs,
          retryCount: 0,
          circuitState: state.circuitState,
          queueWaitMs,
          timeoutMs: w.budget.acquireTimeoutMs,
          actorRef: w.budget.scopeHash,
          errorCode,
          operationKind: w.operationKind,
          requestId: w.requestId,
        })
        w.resolve({
          decision,
          lease: null,
          queueWaitMs,
          errorCode,
        })
      } else {
        remaining.push(w)
      }
    }
    state.waiters = remaining
  }

  // ── 公共 API ──

  /**
   * 申请连接 lease（异步）。
   *
   * - 立即可授予 → resolve granted
   * - 需排队 → 入有界队列，等待 release 唤醒或超时/abort
   * - 队列满 / circuit open / system scope 拒绝 → resolve rejected/circuit_open（非抛错）
   * - 资源未登记 → reject（fail closed）
   *
   * 返回 Promise<TcpmAcquireResult>；调用方据 decision 处理。
   * 异常路径（资源未登记）reject，以便调用方 fail fast。
   */
  acquire(request: TcpmAcquireRequest): Promise<TcpmAcquireResult> {
    const startMs = this.#clock.now()
    const resourceKey = request.resourceKey

    // fail closed：未登记资源
    if (!TenantConnectionPoolCatalog.has(resourceKey)) {
      return Promise.reject(new ConnectionPoolResourceNotRegisteredException(resourceKey))
    }
    const entry = TenantConnectionPoolCatalog.get(resourceKey)
    const tenant: TenantContext = request.tenant

    const budget = tcpmResolveBudget(entry, tenant, {
      operationTimeoutMs: request.deadlineMs,
    })

    // system scope 校验：仅 catalog 显式允许才放行
    const isSystemScope = request.isSystemScope === true || tenant.scopeMode === 'system_global'
    if (isSystemScope && !entry.systemScopeAllowed) {
      // 拒绝路径同样发射低敏 metrics，供 §4.6 审计把 system scope 拒绝与队列耗尽区分开。
      this.#emitMetrics({
        lease: null,
        budget,
        decision: 'rejected',
        durationMs: this.#clock.now() - startMs,
        retryCount: 0,
        circuitState: this.circuitState(resourceKey),
        queueWaitMs: 0,
        timeoutMs: budget.acquireTimeoutMs,
        actorRef: tenant.actorRef,
        errorCode: 'CONNECTION_POOL_SYSTEM_SCOPE_DENIED',
        operationKind: request.operationKind,
        requestId: request.requestId,
        isSystemScope: true,
      })
      return Promise.resolve({
        decision: 'rejected',
        lease: null,
        queueWaitMs: 0,
        errorCode: 'CONNECTION_POOL_SYSTEM_SCOPE_DENIED',
      })
    }

    const state = this.#stateOf(resourceKey)
    const circuitState = this.#resolveCircuitState(state, budget.circuitPolicy.resetTimeoutMs)

    // circuit open：直接拒绝（不排队）
    if (circuitState === 'open') {
      this.#emitMetrics({
        lease: null,
        budget,
        decision: 'circuit_open',
        durationMs: this.#clock.now() - startMs,
        retryCount: 0,
        circuitState: 'open',
        queueWaitMs: 0,
        timeoutMs: budget.acquireTimeoutMs,
        actorRef: tenant.actorRef,
        errorCode: 'CONNECTION_POOL_CIRCUIT_OPEN',
        operationKind: request.operationKind,
        requestId: request.requestId,
        degradedReason: 'circuit_open',
        isSystemScope,
      })
      return Promise.resolve({
        decision: 'circuit_open',
        lease: null,
        queueWaitMs: 0,
        errorCode: 'CONNECTION_POOL_CIRCUIT_OPEN',
      })
    }

    // half_open 限流：仅放行探测数
    if (
      circuitState === 'half_open' &&
      state.halfOpenProbes >= budget.circuitPolicy.halfOpenProbeLimit
    ) {
      // 排队等待（探测 lease 释放后可能转 open 或 closed）
    } else if (
      this.#globalActive(resourceKey) < budget.globalLimit &&
      this.#tenantActive(resourceKey, budget.organizationId) < budget.tenantLimit
    ) {
      // 立即可授予
      if (circuitState === 'half_open') state.halfOpenProbes += 1
      return Promise.resolve(this.#grantSync(budget, request, startMs, isSystemScope))
    }

    // 需要排队：先检查队列上限
    if (state.waiters.length >= budget.queueLimit) {
      this.#emitMetrics({
        lease: null,
        budget,
        decision: 'rejected',
        durationMs: this.#clock.now() - startMs,
        retryCount: 0,
        circuitState,
        queueWaitMs: 0,
        timeoutMs: budget.acquireTimeoutMs,
        actorRef: tenant.actorRef,
        errorCode: 'CONNECTION_POOL_EXHAUSTED',
        operationKind: request.operationKind,
        requestId: request.requestId,
        isSystemScope,
      })
      return Promise.resolve({
        decision: 'rejected',
        lease: null,
        queueWaitMs: 0,
        errorCode: 'CONNECTION_POOL_EXHAUSTED',
      })
    }

    // 入队
    return new Promise<TcpmAcquireResult>((resolve) => {
      const deadlineMs = this.#clock.now() + budget.acquireTimeoutMs
      const waiter: WaitingAcquire = {
        budget,
        operationKind: request.operationKind,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        deadlineMs,
        enqueueAt: this.#clock.now(),
        abortSignal: request.abortSignal ?? null,
        resolve,
        seq: this.#seq++,
      }
      state.waiters.push(waiter)

      // 设置超时定时器（生产用 scheduler；测试用 fake clock + purge 驱动）
      if (request.abortSignal) {
        request.abortSignal.addEventListener(
          'abort',
          () => {
            this.#purgeExpiredWaiters(resourceKey)
          },
          { once: true },
        )
      }
      // 生产环境用 scheduler 排定超时检查；测试靠 tick + drain/purge 触发。
      // 句柄挂到 waiter 上：授予/超时/取消时必须取消，否则生产 setTimeout 会把
      // acquireTimeoutMs 期间的事件循环一直挂住（测试进程也会因此迟迟不退出）。
      waiter.cancelTimer = this.#scheduler.schedule(budget.acquireTimeoutMs, () => {
        this.#purgeExpiredWaiters(resourceKey)
      })
    })
  }

  /** 同步授予 lease（acquire 立即可授予路径）。 */
  #grantSync(
    budget: TcpmTenantConnectionBudget,
    request: TcpmAcquireRequest,
    startMs: number,
    isSystemScope = false,
  ): TcpmAcquireResult {
    const lease = tcpmBuildLease({
      leaseId: this.#nextLeaseId(),
      budget,
      operationKind: request.operationKind,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      deadlineMs: this.#clock.now() + budget.operationTimeoutMs,
      grantedAt: this.#clock.now(),
      queueWaitMs: this.#clock.now() - startMs,
    })
    const state = this.#stateOf(budget.resourceKey)
    state.active.set(lease.leaseId, { lease, organizationId: budget.organizationId })
    state.tenantActive.set(
      budget.organizationId,
      (state.tenantActive.get(budget.organizationId) ?? 0) + 1,
    )
    this.#emitMetrics({
      lease,
      budget,
      decision: 'granted',
      durationMs: this.#clock.now() - startMs,
      retryCount: 0,
      circuitState: state.circuitState,
      queueWaitMs: lease.queueWaitMs,
      timeoutMs: budget.operationTimeoutMs,
      actorRef: budget.scopeHash,
      isSystemScope,
    })
    return { decision: 'granted', lease, queueWaitMs: lease.queueWaitMs }
  }

  /**
   * 释放 lease（幂等）。
   * 同一 leaseId 多次 release 只减一次计数。
   * success 标记操作是否成功（失败用于 circuit breaker 计数）。
   */
  release(lease: TcpmTenantConnectionLease, options?: { success?: boolean }): void {
    const state = this.#stateOf(lease.resourceKey)
    const entry = state.active.get(lease.leaseId)
    if (!entry) {
      // 幂等：已释放或未知 lease，忽略
      return
    }
    state.active.delete(lease.leaseId)
    const cur = state.tenantActive.get(entry.organizationId) ?? 0
    state.tenantActive.set(entry.organizationId, Math.max(0, cur - 1))

    const success = options?.success ?? true
    if (success) {
      this.#onSuccess(state)
    } else if (TenantConnectionPoolCatalog.has(lease.resourceKey)) {
      const failureThreshold = TenantConnectionPoolCatalog.get(lease.resourceKey).circuitPolicy
        .failureThreshold
      this.#tripCircuit(state, failureThreshold)
    }

    this.#emitMetrics({
      lease,
      budget: {
        resourceKey: lease.resourceKey,
        poolKind: lease.poolKind,
        tenantLimit: 0,
        globalLimit: 0,
        queueLimit: 0,
        acquireTimeoutMs: 0,
        operationTimeoutMs: lease.deadlineMs - lease.grantedAt,
        scopeHash: lease.scopeHash,
        organizationId: lease.organizationId,
        projectId: lease.projectId,
        scopeMode: 'organization_scoped',
        isSystemScope: false,
        retryPolicy: { maxRetries: 0, initialBackoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 },
        circuitPolicy: { failureThreshold: 5, resetTimeoutMs: 0, halfOpenProbeLimit: 1 },
        fallbackMode: 'fail_closed',
      },
      decision: 'released',
      durationMs: this.#clock.now() - lease.grantedAt,
      retryCount: 0,
      circuitState: state.circuitState,
      queueWaitMs: lease.queueWaitMs,
      timeoutMs: lease.deadlineMs - lease.grantedAt,
      actorRef: lease.scopeHash,
    })

    // 释放后尝试授予队列中的 waiter
    this.#drainQueue(lease.resourceKey)
  }

  /**
   * 报告操作失败（不释放 lease，仅累计 circuit 失败）。
   * 用于 wrapper 捕获 provider 错误后通知 manager。
   */
  reportFailure(resourceKey: string): void {
    if (!TenantConnectionPoolCatalog.has(resourceKey)) return
    const entry = TenantConnectionPoolCatalog.get(resourceKey)
    const state = this.#stateOf(resourceKey)
    this.#tripCircuit(state, entry.circuitPolicy.failureThreshold)
  }

  /**
   * 报告操作成功（重置 circuit 失败计数）。
   */
  reportSuccess(resourceKey: string): void {
    if (!TenantConnectionPoolCatalog.has(resourceKey)) return
    const state = this.#stateOf(resourceKey)
    this.#onSuccess(state)
  }

  // ── 观测辅助（测试与 diagnostics 用，低敏） ──

  /** 当前某 resource 的全局活跃数（低敏聚合，不含租户细节）。 */
  activeCount(resourceKey: string): number {
    return this.#globalActive(resourceKey)
  }

  /** 当前某 resource 的等待队列长度（低敏聚合）。 */
  queueLength(resourceKey: string): number {
    return this.#stateOf(resourceKey).waiters.length
  }

  /** 当前某 resource 的 circuit 状态（低敏）。 */
  circuitState(resourceKey: string): TcpmCircuitState {
    const state = this.#states.get(resourceKey)
    if (!state) return 'closed'
    return state.circuitState
  }

  /**
   * 推进时间（仅 FakeClock 测试用）。
   * 触发所有 waiter 的超时检查与队列 drain。
   */
  tickForTest(ms: number): void {
    if (this.#clock instanceof FakePoolClock) {
      this.#clock.tick(ms)
    }
    // 清理所有 resource 的过期 waiter
    for (const key of this.#states.keys()) {
      this.#purgeExpiredWaiters(key)
    }
  }

  /** 重置全部状态（测试隔离用）。 */
  reset(): void {
    this.#states.clear()
    this.#seq = 0
    this.#leaseCounter = 0
  }
}

// 导出错误码常量供 API 层引用
export { TCPM_POOL_ERROR_CODES }
