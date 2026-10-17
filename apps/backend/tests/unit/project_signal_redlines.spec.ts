// v3-triz-contradiction-copilot tasks 3.5 —— 被动雷达红线护栏测试。
//
// 四条硬边界（design D9 + AGENTS.md §6 裁剪）在本文件被固化成可执行门禁：
// ① 不存在任何 S 曲线 / 进化法则阶段类信号类型（扫描信号类型闭集 + 迁移 CHECK + 代码字面量）；
// ② 雷达数据源不引用打卡 / 考勤 / 独立工时日志类实体或字段（扫描 import 与查询字段）；
// ③ 证据与呈现契约中无个人维度度量或排名（静态扫描 + 运行期递归键扫描）；
// ④ 检测链路无业务表写入（静态扫描 + 探针自检，附防空转与负向对照）。
// ⑤ 负向验证：人为注入一条禁用信号类型 / 一个个人维度键 → 护栏必须失败。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvmIndicators } from '#services/project_evm_service'
import type { ResourceLoadResult } from '#services/resource_load_service'
import ProgressDeviationDetector from '#services/project_signal/progress_deviation_detector'
import RiskSurgeDetector from '#services/project_signal/risk_surge_detector'
import ResourceOverloadDetector from '#services/project_signal/resource_overload_detector'
import MilestoneSlipDetector from '#services/project_signal/milestone_slip_detector'
import ProjectSignalDetectionService from '#services/project_signal/project_signal_detection_service'
import type {
  MilestoneSlipFacts,
  RiskSurgeFacts,
} from '#services/project_signal/project_signal_metrics_service'
import {
  PROJECT_SIGNAL_TYPE_LABELS,
  PROJECT_SIGNAL_TYPES,
  resolveSignalObservationWindows,
} from '#services/project_signal/signal_contracts'
import { test } from '@japa/runner'

const BACKEND_ROOT = process.cwd()

/** 检测链路文件（只读检测的全部组成；不得出现任何写动词）。 */
const DETECTION_CHAIN_FILES = [
  'app/services/project_signal/signal_contracts.ts',
  'app/services/project_signal/signal_thresholds.ts',
  'app/services/project_signal/signal_permissions.ts',
  'app/services/project_signal/confidence_tier.ts',
  'app/services/project_signal/project_signal_metrics_service.ts',
  'app/services/project_signal/progress_deviation_detector.ts',
  'app/services/project_signal/risk_surge_detector.ts',
  'app/services/project_signal/resource_overload_detector.ts',
  'app/services/project_signal/milestone_slip_detector.ts',
  'app/services/project_signal/project_signal_detection_service.ts',
]

/** HTTP / 策略层（同样不得直接写数据）。 */
const API_FILES = [
  'app/controllers/project_signals_controller.ts',
  'app/policies/project_signal_policy.ts',
  'app/validators/project_signal.ts',
]

/** 雷达全部新增文件（含唯一写入面 `project_signal_service.ts`）。 */
const RADAR_FILES = [
  ...DETECTION_CHAIN_FILES,
  ...API_FILES,
  'app/services/project_signal/project_signal_service.ts',
]

const MIGRATION_FILE = 'database/migrations/1997010000000_create_project_signals_table.ts'

function read(relative: string): string {
  return readFileSync(join(BACKEND_ROOT, relative), 'utf8')
}

/** 去注释：行注释 + 块注释（说明文字里的反例不是实现）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ---------------------------------------------------------------------------
// 护栏 ①：禁用信号类型
// ---------------------------------------------------------------------------

/** 一期明文排除的信号类型语汇（S 曲线 / 进化法则阶段 / 成熟度内卷等，二期候选）。 */
const FORBIDDEN_SIGNAL_TYPE_TOKENS = [
  's_curve',
  'scurve',
  's-curve',
  'evolution',
  'evolutionary',
  'law_of',
  'lifecycle_stage',
  'stage_signal',
  'maturity',
  'technological_evolution',
]

/** 纯函数护栏：给定信号类型集合，返回其中命中禁用语汇的类型（空数组 = 通过）。 */
export function findForbiddenSignalTypes(types: readonly string[]): string[] {
  return types.filter((type) => {
    const normalized = type.toLowerCase()
    return FORBIDDEN_SIGNAL_TYPE_TOKENS.some((token) => normalized.includes(token))
  })
}

