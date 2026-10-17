/**
 * v2-5-compiler-execution-gap-benchmark —— 运行环境采集（tasks 1.2）。
 *
 * design「报告过时」风险的对策：报告必须自带 git SHA、Node/OS、fixture version、
 * run count 与时间来源，使任何一项漂移都能被读者直接看出来，而不是默默过期。
 */

import { execFileSync } from 'node:child_process'
import { cpus, arch as osArch, platform as osPlatform } from 'node:os'
import type { BenchmarkEnvironment } from './types.js'

/**
 * fixture 集合版本。
 *
 * ⚠️ 任何改变 fixture DAG、handler 语义或预期结果的修改都必须提升本版本，
 * 否则新旧报告会在同一版本号下给出不可比的数字。
 */
export const FIXTURE_VERSION = '1.0.0'

/** 默认重复执行次数（design Open Questions：默认 5 次）。 */
export const DEFAULT_RUN_COUNT = 5

/**
 * 计时来源：`performance.now()` 是单调时钟，不受系统时间调整/NTP 回拨影响。
 * 这里记录来源本身，使读者知道 wall-clock 数字的口径。
 */
export const TIME_SOURCE = 'performance.now() (monotonic)'

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

export function collectEnvironment(runCount: number = DEFAULT_RUN_COUNT): BenchmarkEnvironment {
  const sha = git(['rev-parse', 'HEAD'])
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const porcelain = git(['status', '--porcelain'])

  const cpuList = cpus()

  return {
    gitSha: sha ?? 'unknown',
    gitBranch: branch ?? 'unknown',
    // porcelain 为 null（git 不可用）时不敢声称干净，按脏树处理。
    gitDirty: porcelain === null ? true : porcelain.length > 0,
    nodeVersion: process.version,
    platform: osPlatform(),
    arch: osArch(),
    cpuModel: cpuList[0]?.model?.trim() ?? 'unknown',
    cpuCount: cpuList.length > 0 ? cpuList.length : 1,
    fixtureVersion: FIXTURE_VERSION,
    runCount,
    timeSource: TIME_SOURCE,
    generatedAt: new Date().toISOString(),
  }
}
