/**
 * v2-5-compiler-execution-gap-benchmark —— 第一层证据：静态可达性（tasks 3.1）。
 *
 * design D1 要求 graph/static 可达性与行为证据分开采集。这里**不**把 codebase-memory
 * 的一次性查询结果硬编码进报告——那种数字会在别人接线后悄悄过期。改为在每次运行时
 * 真实扫描生产源码（`app/` + `start/`，排除测试），得到可复现的调用点计数。
 *
 * 每个 probe 同时带一条**人工裁决**的 `reachableFromProductionEntry`（附引用）。
 * `verifyProbeConsistency` 会检查裁决与扫描结果不矛盾；矛盾即报告过时，必须重跑并复核。
 *
 * ⚠️ 剥离顺序很关键：import 说明符本身是字符串字面量，若先剥字符串再找 import，
 * 每个 probe 都会静默地扫不到任何文件、恒返回 0 —— 那是「看起来全绿的错误答案」。
 * 因此 import 判定走「只剥注释」的源码，调用点计数才走「注释+字符串都剥」的源码。
 * `compiler_execution_gap_benchmark.spec.ts` 用已知存在的调用点做正向对照，防止本类静默失效。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { StaticEvidence } from './types.js'

/** 生产代码根目录（相对 apps/backend）。测试目录一律不计入。 */
const PRODUCTION_ROOTS = ['app', 'start']

export interface ReachabilityProbe {
  id: string
  symbol: string
  /** 定义所在文件（相对仓库根）。 */
  file: string
  /**
   * 只在 import 了该模块的生产文件中查找调用点，避免同名方法误计
   * （如 `GanttSchedulingService.execute`）。用模块基名匹配，
   * 以同时覆盖 `'./pipeline_executor.js'` 与 `'#services/compiler/pipeline_executor'` 两种写法。
   * 为 null 时不做 import 过滤。
   */
  importMatch: string | null
  /** 只扫描这些文件（相对仓库根）；为空表示扫描全部生产文件。 */
  fileFilter?: string[]
  /** 调用点匹配模式。 */
  callPattern: RegExp
  /** 为 true 时保留字符串字面量（模式需要匹配字面量值时用）。 */
  preserveStrings?: boolean
  /**
   * 人工裁决：能否从生产入口（HTTP 路由 → controller → service）到达并**真正驱动**该能力。
   * 必须在 note 里给出引用。
   */
  reachableFromProductionEntry: boolean
  note: string
}