/** 源码级护栏：给定源码文本，返回命中的禁用类型字面量（用于负向注入验证）。 */
export function scanSourceForForbiddenSignalTypes(source: string): string[] {
  const clean = stripComments(source)
  const hits: string[] = []
  for (const match of clean.matchAll(/['"]([a-z0-9_-]+)['"]/g)) {
    const literal = match[1]!
    if (findForbiddenSignalTypes([literal]).length > 0) hits.push(literal)
  }
  return [...new Set(hits)]
}

test.group('护栏 ① 无 S 曲线 / 进化法则类信号', () => {
  test('信号类型闭集恰为四类硬信号，且不含禁用语汇', ({ assert }) => {
    assert.deepEqual(
      [...PROJECT_SIGNAL_TYPES],
      ['progress_deviation', 'risk_surge', 'resource_overload', 'milestone_slip'],
    )
    assert.deepEqual(findForbiddenSignalTypes(PROJECT_SIGNAL_TYPES), [])
    assert.deepEqual(
      Object.keys(PROJECT_SIGNAL_TYPE_LABELS).sort(),
      [...PROJECT_SIGNAL_TYPES].sort(),
    )
  })

  test('迁移 CHECK 闭集与类型常量一致（库层同护栏）', ({ assert }) => {
    const migration = stripComments(read(MIGRATION_FILE))
    assert.include(
      migration,
      "signal_type IN ('progress_deviation','risk_surge','resource_overload','milestone_slip')",
    )
    for (const forbidden of ['s_curve', 'evolution', 'maturity']) {
      assert.notInclude(migration, forbidden, `迁移不得放行 ${forbidden}`)
    }
  })

  test('雷达源码中不出现禁用类型字面量（扫描全部新增文件）', ({ assert }) => {
    for (const file of RADAR_FILES) {
      const hits = scanSourceForForbiddenSignalTypes(read(file))
      assert.deepEqual(hits, [], `${file} 出现禁用信号类型字面量：${hits.join(', ')}`)
    }
  })

  test('负向验证：人为注入 S 曲线阶段类信号类型时护栏失败', ({ assert }) => {
    assert.deepEqual(findForbiddenSignalTypes(['progress_deviation', 's_curve_stage']), [
      's_curve_stage',
    ])
    assert.deepEqual(findForbiddenSignalTypes(['technological_evolution_phase']), [
      'technological_evolution_phase',
    ])
    const injected = `export const PROJECT_SIGNAL_TYPES = ['progress_deviation', 's_curve_stage'] as const`
    assert.isNotEmpty(
      scanSourceForForbiddenSignalTypes(injected),
      '注入的禁用类型必须被源码扫描器识别（护栏非空转）',
    )
    assert.isEmpty(scanSourceForForbiddenSignalTypes(stripComments(read(RADAR_FILES[0]!))))
  })
})

// ---------------------------------------------------------------------------
// 护栏 ②：禁用数据源
// ---------------------------------------------------------------------------

/** 打卡 / 考勤 / 签到 / 独立工时日志类实体或字段语汇（AGENTS.md §6 裁剪）。 */
const FORBIDDEN_DATASOURCE_TOKENS = [
  'attendance',
  'check_in',
  'checkin',
  'punch_',
  'timesheet',
  'time_sheet',
  'worklog',
  'work_log',
  'time_entry',
  'timeentry',
  'clock_in',
  'laborhour',
  'labor_hour',
  '考勤',
  '打卡',
  '签到',
  '工时日志',
]

/** 允许被雷达读取的模型白名单（全部为既有业务域模型，无打卡/考勤/工时日志模型）。 */
const ALLOWED_MODELS = new Set([
  'Project',
  'Risk',
  'RiskHistory',
  'Issue',
  'Milestone',
  'GanttBaseline',
  'ProjectSignal',
  'TrizCopilotAnalysis',
  'User',
])

function referencedModels(source: string): string[] {
  const clean = stripComments(source)
  const models: string[] = []
  for (const match of clean.matchAll(/from '#models\/([a-z0-9_]+)\.js'/g)) {
    models.push(camel(match[1]!))
  }
  return [...new Set(models)]
}

function camel(snake: string): string {
  return snake
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

test.group('护栏 ② 数据源不引用打卡 / 考勤 / 独立工时日志', () => {
  test('雷达新增文件不出现禁用数据源语汇', ({ assert }) => {
    for (const file of RADAR_FILES) {
      const clean = stripComments(read(file)).toLowerCase()
      const hits = FORBIDDEN_DATASOURCE_TOKENS.filter((token) => clean.includes(token))
      assert.deepEqual(hits, [], `${file} 引用禁用数据源：${hits.join(', ')}`)
    }
  })

  test('雷达读取的模型全部在业务白名单内（无考勤/工时类实体）', ({ assert }) => {
    for (const file of RADAR_FILES) {
      for (const model of referencedModels(read(file))) {
        assert.isTrue(ALLOWED_MODELS.has(model), `${file} 引用了白名单外的模型：${model}`)
      }
    }
  })

  test('负向验证：注入打卡类实体引用时护栏失败', ({ assert }) => {
    const injected = `import Attendance from '#models/attendance.js'\nconst rows = await Attendance.query()`
    const models = referencedModels(injected)
    assert.deepEqual(models, ['Attendance'])
    assert.isFalse(ALLOWED_MODELS.has(models[0]!), '注入的考勤模型必须被白名单拒绝')

    const injectedField = `Risk.query().select('id', 'employee_attendance_ratio')`
    const clean = stripComments(injectedField).toLowerCase()
    assert.isTrue(FORBIDDEN_DATASOURCE_TOKENS.some((token) => clean.includes(token)))
  })
})

// ---------------------------------------------------------------------------
// 护栏 ③：无个人维度度量或排名
// ---------------------------------------------------------------------------

/** 个人维度度量 / 排名键（证据与呈现契约中一律禁止）。 */
const FORBIDDEN_PERSONAL_KEYS = [
  'resourceid',
  'resourcename',
  'userid',
  'assigneeid',
  'assignee',
  'ownerid',
  'memberid',
  'membername',
  'fullname',
  'email',
  'personname',
  'employeeid',
  'employeename',
  'rank',
  'ranking',
  'leaderboard',
  'personal',
  'individual',
  'overworkhours',
  '个人',
  '排名',
]

/** 递归收集对象的所有键（含嵌套数组），小写化后比对禁用键。 */
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, acc)
    return acc
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      acc.add(key.toLowerCase())
      collectKeys(inner, acc)
    }
  }
  return acc
}

