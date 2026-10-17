/**
 * incremental_scanner — 流式增量 JSON 扫描器单元测试。
 *
 * §2 覆盖：
 *   - 正常 JSON 完整扫描
 *   - 任意 chunk 切分点
 *   - 乱序/重复键
 *   - 嵌套结构不误判
 *   - 降级语义
 *   - 字符串内特殊字符
 */

import { describe, expect, it } from 'vitest'
import {
  createScannerState,
  scanChunk,
  type ScannerIntent,
} from '#services/ai_draft/incremental_scanner'

function collectIntents(chunks: string[]): ScannerIntent[] {
  const state = createScannerState()
  const all: ScannerIntent[] = []
  for (const chunk of chunks) {
    const result = scanChunk(state, chunk)
    all.push(...result.intents)
    if (result.degraded) break
  }
  return all
}

function delta(module: string): ScannerIntent {
  return { kind: 'module.delta', module: module as never, status: 'generating' }
}

function completed(module: string): ScannerIntent {
  return { kind: 'module.completed', module: module as never }
}

// ── 2.1 + 2.2 基本功能 ──────────────────────────────────────────────────────

describe('incremental scanner', () => {
  it('完整 JSON 产出正确的 delta 和 completed', () => {
    const json = `{
      "charter": {"title": "test"},
      "tasks": [{"id": "t1"}],
      "wbs": []
    }`
    const intents = collectIntents([json])

    // charter: delta → completed, tasks: delta → completed, wbs: delta → completed
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
      delta('wbs'),
      completed('wbs'),
    ])
  })

  it('每个模块至多一次（emitted 集合去重）', () => {
    // 模拟重复键
    const json = `{
      "charter": {"a": 1},
      "charter": {"b": 2}
    }`
    const intents = collectIntents([json])

    // charter 只应出现一次 delta + 一次 completed
    const deltas = intents.filter((i) => i.kind === 'module.delta')
    const completeds = intents.filter((i) => i.kind === 'module.completed')
    expect(deltas).toHaveLength(1)
    expect(completeds).toHaveLength(1)
    expect(deltas[0]).toEqual(delta('charter'))
    expect(completeds[0]).toEqual(completed('charter'))
  })

  it('不假定 JSON 键序', () => {
    const json = `{
      "ganttPreview": {"p": 1},
      "charter": {},
      "wbs": [],
      "risk": null
    }`
    const intents = collectIntents([json])

    // 按实际到达顺序
    const deltas = intents.filter((i) => i.kind === 'module.delta').map((i) => i.module)
    expect(deltas).toEqual(['ganttPreview', 'charter', 'wbs', 'risk'])
  })

  it('正式 JSON 字段名映射到 4 个非同名模块', () => {
    const intents = collectIntents([
      `{"acceptanceCriteria":[],"resourceHints":[],"riskHints":[],"milestoneHints":[]}`,
    ])
    expect(intents).toEqual([
      delta('acceptance'),
      completed('acceptance'),
      delta('resource'),
      completed('resource'),
      delta('risk'),
      completed('risk'),
      delta('milestone'),
      completed('milestone'),
    ])
  })

  it('嵌套对象/数组不误判 depth-1', () => {
    const json = `{
      "charter": {
        "title": {"value": "t"},
        "nested": {"deep": {"deeper": 1}}
      },
      "tasks": []
    }`
    const intents = collectIntents([json])

    // charter 的嵌套不应触发伪 delta/completed
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })

  it('非模块键不触发意图', () => {
    const json = `{
      "charter": {"title": "t"},
      "unknownKey": {"x": 1},
      "tasks": []
    }`
    const intents = collectIntents([json])
    const modules = [...new Set(intents.map((i) => i.module))]
    expect(modules).toEqual(['charter', 'tasks'])
    expect(modules).not.toContain('unknownKey')
  })

  it('null / number / boolean 值也能正确完成', () => {
    const json = `{"charter": null, "tasks": 42, "wbs": true}`
    const intents = collectIntents([json])
    expect(intents).toHaveLength(6) // 3 delta + 3 completed
  })

  it('空对象 {} 正确完成', () => {
    const json = `{"charter": {}}`
    const intents = collectIntents([json])
    expect(intents).toEqual([delta('charter'), completed('charter')])
  })
})

// ── 2.3 chunk 边界测试 ──────────────────────────────────────────────────────