/** 覆盖 tasks 3.1 要求的六类：startRun、executor、handler、checkpoint、cache、event。 */
export const REACHABILITY_PROBES: ReachabilityProbe[] = [
  {
    id: 'start-run',
    symbol: 'CompilerRunService.startRun',
    file: 'apps/backend/app/services/compiler/compiler_run_service.ts',
    importMatch: 'compiler_run_service',
    callPattern: /\.startRun\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'POST /api/v1/ai/compiler/runs → CompilerController.startRun → CompilerRunService.startRun。当前 Controller 路径会传入 production orchestrator 与 blueprints；service fallback 未传 orchestrator 时只创建 queued run。',
  },
  {
    id: 'executor-execute',
    symbol: 'PipelineExecutor.execute',
    file: 'apps/backend/app/services/compiler/pipeline_executor.ts',
    importMatch: 'pipeline_executor',
    callPattern: /\bexecutor\.execute\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'HEAD 69b2a2ab9 起，生产 Controller → CompilerRunService.startRun → #executeWithOrchestrator → CompilerRunOrchestrator.execute 可达，orchestrator 内部调用 executor.execute()。',
  },
  {
    id: 'executor-resume',
    symbol: 'PipelineExecutor.resume',
    file: 'apps/backend/app/services/compiler/pipeline_executor.ts',
    importMatch: 'pipeline_executor',
    callPattern: /\bexecutor\.resume\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'HEAD 69b2a2ab9 起，CompilerController.resume 调用 CompilerRunService.resumeCompilation，后者进入 CompilerRunOrchestrator.resume 并调用 executor.resume()；旧的 resumeRun seam 仍保留为服务层工具方法。',
  },
  {
    id: 'executor-replay',
    symbol: 'PipelineExecutor.replay',
    file: 'apps/backend/app/services/compiler/pipeline_executor.ts',
    importMatch: 'pipeline_executor',
    callPattern: /\bexecutor\.replay\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'v2-5-compiler-resume-replay-wiring 起，API v2 replay 入口调用 CompilerRunService.replayRun，后者进入 CompilerRunOrchestrator.replay 并调用 executor.replay()。',
  },
  {
    id: 'handler-registry',
    symbol: 'PipelineExecutor.registerHandler',
    file: 'apps/backend/app/services/compiler/pipeline_executor.ts',
    importMatch: 'pipeline_executor',
    callPattern: /\.registerHandler\s*\(/g,
    reachableFromProductionEntry: true,
    note: '生产路径已通过 CompilerRunOrchestrator 将 production handler 注册进 PipelineExecutor；DevDebugService 仍保留 3 个不可达的调试注册点。',
  },
  {
    id: 'checkpoint-write',
    symbol: 'PipelineExecutor.#saveCheckpoint / #savePhaseCheckpoint',
    file: 'apps/backend/app/services/compiler/pipeline_executor.ts',
    importMatch: null,
    // 限定 `this.#…(` 只计调用点，不把方法定义算进去。
    callPattern: /this\.#save(?:Phase)?Checkpoint\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'checkpoint 仍只由 execute() 内部写（逐 Stage 与逐 phase），但 execute 已由 CompilerRunOrchestrator 从生产 startRun 路径调用。',
  },
  {
    id: 'stage-cache',
    symbol: 'StageCacheService.getOrComputeDetailed',
    file: 'apps/backend/app/services/compiler/stage_cache_service.ts',
    importMatch: 'stage_cache_service',
    callPattern: /\.getOrCompute(?:Detailed)?\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'v2-5-compiler-stage-cache-wiring 起：CompilerRunOrchestrator.execute/resume 构造 PipelineExecutor 时注入 StageCacheService 并启用（compiler_run_orchestrator.ts），PipelineExecutor.execute 在 deterministic Stage 的 handler 调用点经 getOrComputeDetailed 包裹（pipeline_executor.ts）；COMPILER_STAGE_CACHE_ENABLED=false 可 feature-off。',
  },
  {
    id: 'stage-event',
    symbol: 'StageEventLogger.started/succeeded/failed/skipped',
    file: 'apps/backend/app/services/compiler/stage_event_logger.ts',
    importMatch: 'stage_event_logger',
    callPattern: /stageEventLogger\.(?:started|succeeded|failed|skipped|needsHumanReview)\s*\(/g,
    reachableFromProductionEntry: true,
    note: 'Stage 事件写方之一在 PipelineExecutor.execute 内部，现已通过 CompilerRunOrchestrator 可达；CompilerObservabilityRecorder.recordStage* 仍是未接入的并行包装路径。',
  },
  {
    id: 'run-terminal-status',
    symbol: 'CompilerRun 终态写入（status/completedAt）',
    file: 'apps/backend/app/services/compiler/compiler_run_service.ts',
    importMatch: null,
    // 只扫描有资格推进 compiler run 的三个文件；全域扫 `completedAt =` 会命中
    // MigrationRun / ReportExport / RiskPlan 等无关模型，把噪音当证据。
    fileFilter: [
      'apps/backend/app/services/compiler/compiler_run_service.ts',
      'apps/backend/app/services/compiler/compiler_run_orchestrator.ts',
      'apps/backend/app/services/compiler/pipeline_executor.ts',
      'apps/backend/app/controllers/compiler_controller.ts',
    ],
    callPattern:
      /\b(?:run|compilerRun)\.(?:save|merge)\s*\(|\b(?:run|compilerRun)\.(?:status|completedAt)\s*=[^=]|CompilerRun\.query\s*\([\s\S]{0,120}?\.update\s*\(/g,
    preserveStrings: true,
    reachableFromProductionEntry: true,
    note: 'CompilerRunOrchestrator.#writeTerminalState 已成为生产终态写方，写入 status/completedAt/error；run service 默认先创建 queued run，随后由 orchestrator 收敛。',
  },
]

// ── 源码处理 ──

/** 只剥注释，保留字符串（import 判定与字面量匹配需要）。 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** 剥字符串字面量（调用点计数需要：注释/文案里的符号名不是调用）。 */
export function stripStrings(source: string): string {
  return source
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** 注释与字符串一并剥离。 */
export function stripCommentsAndStrings(source: string): string {
  return stripStrings(stripComments(source))
}

function listTsFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.ts')) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

export interface ProbeScanResult {
  probe: ReachabilityProbe
  /** 生产代码中的调用点数量。 */
  productionCallSites: number
  /** 出现调用点的文件（相对仓库根）。 */
  callSiteFiles: string[]
  /** 定义文件是否存在。 */
  exists: boolean
}

/**
 * 扫描生产源码，统计每个 probe 的调用点。
 *
 * @param backendRoot apps/backend 的绝对路径
 * @param repoRoot 仓库根绝对路径（用于生成相对路径）
 */
export function scanReachability(backendRoot: string, repoRoot: string): ProbeScanResult[] {
  const files = PRODUCTION_ROOTS.flatMap((r) => listTsFiles(join(backendRoot, r)))
  const sources = files.map((f) => {
    const noComments = stripComments(readFileSync(f, 'utf8'))
    return {
      rel: relative(repoRoot, f).split(sep).join('/'),
      /** 保留字符串：用于 import 判定与 preserveStrings 模式。 */
      noComments,
      /** 字符串也剥离：用于常规调用点计数。 */
      code: stripStrings(noComments),
    }
  })

  return REACHABILITY_PROBES.map((probe) => {
    const defPath = join(repoRoot, probe.file)
    let exists = false
    try {
      exists = statSync(defPath).isFile()
    } catch {
      exists = false
    }

    const callSiteFiles: string[] = []
    let productionCallSites = 0

    for (const src of sources) {
      if (probe.fileFilter && !probe.fileFilter.includes(src.rel)) continue

      // 定义文件自身不算调用点——除非 probe 本就针对文件内部私有调用（importMatch=null）。
      if (src.rel === probe.file && probe.importMatch !== null) continue

      // import 判定必须在**保留字符串**的源码上做：说明符本身就是字符串字面量。
      if (probe.importMatch !== null && !src.noComments.includes(probe.importMatch)) continue

      const haystack = probe.preserveStrings ? src.noComments : src.code
      const matches = haystack.match(probe.callPattern)
      if (matches && matches.length > 0) {
        productionCallSites += matches.length
        callSiteFiles.push(src.rel)
      }
    }

    return { probe, productionCallSites, callSiteFiles, exists }
  })
}

/**
 * 一致性检查（报告过时的守门人）。
 *
 * 规则：声明「生产入口可达」的 probe 必须真的存在调用点。反之调用点存在但被裁决为
 * 不可达是允许的（如 resumeRun → executor.resume：调用点在，但调用者自身无人调用），
 * 这类情况必须在 note 里说明为什么。
 */
export function verifyProbeConsistency(results: ProbeScanResult[]): string[] {
  const problems: string[] = []
  for (const r of results) {
    if (!r.exists) {
      problems.push(`${r.probe.id}: 定义文件不存在 ${r.probe.file}`)
    }
    if (r.probe.reachableFromProductionEntry && r.productionCallSites === 0) {
      problems.push(`${r.probe.id}: 裁决为生产可达，但扫描到 0 个调用点——裁决或扫描模式已过时`)
    }
    if (!r.probe.note.trim()) {
      problems.push(`${r.probe.id}: 缺少可达性裁决的引用说明`)
    }
  }
  return problems
}

export function toStaticEvidence(result: ProbeScanResult): StaticEvidence {
  return {
    symbol: result.probe.symbol,
    file: result.probe.file,
    exists: result.exists,
    reachableFromProductionEntry: result.probe.reachableFromProductionEntry,
    productionCallSites: result.productionCallSites,
    note: result.probe.note,
  }
}

export function evidenceById(results: ProbeScanResult[], ids: string[]): StaticEvidence[] {
  return ids.map((id) => {
    const found = results.find((r) => r.probe.id === id)
    if (!found) throw new Error(`Unknown reachability probe: ${id}`)
    return toStaticEvidence(found)
  })
}
