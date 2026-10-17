/**
 * v2-5-compiler-execution-gap-benchmark —— 报告生成（tasks 4.4, 4.5, 4.6）。
 *
 * spec「输出必须同时面向机器与评审者」：JSON 与 Markdown **必须**由同一个
 * `BenchmarkResult` 渲染。Markdown 里出现的每个分类与指标都能在 JSON 找到，
 * 由 `resolveResultRef` 提供可执行的回溯路径，`compiler_execution_gap_benchmark.spec.ts`
 * 据此把「两者一致」变成门禁而非承诺。
 */

import { BENCHMARK_ID, BENCHMARK_SCHEMA_VERSION, benchmarkResultSchema } from './schema.js'
import { GAP_CLASSIFICATIONS, GAP_DISPLAY_NAMES } from './types.js'
import type {
  BenchmarkEnvironment,
  BenchmarkResult,
  CapabilityFinding,
  FixtureAggregate,
  GapClassification,
  NextChangeScope,
} from './types.js'

export function buildBenchmarkResult(params: {
  environment: BenchmarkEnvironment
  fixtures: FixtureAggregate[]
  findings: CapabilityFinding[]
  nextChangeScope: NextChangeScope
}): BenchmarkResult {
  const result: BenchmarkResult = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    benchmarkId: BENCHMARK_ID,
    environment: params.environment,
    fixtures: params.fixtures,
    findings: params.findings,
    nextChangeScope: params.nextChangeScope,
  }

  // 只有通过 schema 的结果才允许出厂——JSON 与 Markdown 共用同一份已校验模型。
  benchmarkResultSchema.parse(result)
  return result
}

/**
 * 按 `fixtures.<fixtureId>.<path…>` 解析结果引用。
 *
 * 这是 Markdown ↔ JSON 可回溯性的执行入口：结论里写的每个 results 引用
 * 都必须在这里解析得到非 undefined 值，否则报告生成门禁失败。
 */
