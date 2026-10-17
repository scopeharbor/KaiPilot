/**
 * 流式输出重复循环（repetition loop）检测。
 *
 * 背景（实测，gpt-5.6-luna medium）：长输出偶发陷入循环，同一段 JSON 片段或同一句话被原样
 * 反复输出，直到撞上 max_tokens 或长连接中断。等到结束再解析失败，已白白消耗数万 token 与
 * 数分钟墙钟。流式阶段一旦确认循环就中止请求、丢弃这次输出，由上层以干净上下文重试。
 *
 * 判定：输出尾部由同一个长度为 p 的片段原样连续重复 k 次。
 * - 长片段（整段对象 / 段落）：k ≥ 3 且重复总长 ≥ 1500 字符；
 * - 短片段（单字 / 短语刷屏）：k ≥ 12 且重复总长 ≥ 300 字符。
 * 正常 JSON 结构（marker 等）虽然重复出现，但被不同的 value 隔开，尾部不会形成连续原样重复。
 */

export interface RepetitionGuardOptions {
  /** 最短周期（字符）。 */
  minPeriod?: number
  /** 最长周期（字符）。 */
  maxPeriod?: number
  /** 每新增多少字符检查一次（控制 CPU）。 */
  checkEvery?: number
}

export interface RepetitionVerdict {
  period: number
  repeats: number
  span: number
}

const LONG_MIN_REPEATS = 3
const LONG_MIN_SPAN = 1500
const SHORT_MIN_REPEATS = 12
const SHORT_MIN_SPAN = 300

/** 尾部以周期 p 原样重复的次数（至少 1）。 */
function tailRepeats(buffer: string, period: number): number {
  const end = buffer.length
  let repeats = 1
  while ((repeats + 1) * period <= end) {
    const offset = end - (repeats + 1) * period
    let same = true
    for (let index = 0; index < period; index++) {
      if (buffer.charCodeAt(offset + index) !== buffer.charCodeAt(end - period + index)) {
        same = false
        break
      }
    }
    if (!same) break
    repeats++
  }
  return repeats
}

export function detectRepetition(
  buffer: string,
  options: RepetitionGuardOptions = {},
): RepetitionVerdict | null {
  const minPeriod = options.minPeriod ?? 1
  const maxPeriod = Math.min(options.maxPeriod ?? 2000, Math.floor(buffer.length / 3))
  const last = buffer.length - 1
  for (let period = minPeriod; period <= maxPeriod; period++) {
    // 快速过滤：末字符与前一周期对应字符不同，则不可能是该周期的重复。
    if (buffer.charCodeAt(last) !== buffer.charCodeAt(last - period)) continue
    const repeats = tailRepeats(buffer, period)
    const span = repeats * period
    if (
      (repeats >= LONG_MIN_REPEATS && span >= LONG_MIN_SPAN) ||
      (repeats >= SHORT_MIN_REPEATS && span >= SHORT_MIN_SPAN)
    ) {
      return { period, repeats, span }
    }
  }
  return null
}

/** 增量检测器：只保留尾部窗口，每累计 checkEvery 个字符检查一次。 */
export class RepetitionGuard {
  readonly #maxPeriod: number
  readonly #minPeriod: number
  readonly #checkEvery: number
  readonly #window: number
  #tail = ''
  #sinceCheck = 0
  #verdict: RepetitionVerdict | null = null

  constructor(options: RepetitionGuardOptions = {}) {
    this.#minPeriod = options.minPeriod ?? 1
    this.#maxPeriod = options.maxPeriod ?? 2000
    this.#checkEvery = options.checkEvery ?? 256
    this.#window = Math.max(this.#maxPeriod * LONG_MIN_REPEATS, LONG_MIN_SPAN) + this.#maxPeriod
  }

  get verdict(): RepetitionVerdict | null {
    return this.#verdict
  }

  /** 追加一段输出；确认循环时返回判定（之后恒返回同一判定）。 */
  push(text: string): RepetitionVerdict | null {
    if (this.#verdict || !text) return this.#verdict
    this.#tail += text
    if (this.#tail.length > this.#window * 2) this.#tail = this.#tail.slice(-this.#window)
    this.#sinceCheck += text.length
    if (this.#sinceCheck < this.#checkEvery) return null
    this.#sinceCheck = 0
    this.#verdict = detectRepetition(this.#tail, {
      minPeriod: this.#minPeriod,
      maxPeriod: this.#maxPeriod,
    })
    return this.#verdict
  }
}
