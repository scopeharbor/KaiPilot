/**
 * v2-5-ai-draft-live-sse-transport / D4 —— 流式增量 JSON 扫描器。
 *
 * 该扫描器只识别顶层草案字段，不尝试替代最终 JSON 解析与 schema 校验。
 * 它维护跨 chunk 的词法状态；任何不确定或异常情况都只会停用进度投影，
 * 不会影响权威生成、解析、校验与持久化路径。
 */

import {
  MODULE_KEY_TO_JSON_FIELD,
  PROJECT_DRAFT_MODULES,
  type ProjectDraftModule,
} from '@aiproj/types'

export type ScannerIntent =
  | { kind: 'module.delta'; module: ProjectDraftModule; status: 'generating' }
  | { kind: 'module.completed'; module: ProjectDraftModule }

export interface ScanResult {
  intents: ScannerIntent[]
  degraded: boolean
}

type StringRole = 'key' | 'value' | 'nested' | null

export interface ScannerState {
  depth: number
  inString: boolean
  escaped: boolean
  /** 为兼容既有诊断保留；表示最近识别到、尚未消费的顶层键。 */
  pendingKey: string | null
  emitted: Set<string>
  degraded: boolean
  started: Set<string>
  stringBuffer: string
  stringRole: StringRole
  expectingKey: boolean
  expectingColon: boolean
  expectingValue: boolean
  activeModule: ProjectDraftModule | null
  /** 结构值开始后的 depth；标量与字符串值为 null。 */
  valueDepth: number | null
  scalarLength: number
}

const MAX_UNTERMINATED_SCALAR_LENGTH = 8_192

const FIELD_TO_MODULE = new Map<string, ProjectDraftModule>()
for (const module of PROJECT_DRAFT_MODULES) {
  // 正式 JSON 字段名，以及旧 fixture 中使用过的模块别名均可识别。
  FIELD_TO_MODULE.set(MODULE_KEY_TO_JSON_FIELD[module], module)
  FIELD_TO_MODULE.set(module, module)
}

export function createScannerState(): ScannerState {
  return {
    depth: 0,
    inString: false,
    escaped: false,
    pendingKey: null,
    emitted: new Set<string>(),
    degraded: false,
    started: new Set<string>(),
    stringBuffer: '',
    stringRole: null,
    expectingKey: false,
    expectingColon: false,
    expectingValue: false,
    activeModule: null,
    valueDepth: null,
    scalarLength: 0,
  }
}

function startModule(state: ScannerState, intents: ScannerIntent[]): void {
  const module = state.activeModule
  if (!module || state.started.has(module) || state.emitted.has(module)) return
  state.started.add(module)
  intents.push({ kind: 'module.delta', module, status: 'generating' })
}

function completeModule(state: ScannerState, intents: ScannerIntent[]): void {
  const module = state.activeModule
  if (module && !state.emitted.has(module)) {
    state.emitted.add(module)
    intents.push({ kind: 'module.completed', module })
  }
  state.activeModule = null
  state.valueDepth = null
  state.scalarLength = 0
  state.expectingValue = false
}

function degrade(state: ScannerState): ScanResult {
  state.degraded = true
  state.activeModule = null
  return { intents: [], degraded: true }
}

/**
 * 处理一段文本 chunk。完成事件表示该顶层 JSON 值在词法上已经闭合，
 * 并不表示其内容通过了权威 schema/反幻觉校验。
 */
export function scanChunk(state: ScannerState, chunk: string): ScanResult {
  if (state.degraded) return { intents: [], degraded: true }

  const intents: ScannerIntent[] = []

  try {
    for (const char of chunk) {
      if (state.inString) {
        if (state.escaped) {
          state.escaped = false
          if (state.stringRole === 'key') state.stringBuffer += char
          continue
        }
        if (char === '\\') {
          state.escaped = true
          continue
        }
        if (char !== '"') {
          if (state.stringRole === 'key') state.stringBuffer += char
          continue
        }

        state.inString = false
        if (state.stringRole === 'key') {
          state.pendingKey = state.stringBuffer
          state.expectingKey = false
          state.expectingColon = true
        } else if (state.stringRole === 'value') {
          completeModule(state, intents)
        }
        state.stringRole = null
        state.stringBuffer = ''
        continue
      }

      if (state.expectingValue) {
        if (/\s/.test(char)) continue
        startModule(state, intents)
        state.expectingValue = false

        if (char === '{' || char === '[') {
          state.depth++
          state.valueDepth = state.depth
          continue
        }
        if (char === '"') {
          state.inString = true
          state.stringRole = 'value'
          continue
        }
        if (char === ',' || char === '}') return degrade(state)

        // number / boolean / null。遇到顶层分隔符时完成。
        state.scalarLength = 1
        continue
      }

      if (state.scalarLength > 0 && state.valueDepth === null) {
        if (char === ',' || char === '}' || /\s/.test(char)) {
          completeModule(state, intents)
          if (char === ',') {
            state.expectingKey = true
            state.pendingKey = null
          } else if (char === '}') {
            state.depth--
            if (state.depth < 0) return degrade(state)
          }
          continue
        }
        state.scalarLength++
        if (state.scalarLength > MAX_UNTERMINATED_SCALAR_LENGTH) return degrade(state)
        continue
      }

      if (char === '"') {
        state.inString = true
        if (state.depth === 1 && state.expectingKey) {
          state.stringRole = 'key'
          state.stringBuffer = ''
        } else {
          state.stringRole = 'nested'
        }
        continue
      }

      if (char === '{' || char === '[') {
        state.depth++
        if (state.depth === 1) state.expectingKey = true
        continue
      }

      if (char === '}' || char === ']') {
        if (state.depth <= 0) return degrade(state)
        state.depth--
        if (state.valueDepth !== null && state.depth < state.valueDepth) {
          completeModule(state, intents)
        }
        continue
      }

      if (char === ':' && state.depth === 1 && state.expectingColon) {
        state.expectingColon = false
        state.expectingValue = true
        state.activeModule = state.pendingKey
          ? (FIELD_TO_MODULE.get(state.pendingKey) ?? null)
          : null
        state.pendingKey = null
        continue
      }

      if (char === ',' && state.depth === 1) {
        state.expectingKey = true
        state.pendingKey = null
        continue
      }

      if (/\s/.test(char)) continue

      // 顶层键只能是 JSON 字符串；其他内容说明无法再安全投影。
      if (state.depth === 1 && state.expectingKey) return degrade(state)
    }
  } catch {
    return degrade(state)
  }

  return { intents, degraded: state.degraded }
}