/** 纯函数护栏：返回命中禁用个人维度键的键名（空数组 = 通过）。 */
export function findForbiddenPersonalKeys(value: unknown): string[] {
  const keys = [...collectKeys(value)]
  return keys.filter((key) => FORBIDDEN_PERSONAL_KEYS.some((token) => key.includes(token)))
}

test.group('护栏 ③ 证据只到团队 / 资源聚合粒度', () => {
  test('静态：检测器源码不出现个人维度度量键', ({ assert }) => {
    for (const file of [
      'app/services/project_signal/resource_overload_detector.ts',
      'app/services/project_signal/progress_deviation_detector.ts',
      'app/services/project_signal/risk_surge_detector.ts',
      'app/services/project_signal/milestone_slip_detector.ts',
      'app/services/project_signal/project_signal_metrics_service.ts',
      'app/services/project_signal/confidence_tier.ts',
      'app/services/project_signal/signal_contracts.ts',
    ]) {
      const clean = stripComments(read(file)).toLowerCase()
      const hits = FORBIDDEN_PERSONAL_KEYS.filter((token) => clean.includes(token))
      assert.deepEqual(hits, [], `${file} 出现个人维度键：${hits.join(', ')}`)
    }
  })

  test('运行期：四类信号证据递归扫描无个人维度键', async ({ assert }) => {
    const result = await forbiddenKeyProbe().detect({
      organizationId: 1,
      projectId: 1,
      asOfDate: '2026-09-07',
    })
    assert.lengthOf(result.signals, 4)
    for (const signal of result.signals) {
      assert.deepEqual(
        findForbiddenPersonalKeys(signal.evidence),
        [],
        `${signal.signalType} 证据含个人维度键`,
      )
      assert.deepEqual(findForbiddenPersonalKeys(signal.evidence.readings), [])
    }
  })

  test('负向验证：注入个人维度键时护栏失败', ({ assert }) => {
    assert.deepEqual(findForbiddenPersonalKeys({ overloadRatioPercent: 50 }), [])
    assert.deepEqual(findForbiddenPersonalKeys({ resources: [{ resourceId: 3 }] }), ['resourceid'])
    assert.deepEqual(findForbiddenPersonalKeys({ topPerformers: [{ rank: 1 }, { rank: 2 }] }), [
      'rank',
    ])
  })
})

