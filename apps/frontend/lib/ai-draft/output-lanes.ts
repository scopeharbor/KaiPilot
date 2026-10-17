/**
 * 生成期间的模型实时输出，按「一次模型调用」分道。
 *
 * 草案生成会并发调用模型（多份拆解候选、分支审查……），各调用的文本若直接拼成一串会互相穿插，
 * 看不出是谁在输出。服务端给每条 generation.output 带上调用编号与步骤名，这里按编号归到各自的道。
 * 旧服务端不带编号时，全部归入同一条「模型输出」道。
 */
export interface OutputLane {
  id: string
  label: string
  text: string
  /** 推理模型的思考过程（reasoning_content / thinking）；不输出思考过程的模型一直为空。 */
  reasoning: string
  /** 这次调用的模型名（服务端开道时带上）。 */
  model: string | null
  /**
   * 累计字数（不截断）：text / reasoning 只留尾部 6,000 字供显示，字数若按保留文本算会卡在 6,000（实测）。
   */
  textChars: number
  reasoningChars: number
  /** 最近一个片段是思考还是正文：thinking = 正在思考，answering = 正在回答。 */
  phase: 'thinking' | 'answering'
  done: boolean
  /** 首次出现的次序，用于稳定排序。 */
  order: number
}

export interface OutputPiece {
  text: string
  callId?: string
  label?: string
  done?: boolean
  /** reasoning = 思考过程；缺省为正文。 */
  kind?: 'reasoning'
  model?: string
}

/** 每道只保留尾部文本（生成一次可能输出数十万字，界面只需要看最近的内容）。 */
export const LANE_TEXT_LIMIT = 6_000
/** 最多保留的道数：已完成的旧道先淘汰。 */
export const LANE_LIMIT = 40

const FALLBACK_LANE = 'model'

export function appendOutputPiece(lanes: OutputLane[], piece: OutputPiece): OutputLane[] {
  const id = piece.callId ?? FALLBACK_LANE
  const index = lanes.findIndex((lane) => lane.id === id)
  const existing = index >= 0 ? lanes[index] : null
  const thinking = piece.kind === 'reasoning'
  const text = ((existing?.text ?? '') + (thinking ? '' : piece.text)).slice(-LANE_TEXT_LIMIT)
  const reasoning = ((existing?.reasoning ?? '') + (thinking ? piece.text : '')).slice(
    -LANE_TEXT_LIMIT,
  )
  const lane: OutputLane = {
    id,
    label: piece.label ?? existing?.label ?? '模型输出',
    text,
    reasoning,
    model: piece.model ?? existing?.model ?? null,
    textChars: (existing?.textChars ?? 0) + (thinking ? 0 : piece.text.length),
    reasoningChars: (existing?.reasoningChars ?? 0) + (thinking ? piece.text.length : 0),
    phase:
      piece.text.length === 0
        ? (existing?.phase ?? 'answering')
        : thinking
          ? 'thinking'
          : 'answering',
    done: Boolean(piece.done),
    order: existing?.order ?? nextOrder(lanes),
  }
  const next = index >= 0 ? lanes.map((item, i) => (i === index ? lane : item)) : [...lanes, lane]
  return next.length > LANE_LIMIT ? evict(next) : next
}

/** 生成结束：所有道都标记完成。 */
export function closeOutputLanes(lanes: OutputLane[]): OutputLane[] {
  return lanes.some((lane) => !lane.done) ? lanes.map((lane) => ({ ...lane, done: true })) : lanes
}

function nextOrder(lanes: OutputLane[]): number {
  return lanes.reduce((max, lane) => Math.max(max, lane.order), -1) + 1
}

function evict(lanes: OutputLane[]): OutputLane[] {
  const surplus = lanes.length - LANE_LIMIT
  const oldestDone = lanes
    .filter((lane) => lane.done)
    .sort((a, b) => a.order - b.order)
    .slice(0, surplus)
    .map((lane) => lane.id)
  const drop = new Set(oldestDone)
  const kept = lanes.filter((lane) => !drop.has(lane.id))
  return kept.length > LANE_LIMIT ? kept.slice(kept.length - LANE_LIMIT) : kept
}