export function resolveResultRef(result: BenchmarkResult, ref: string): unknown {
  const parts = ref.split('.')
  if (parts[0] !== 'fixtures' || parts.length < 3) return undefined

  const fixture = result.fixtures.find((f) => f.fixtureId === parts[1])
  if (!fixture) return undefined

  let current: unknown = fixture
  for (const key of parts.slice(2)) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** 校验每条结论的 results 引用都能解析（tasks 4.6）。 */
export function verifyReferenceTraceability(result: BenchmarkResult): string[] {
  const problems: string[] = []
  for (const finding of result.findings) {
    for (const ref of finding.references.results) {
      if (resolveResultRef(result, ref) === undefined) {
        problems.push(`${finding.capabilityId}: results 引用无法在 JSON 解析 → ${ref}`)
      }
    }
  }
  return problems
}

export function classificationCounts(
  findings: CapabilityFinding[],
): Record<GapClassification, number> {
  const counts = Object.fromEntries(GAP_CLASSIFICATIONS.map((c) => [c, 0])) as Record<
    GapClassification,
    number
  >
  for (const f of findings) counts[f.classification]++
  return counts
}

function mdEscape(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function list(items: string[]): string {
  return items.length === 0 ? '_无_' : items.map((i) => `- ${i}`).join('\n')
}

// ── Markdown 渲染 ──

export function renderMarkdown(result: BenchmarkResult): string {
  const env = result.environment
  const counts = classificationCounts(result.findings)
  const lines: string[] = []

  lines.push('# Compiler 执行链 M0 Benchmark 报告')
  lines.push('')
  lines.push(
    '> 本报告由 `v2-5-compiler-execution-gap-benchmark` 自动生成，**请勿手工编辑**：',
    '> 它与 `compiler-m0-benchmark-result.json` 同源渲染，手改会立即与机器结果不一致。',
    '> 重新生成：`cd apps/backend && COMPILER_M0_BENCHMARK_WRITE=1 node ace test unit --files=compiler_execution_gap_benchmark`',
  )
  lines.push('')

  // ── 环境 ──
  lines.push('## 1. 运行环境与口径')
  lines.push('')
  lines.push('| 字段 | 值 |')
  lines.push('|------|-----|')
  lines.push(`| git SHA | \`${env.gitSha}\` |`)
  lines.push(`| 分支 | \`${env.gitBranch}\` |`)
  lines.push(
    `| 工作树 | ${env.gitDirty ? '**有未提交改动**（结论对应工作树而非该 SHA）' : '干净'} |`,
  )
  lines.push(`| Node | ${env.nodeVersion} |`)
  lines.push(`| 平台 | ${env.platform} / ${env.arch} |`)
  lines.push(`| CPU | ${mdEscape(env.cpuModel)} × ${env.cpuCount} |`)
  lines.push(`| fixture 版本 | ${env.fixtureVersion} |`)
  lines.push(`| 每 fixture 运行次数 | ${env.runCount} |`)
  lines.push(`| 计时来源 | ${env.timeSource} |`)
  lines.push(`| 生成时间 | ${env.generatedAt} |`)
  lines.push('')
  lines.push(
    '**口径声明**：wall-clock 为单机微基准，仅用于判断「明显并行 / 明显回归」，**不构成任何 SLA 或生产容量承诺**。',
    '并行的主证据是 handler 执行区间的**行为重叠**，不依赖计时阈值。全部 Stage 均为 `deterministic` 类型，',
    '执行器因此不会生成 Context Packet，**零真实模型调用**。',
  )
  lines.push('')

  // ── 摘要 ──
  lines.push('## 2. 结论摘要')
  lines.push('')
  lines.push('| # | 能力 | 分类 | 置信度 |')
  lines.push('|---|------|------|--------|')
  result.findings.forEach((f, i) => {
    lines.push(
      `| ${i + 1} | ${mdEscape(f.title)}<br/>\`${f.capabilityId}\` | \`${GAP_DISPLAY_NAMES[f.classification]}\` | ${f.confidence} |`,
    )
  })
  lines.push('')
  lines.push('**分类分布**：')
  lines.push('')
  for (const c of GAP_CLASSIFICATIONS) {
    lines.push(`- \`${GAP_DISPLAY_NAMES[c]}\`：${counts[c]} 项`)
  }
  lines.push('')

  // ── 头条结论 ──
  const unwired = result.findings.filter((f) => f.classification === 'foundation-unwired')
  // 「接线即解锁」= foundation-unwired 中底层已在 isolated 执行器上跑通的那些。
  // stage-output-cache 的底层证据来自独立的 StageCacheService 探针而非执行器，故不计入。
  const wiringUnlocks = unwired.filter(
    (f) =>
      f.evidence.isolatedExecutor.fixtureIds.length > 0 && f.capabilityId !== 'stage-output-cache',
  ).length
  lines.push('### 一句话结论')
  lines.push('')
  lines.push(
    `Compiler 的执行**能力**基本就位；当前 HEAD 已把 Controller 生产入口接到 orchestrator，但本 M0 benchmark 的服务层 fallback 探针不会传入 orchestrator，因此仍不把 fixture 自行伪造成生产执行证据。${unwired.length} 项能力仍需要在对应 production path 或后续 change 中保留回归证据。`,
    `其中 ${wiringUnlocks} 项**接线即解锁**（底层已在 isolated 执行器上跑通）；\`stage-output-cache\` 例外——它的底层 \`StageCacheService\` 独立可用，但执行器的 \`ExecutorOptions\` 根本没有 cache 槽位，接线前得先加接缝。`,
    '',
    `M0 的历史判断是：当时的真实缺口是**执行器接线**，不是「实现并行」。当前 HEAD 已接入 orchestrator；\`execute()\` 仍保留 \`Promise.allSettled\` 并发能力，本 benchmark 也继续观测到两分支执行区间重叠。`,
    `当前分布中仍有 ${counts.missing} 项未在本 fallback 探针中观测到，${counts['stub-mock-only']} 项仅存 stub/mock 证据；是否已由 wiring change 另行覆盖，应以对应 production wiring 测试为准。`,
  )
  lines.push('')

  // ── Fixture 矩阵 ──
  lines.push('## 3. Fixture 执行矩阵')
  lines.push('')
  lines.push(
    '| fixture | 完成顺序 | 最大并发 | 重叠 | checkpoint | 中位耗时 (ms) | 顺序稳定 | 产物 hash 稳定 |',
  )
  lines.push(
    '|---------|---------|---------|------|-----------|--------------|---------|--------------|',
  )
  for (const f of result.fixtures) {
    lines.push(
      `| \`${f.fixtureId}\` | ${f.stageOrder.length > 0 ? f.stageOrder.join(' → ') : '_（无完成 Stage）_'} | ${f.maxObservedConcurrency} | ${f.overlapObserved ? `是（${f.overlappingPairs.join('、')}）` : '否'} | ${f.checkpointCount} | ${f.medianWallClockMs} | ${f.stageOrderStable ? '是' : '否'} | ${f.artifactHashStable ? '是' : '否'} |`,
    )
  }
  lines.push('')
  lines.push('各 fixture 的 Stage 状态与 attempt：')
  lines.push('')
  lines.push('| fixture | Stage 状态 | handler 调用次数 | 事件 |')
  lines.push('|---------|-----------|----------------|------|')
  for (const f of result.fixtures) {
    lines.push(
      `| \`${f.fixtureId}\` | ${mdEscape(JSON.stringify(f.statusByStage))} | ${mdEscape(JSON.stringify(f.attemptsByStage))} | ${mdEscape(JSON.stringify(f.eventStatusCounts))} |`,
    )
  }
  lines.push('')

  // ── 逐条结论 ──
  lines.push('## 4. 逐条结论与证据')
  lines.push('')
  for (const f of result.findings) {
    lines.push(`### \`${f.capabilityId}\` —— ${mdEscape(f.title)}`)
    lines.push('')
    lines.push(`**分类**：\`${GAP_DISPLAY_NAMES[f.classification]}\` · **置信度**：${f.confidence}`)
    lines.push('')
    lines.push('**第一层 · 静态可达性**')
    lines.push('')
    lines.push('| 符号 | 文件 | 生产调用点 | 生产入口可达 |')
    lines.push('|------|------|-----------|-------------|')
    for (const s of f.evidence.static) {
      lines.push(
        `| \`${mdEscape(s.symbol)}\` | \`${s.file}\` | ${s.productionCallSites} | ${s.reachableFromProductionEntry ? '是' : '**否**'} |`,
      )
    }
    lines.push('')
    for (const s of f.evidence.static) {
      lines.push(`- \`${mdEscape(s.symbol)}\`：${mdEscape(s.note)}`)
    }
    lines.push('')
    lines.push(
      `**第二层 · isolated executor**（观测到：${f.evidence.isolatedExecutor.observed ? '是' : '否'}）`,
    )
    lines.push('')
    lines.push(mdEscape(f.evidence.isolatedExecutor.detail))
    lines.push('')
    lines.push(
      `**第三层 · 生产 service path**（观测到：${f.evidence.productionServicePath.observed ? '是' : '否'}）`,
    )
    lines.push('')
    lines.push(mdEscape(f.evidence.productionServicePath.detail))
    lines.push('')
    lines.push('**引用**')
    lines.push('')
    lines.push(`- 文件：${f.references.files.map((x) => `\`${x}\``).join('、')}`)
    lines.push(`- 符号：${f.references.symbols.map((x) => `\`${x}\``).join('、')}`)
    lines.push(
      `- 测试：${f.references.tests.length > 0 ? f.references.tests.map((x) => `\`${x}\``).join('、') : '_无_'}`,
    )
    lines.push(
      `- 结果（可在 JSON 按此路径回溯）：${f.references.results.length > 0 ? f.references.results.map((x) => `\`${x}\``).join('、') : '_无_'}`,
    )
    lines.push('')
    lines.push('**限制**')
    lines.push('')
    lines.push(list(f.limitations.map(mdEscape)))
    lines.push('')
  }

  // ── 下游范围 ──
  lines.push('## 5. 下游 change 最小范围建议')
  lines.push('')
  lines.push(`目标 change：\`${result.nextChangeScope.changeId}\``)
  lines.push('')
  lines.push('**In Scope（最小）**')
  lines.push('')
  lines.push(list(result.nextChangeScope.inScope.map(mdEscape)))
  lines.push('')
  lines.push('**明确非目标**')
  lines.push('')
  lines.push(list(result.nextChangeScope.nonGoals.map(mdEscape)))
  lines.push('')

  // ── 方法与限制 ──
  lines.push('## 6. 方法与整体限制')
  lines.push('')
  lines.push(
    list([
      '**三层证据**：每项能力分别采集 graph/静态可达性、isolated executor 行为、生产 service path 行为。只有生产路径可达**且**有行为证据才判 `implemented`；分类由 `classifyGap` 单一函数推导，代码层面不存在越级路径。',
      '**隔离**：isolated 层注入内存 ArtifactStore / StageEventLogger，不持有任何数据库句柄；生产层在独立 test.sqlite 的专用测试组织内运行，并在 finally 中删除自建行。全程零真实 provider credential、零正式项目数据写入。',
      '**只用既有接缝**：benchmark 只使用 `ExecutorOptions` 既有注入点与 `registerHandler`，未为测量新增任何生产代码接缝。发现缺接缝（如执行器无 cache 槽位）时按 gap 记录，不改生产代码。',
      '**计时**：每 fixture 重复运行取中位数；wall-clock 只作辅助，行为重叠才是并行主证据。',
      '**报告时效**：结论绑定上表的 git SHA 与 fixture 版本。生产代码接线后本报告即刻过时——`compiler_execution_gap_benchmark.spec.ts` 的静态可达性一致性检查会在那时失败，提示必须重跑。',
      '**未覆盖**：真实 Lucid ArtifactStore 写入路径、Redis CacheStore 实现、replay 的缺失 artifact 负例、多 Stage 同时失败的收敛、跨机器性能对比。',
    ]),
  )
  lines.push('')

  return lines.join('\n') + '\n'
}

export function renderJson(result: BenchmarkResult): string {
  return JSON.stringify(result, null, 2) + '\n'
}