// ---------------------------------------------------------------------------
// 护栏 ④：检测链路无业务表写入（静态 + 探针）
// ---------------------------------------------------------------------------

const WRITE_VERB = /\.(create|save|update|delete|insert|upsert|truncate|increment|decrement)\(/

/**
 * 纯计算例外：`node:crypto` 的哈希链 `createHash('sha256').update(...)` 不是数据写入。
 * 先把它折叠成中性记号再扫描，避免把「计算摘要」误判成「写表」。
 */
const CRYPTO_HASH_CHAIN = /createHash\([^)]*\)\s*\.update\(/g

function withoutCryptoChains(source: string): string {
  return source.replace(CRYPTO_HASH_CHAIN, 'hashOf(')
}

test.group('护栏 ④ 检测链路零业务表写入', () => {
  test('静态：检测链路与 API 层无任何写动词', ({ assert }) => {
    for (const file of [...DETECTION_CHAIN_FILES, ...API_FILES]) {
      const clean = withoutCryptoChains(stripComments(read(file)))
      assert.notMatch(clean, WRITE_VERB, `${file} 出现写动词（检测链路必须只读）`)
    }
  })

  test('静态：唯一的写动词落在信号表自身与其采纳关联上（不碰业务表）', ({ assert }) => {
    const clean = withoutCryptoChains(
      stripComments(read('app/services/project_signal/project_signal_service.ts')),
    )
    const writeLines = clean
      .split(/\r?\n/)
      .filter((line) => WRITE_VERB.test(line))
      .map((line) => line.trim())

    assert.isAbove(writeLines.length, 0, '持久化服务应包含信号表写入（防空转）')
    for (const line of writeLines) {
      const allowed =
        line.includes('ProjectSignal.create(') ||
        line.includes('existing.save()') ||
        line.includes('record.save()') ||
        line.includes('target.save()') ||
        line.includes('record.status') ||
        line.includes('TrizCopilotAnalysis.query()') ||
        line.includes('.update({ source_signal_id')
      assert.isTrue(allowed, `出现未登记的写入点：${line}`)
    }
    // 业务表（任务 / 风险 / 议题 / 里程碑 / 资源分配）在雷达中没有任何写入点
    for (const businessModel of [
      'Task',
      'Risk',
      'Issue',
      'Milestone',
      'Resource',
      'ResourceAllocation',
    ]) {
      assert.notInclude(clean, `${businessModel}.create(`)
      assert.notInclude(clean, `${businessModel}.query().update(`)
    }
  })

  test('探针自检：检测链路调用的方法名全为只读方法，且四类检测器真实执行（防空转）', async ({
    assert,
  }) => {
    const calls: string[] = []
    const service = probeService(calls)
    const result = await service.detect({
      organizationId: 1,
      projectId: 1,
      asOfDate: '2026-09-07',
      evaluatedAt: '2026-09-07T00:00:00.000Z',
    })

    assert.equal(result.detectorRuns, 4, '四个检测器都必须被执行（防空转）')
    assert.isAtLeast(calls.length, 3, '至少要有真实的只读读取调用（防空转）')
    const writes = calls.filter((name) => WRITE_VERB.test(`.${name}(`))
    assert.deepEqual(writes, [], `检测链路调用了写方法：${writes.join(', ')}`)
    for (const call of calls) {
      assert.isTrue(
        [
          'getIndicators',
          'load',
          'loadRiskSurgeFacts',
          'loadMilestoneSlipFacts',
          'evaluate',
        ].includes(call),
        `未登记的调用：${call}`,
      )
    }
  })

  test('负向对照：探针能捕获写方法（证明探针非空转）', ({ assert }) => {
    const calls: string[] = []
    const probing = recording({ create: () => 'x', save: () => 'y' }, calls)
    const sabotage = probing as unknown as { create: () => string }
    sabotage.create()
    const writes = calls.filter((name) => WRITE_VERB.test(`.${name}(`))
    assert.deepEqual(writes, ['create'], '写入探针必须能捕获写调用')
  })
})

// ---------------------------------------------------------------------------
// 探针与假件
// ---------------------------------------------------------------------------

const WINDOWS = resolveSignalObservationWindows('2026-09-07', 7)

function recording<T extends object>(target: T, calls: string[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          calls.push(String(prop))
          return (value as (...inner: unknown[]) => unknown).apply(obj, args)
        }
      }
      return value
    },
  })
}

