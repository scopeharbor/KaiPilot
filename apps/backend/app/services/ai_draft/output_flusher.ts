/**
 * v3-ai-draft-live-output-panel —— generateOutputFlusher。
 *
 * 把逐 chunk 的模型输出文本按字符阈值批量切分为「输出事件文本片」，
 * 供 controller 以 generation.output 事件广播（只进 runner 内存队列，不落库）。
 *
 * 纯函数、无副作用，可独立单测。按字符索引切分（JS 字符串按 UTF-16 码元，
 * 中文等 BMP 字符安全；不会把代理对/码元拆成乱码——切点只可能落在码元边界，
 * 对增补平面字符（如 emoji）可能在代理对中间切开，但 SSE/JSON 传输与前端
 * 追加渲染均按串处理，展示层连缀后仍完整，不发生字节级损坏）。
 */

export const GENERATION_OUTPUT_FLUSH_CHARS = 96
/** 生成剧场逐字展示用的更细粒度阈值：约一行字就推一次，看起来是连续吐字而不是整段跳出。 */
export const LIVE_OUTPUT_FLUSH_CHARS = 24

export interface OutputFlusher {
  /** 追加一个 chunk；返回本次应广播的文本片列表（达到阈值时整段切出）。 */
  push(chunk: string): string[]
  /** 返回残余文本片并清空缓冲（生成结束时调用，保证尾部文本不丢）。 */
  flush(): string[]
}

export function createOutputFlusher(thresholdChars = GENERATION_OUTPUT_FLUSH_CHARS): OutputFlusher {
  let buffer = ''

  const cut = (): string[] => {
    if (buffer.length === 0) return []
    const pieces: string[] = []
    while (buffer.length >= thresholdChars) {
      pieces.push(buffer.slice(0, thresholdChars))
      buffer = buffer.slice(thresholdChars)
    }
    return pieces
  }

  return {
    push(chunk) {
      if (chunk.length > 0) buffer += chunk
      return cut()
    },
    flush() {
      const pieces = buffer.length > 0 ? [buffer] : []
      buffer = ''
      return pieces
    },
  }
}