describe('chunk 切分点', () => {
  const fullJson = `{"charter":{"title":"hello"},"tasks":[{"id":"t1"}],"wbs":[{"id":"w1"}]}`

  it('在字符间任意切分产出一致', () => {
    for (let split = 1; split < fullJson.length - 1; split++) {
      const chunk1 = fullJson.slice(0, split)
      const chunk2 = fullJson.slice(split)
      const intents = collectIntents([chunk1, chunk2])
      expect(intents).toEqual([
        delta('charter'),
        completed('charter'),
        delta('tasks'),
        completed('tasks'),
        delta('wbs'),
        completed('wbs'),
      ])
    }
  })

  it('在字符串中间切开', () => {
    // 在 "hello" 的中间切开
    const cutPoint = fullJson.indexOf('"hello"') + 3 // 在 "hel 和 lo" 之间
    const chunk1 = fullJson.slice(0, cutPoint)
    const chunk2 = fullJson.slice(cutPoint)
    const intents = collectIntents([chunk1, chunk2])
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
      delta('wbs'),
      completed('wbs'),
    ])
  })

  it('在转义符中间切开', () => {
    const json = `{"charter":{"title":"he\\\\llo"},"tasks":[]}`
    // 在反斜杠中间切开
    const cutPoint = json.indexOf('\\\\') + 1
    const chunk1 = json.slice(0, cutPoint)
    const chunk2 = json.slice(cutPoint)
    const intents = collectIntents([chunk1, chunk2])
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })

  it('在键名中间切开', () => {
    const json = `{"charter":{"a":1},"tasks":[]}`
    for (let split = 1; split < json.length - 1; split++) {
      const chunk1 = json.slice(0, split)
      const chunk2 = json.slice(split)
      const intents = collectIntents([chunk1, chunk2])
      // 无论在哪切开，都应正确识别 charter 和 tasks
      const modules = [
        ...new Set(intents.filter((i) => i.kind === 'module.delta').map((i) => i.module)),
      ]
      expect(modules.sort()).toEqual(['charter', 'tasks'])
    }
  })
})

// ── 2.3 降级语义 ─────────────────────────────────────────────────────────

describe('降级语义', () => {
  it('异常时不抛给调用方', () => {
    const state = createScannerState()
    // 传入非 JSON 文本
    const result = scanChunk(state, '{invalid')
    // 应正常返回且可能降级
    expect(Array.isArray(result.intents)).toBe(true)
    expect(typeof result.degraded).toBe('boolean')
  })

  it('降级后继续 scanChunk 不产出新意图', () => {
    const state = createScannerState()
    // 先正常处理
    scanChunk(state, `{"charter":`)
    // 非法的 JSON 内容触发降级
    const corrupt = new Array(10000).fill('x').join('')
    scanChunk(state, corrupt)
    expect(state.degraded).toBe(true)

    // 降级后再给正常 chunk
    const result = scanChunk(state, `{"tasks":[]}`)
    expect(result.intents).toHaveLength(0)
    expect(result.degraded).toBe(true)
  })
})

// ── 2.4 字符串内特殊字符 ──────────────────────────────────────────────────

describe('字符串内的特殊字符', () => {
  it('字符串内含 { } " 时 depth 不被污染', () => {
    const json = `{"charter":{"title":"{hello} world"},"tasks":[]}`
    const intents = collectIntents([json])
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })

  it('中文内容不影响 depth', () => {
    const json = `{"charter":{"title":"项目章程测试"},"tasks":[]}`
    const intents = collectIntents([json])
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })

  it('转义双引号不影响 depth', () => {
    const json = `{"charter":{"title":"he\\"llo"},"tasks":[]}`
    const intents = collectIntents([json])
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })

  it('多层转义', () => {
    const json = `{"charter":{"title":"a\\\\b"},"tasks":[]}`
    const intents = collectIntents([json])
    expect(intents).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })
})

// ── 跨 chunk 状态保留 ───────────────────────────────────────────────────────

describe('跨 chunk 状态', () => {
  it('逐字符输入产出与完整输入一致', () => {
    const json = `{"charter":{"a":1},"tasks":{"b":2}}`
    const perChar = collectIntents(json.split(''))
    const full = collectIntents([json])
    expect(perChar).toEqual(full)
  })

  it('state 在多次 scanChunk 间正确保留', () => {
    const state = createScannerState()
    // 逐步 feed
    const r1 = scanChunk(state, `{"charter":`)
    const r2 = scanChunk(state, `{"title":"t"}`)
    const r3 = scanChunk(state, `,"tasks":`)
    const r4 = scanChunk(state, `[{"id":"t1"}]}`)

    const all = [...r1.intents, ...r2.intents, ...r3.intents, ...r4.intents]
    expect(all).toEqual([
      delta('charter'),
      completed('charter'),
      delta('tasks'),
      completed('tasks'),
    ])
  })
})