function indicators(spi: number): EvmIndicators {
  return {
    projectId: 1,
    asOfDate: WINDOWS.current.to,
    hasBaseline: true,
    bac: 1_000_000,
    pv: 500_000,
    ev: 450_000,
    ac: 400_000,
    cv: 0,
    sv: -50_000,
    cpi: 1,
    spi,
    etc: 0,
    eac: 0,
    vac: 0,
    tcpi: 1,
    scheduleStatus: spi < 0.95 ? 'delayed' : 'on_track',
    costStatus: 'on_track',
  }
}

/** 四类检测器全部命中的探针装配（依赖全部为只读假件，记录调用名）。 */
function probeService(calls: string[]): ProjectSignalDetectionService {
  const overloadedLoad = (): ResourceLoadResult => ({
    from: WINDOWS.current.from,
    to: WINDOWS.current.to,
    teamAverageUtilizationPercent: 88,
    resources: [0, 1, 2, 3].map((index) => ({
      resourceId: index + 1,
      resourceName: `R${index + 1}`,
      role: 'member',
      dailyCapacityHours: 8,
      overallUtilizationPercent: index < 3 ? 160 : 50,
      days: [
        {
          date: WINDOWS.current.from,
          totalAllocatedPercent: index < 3 ? 160 : 50,
          allocatedHours: index < 3 ? 14 : 4,
          capacityHours: 8,
        },
      ],
    })),
  })

  const riskFacts: RiskSurgeFacts = {
    windows: WINDOWS.all.map((window, index) => ({
      window,
      newRisks: [12, 6, 6][index] ?? 0,
      newHighRisks: [3, 1, 1][index] ?? 0,
      activeRisks: [12, 6, 6][index] ?? 0,
      newSevereDefects: [6, 2, 2][index] ?? 0,
      newRiskIds: [1, 2, 3],
      newHighRiskIds: [1],
      severeDefectIds: [7, 8],
      activeTruncated: false,
    })),
    truncated: false,
  }

  const milestoneFacts: MilestoneSlipFacts = {
    hasBaseline: true,
    baselineSavedAt: '2026-08-01T00:00:00.000Z',
    milestones: [
      { id: 1, plannedDate: '2026-10-01', baselinePlannedDate: '2026-09-01', slipDays: 30 },
      { id: 2, plannedDate: '2026-10-05', baselinePlannedDate: '2026-09-20', slipDays: 15 },
    ],
    baselineCoveredCount: 2,
    missingPlannedDateCount: 0,
    noBaselineReason: null,
    truncated: false,
  }

  return new ProjectSignalDetectionService({
    progressDetector: new ProgressDeviationDetector({
      evmService: recording(
        {
          async getIndicators(): Promise<EvmIndicators> {
            return indicators(0.8)
          },
        },
        calls,
      ),
    }),
    riskDetector: new RiskSurgeDetector({
      metricsService: recording(
        {
          async loadRiskSurgeFacts(): Promise<RiskSurgeFacts> {
            return riskFacts
          },
        },
        calls,
      ),
    }),
    resourceDetector: new ResourceOverloadDetector({
      resourceLoadService: recording(
        {
          async load(): Promise<ResourceLoadResult> {
            return overloadedLoad()
          },
        },
        calls,
      ),
    }),
    milestoneDetector: new MilestoneSlipDetector({
      metricsService: recording(
        {
          async loadMilestoneSlipFacts(): Promise<MilestoneSlipFacts> {
            return milestoneFacts
          },
        },
        calls,
      ),
    }),
  })
}

/** 负向探针复用的检测编排（四类全命中）；命名为 `forbiddenKeyProbe` 以表意。 */
function forbiddenKeyProbe(): ProjectSignalDetectionService {
  const calls: string[] = []
  return probeService(calls)
}
