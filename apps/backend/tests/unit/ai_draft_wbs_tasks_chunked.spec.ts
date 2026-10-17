import { describe, expect, it } from 'vitest'
import {
  collectWbsLeaves,
  createChunkedWbsTasksCache,
  generateWbsTasksChunked,
  nestFlatWbs,
  normalizeWbsLeafFlags,
  planLeafChunks,
  salvageTopLevelArray,
  type ChunkCall,
} from '#services/ai_draft/wbs_tasks_chunked'
import { computeDraftGranularity } from '#services/ai_draft/granularity_guide'

const marker = {
  confidence: 0.9,
  source: 'inferred',
  reason: '按领域惯例',
  needsConfirmation: false,
}
const field = (value: unknown) => ({ value, marker })

function node(
  id: string,
  parentId: string | null,
  outlineCode: string,
  leaf: boolean,
  children: unknown[] = [],
) {
  return {
    id,
    parentId,
    outlineCode,
    name: field(`节点${outlineCode}`),
    description: field(''),
    isLeaf: leaf,
    isNote: false,
    children,
  }
}

/** 两个一级分支：分支 1 有 10 个叶节点（需切成 2 批），分支 2 有 3 个叶节点。 */
function nestedWbs() {
  const branch1Leaves = Array.from({ length: 10 }, (_, i) =>
    node(`wbs-1-${i + 1}`, 'wbs-1', `1.${i + 1}`, true),
  )
  const branch2Leaves = Array.from({ length: 3 }, (_, i) =>
    node(`wbs-2-${i + 1}`, 'wbs-2', `2.${i + 1}`, true),
  )
  return [
    node('wbs-1', null, '1', false, branch1Leaves),
    node('wbs-2', null, '2', false, branch2Leaves),
  ]
}

function tasksFor(leafIds: string[]) {
  return leafIds.flatMap((leafId, i) =>
    [0, 1].map((k) => ({
      id: `task-${i * 2 + k + 1}`,
      wbsNodeId: leafId,
      name: field(`${leafId} 任务 ${k + 1}`),
      description: field('产出物与完成标准'),
      status: 'not_started',
      durationDays: field(5),
      startDate: field('2026-10-12'),
      endDate: field('2026-10-16'),
      assigneeHint: field('后端开发组'),
    })),
  )
}

function leafIdsFromPrompt(userPrompt: string): string[] {
  const input = JSON.parse(userPrompt) as { targetLeaves?: Array<{ id: string }> }
  return (input.targetLeaves ?? []).map((leaf) => leaf.id)
}

const target = computeDraftGranularity({
  teamSize: 25,
  startDate: '2026-10-12',
  endDate: '2027-04-15',
})

describe('collectWbsLeaves / planLeafChunks', () => {
  it('嵌套 children 形态：识别可执行叶节点及其一级分支', () => {
    const { leaves, rootNames, outline } = collectWbsLeaves(nestedWbs())
    expect(leaves).toHaveLength(13)
    expect(new Set(leaves.map((leaf) => leaf.rootId))).toEqual(new Set(['wbs-1', 'wbs-2']))
    expect(rootNames.get('wbs-1')).toBe('节点1')
    expect(outline).toHaveLength(15)
  })

  it('parentId 扁平形态同样可展开', () => {
    const flat = [
      node('wbs-1', null, '1', false),
      node('wbs-2', 'wbs-1', '1.1', false),
      node('wbs-3', 'wbs-2', '1.1.1', true),
      node('wbs-4', 'wbs-2', '1.1.2', true),
    ]
    const { leaves } = collectWbsLeaves(flat)
    expect(leaves.map((leaf) => leaf.id)).toEqual(['wbs-3', 'wbs-4'])
    expect(leaves.every((leaf) => leaf.rootId === 'wbs-1')).toBe(true)
  })

  it('按一级分支分组，每批不超过 8 个叶节点，且不跨分支', () => {
    const chunks = planLeafChunks(collectWbsLeaves(nestedWbs()).leaves)
    expect(chunks.map((chunk) => chunk.length)).toEqual([8, 2, 3])
    for (const chunk of chunks) expect(new Set(chunk.map((leaf) => leaf.rootId)).size).toBe(1)
  })
})

describe('salvageTopLevelArray / nestFlatWbs', () => {
  it('内容完整、仅末尾缺闭合括号时逐元素抢救成功', () => {
    const raw = '{"wbs":[{"id":"a","name":"含 } 与 ] 的\\"文本\\""},{"id":"b"}'
    expect(salvageTopLevelArray(raw, 'wbs')).toEqual([
      { id: 'a', name: '含 } 与 ] 的"文本"' },
      { id: 'b' },
    ])
  })

  it('元素写到一半（真实截断）拒绝抢救，交给重试', () => {
    expect(salvageTopLevelArray('{"wbs":[{"id":"a"},{"id":"b","name":"写到一', 'wbs')).toBeNull()
    expect(salvageTopLevelArray('{"wbs":[{"id":"a"},{"id":', 'wbs')).toBeNull()
  })

  it('扁平节点按 parentId 组装成树，悬空 parentId 升为根', () => {
    const tree = nestFlatWbs([
      { id: 'r', parentId: null, children: [] },
      { id: 'c1', parentId: 'r', children: [] },
      { id: 'g1', parentId: 'c1', children: [] },
      { id: 'orphan', parentId: 'missing', children: [] },
    ]) as Array<{
      id: string
      parentId: string | null
      children: Array<{ id: string; children: Array<{ id: string }> }>
    }>
    expect(tree.map((item) => item.id)).toEqual(['r', 'orphan'])
    expect(tree[1].parentId).toBeNull()
    expect(tree[0].children[0].children[0].id).toBe('g1')
  })
})

describe('generateWbsTasksChunked', () => {
  it('骨架 1 次 + 每批 1 次；合并后任务统一重排为 task-1…task-N', async () => {
    const calls: string[] = []
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      calls.push(input.step)
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: nestedWbs() })
      return JSON.stringify({ tasks: tasksFor(leafIdsFromPrompt(prompt.userPrompt)) })
    }
    const merged = JSON.parse(
      await generateWbsTasksChunked({
        groundingFacts: [],
        priorArtifacts: { charter: {} },
        target,
        repairErrors: [],
        cache: createChunkedWbsTasksCache(),
        call,
        onChunk: () => undefined,
      }),
    ) as { wbs: unknown[]; tasks: Array<{ id: string; wbsNodeId: string }> }

    expect(calls.filter((step) => step === 'wbs_skeleton')).toHaveLength(1)
    expect(calls.filter((step) => step === 'branch_tasks')).toHaveLength(3)
    expect(merged.wbs).toHaveLength(2)
    expect(merged.tasks).toHaveLength(26)
    expect(merged.tasks.map((task) => task.id)).toEqual(
      Array.from({ length: 26 }, (_, i) => `task-${i + 1}`),
    )
    expect(new Set(merged.tasks.map((task) => task.wbsNodeId)).size).toBe(13)
  })

  it('分支请求并行执行', async () => {
    let inFlight = 0
    let peak = 0
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: nestedWbs() })
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      inFlight--
      return JSON.stringify({ tasks: tasksFor(leafIdsFromPrompt(prompt.userPrompt)) })
    }
    await generateWbsTasksChunked({
      groundingFacts: [],
      priorArtifacts: { charter: {} },
      target,
      repairErrors: [],
      cache: createChunkedWbsTasksCache(),
      call,
      onChunk: () => undefined,
    })
    expect(peak).toBeGreaterThan(1)
  })

  it('单批断流或漏覆盖叶节点时只重跑该批', async () => {
    const attemptsByBatch = new Map<string, number>()
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: nestedWbs() })
      const leafIds = leafIdsFromPrompt(prompt.userPrompt)
      const key = leafIds[0]
      const attempt = (attemptsByBatch.get(key) ?? 0) + 1
      attemptsByBatch.set(key, attempt)
      if (key === 'wbs-1-1' && attempt === 1) throw new Error('sse_interrupted')
      // 分支 2 首次漏掉一个叶节点。
      if (key === 'wbs-2-1' && attempt === 1)
        return JSON.stringify({ tasks: tasksFor(leafIds.slice(1)) })
      return JSON.stringify({ tasks: tasksFor(leafIds) })
    }
    const merged = JSON.parse(
      await generateWbsTasksChunked({
        groundingFacts: [],
        priorArtifacts: { charter: {} },
        target,
        repairErrors: [],
        cache: createChunkedWbsTasksCache(),
        call,
        onChunk: () => undefined,
      }),
    ) as { tasks: unknown[] }
    expect(merged.tasks).toHaveLength(26)
    expect(attemptsByBatch.get('wbs-1-1')).toBe(2)
    expect(attemptsByBatch.get('wbs-2-1')).toBe(2)
    expect(attemptsByBatch.get('wbs-1-9')).toBe(1)
  })

  it('重试后仍失败则整体抛错，交给阶段的 provider 重试逻辑', async () => {
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: nestedWbs() })
      throw new Error('sse_interrupted')
    }
    await expect(
      generateWbsTasksChunked({
        groundingFacts: [],
        priorArtifacts: { charter: {} },
        target,
        repairErrors: [],
        cache: createChunkedWbsTasksCache(),
        call,
        onChunk: () => undefined,
      }),
    ).rejects.toThrow('sse_interrupted')
  })

  it('修复轮次复用骨架与未出错批次，只重跑错误所在批次，并把 tasks[i] 改写成任务名', async () => {
    const cache = createChunkedWbsTasksCache()
    const log: Array<{ step: string; firstLeaf?: string; system: string }> = []
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      const leafIds = leafIdsFromPrompt(prompt.userPrompt)
      log.push({ step: input.step, firstLeaf: leafIds[0], system: prompt.systemPrompt })
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: nestedWbs() })
      return JSON.stringify({ tasks: tasksFor(leafIds) })
    }
    const base = { groundingFacts: [], priorArtifacts: { charter: {} }, target, cache, call }
    await generateWbsTasksChunked({ ...base, repairErrors: [], onChunk: () => undefined })
    log.length = 0

    // 合并后第 17 个任务（下标 16）属于第 2 批（分支 1 的第 9–10 个叶节点）。
    await generateWbsTasksChunked({
      ...base,
      repairErrors: [{ path: 'tasks[16].endDate', message: '超出章程结束日期' }],
      onChunk: () => undefined,
    })
    expect(log.map((entry) => entry.step)).toEqual(['branch_tasks'])
    expect(log[0].firstLeaf).toBe('wbs-1-9')
    expect(log[0].system).toContain('任务「wbs-1-9 任务 1」.endDate: 超出章程结束日期')
  })

  it('WBS 结构类错误才重跑骨架；定位不到任务的错误重跑全部批次但复用骨架', async () => {
    const cache = createChunkedWbsTasksCache()
    const steps: string[] = []
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      steps.push(input.step)
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: nestedWbs() })
      return JSON.stringify({ tasks: tasksFor(leafIdsFromPrompt(prompt.userPrompt)) })
    }
    const base = { groundingFacts: [], priorArtifacts: { charter: {} }, target, cache, call }
    await generateWbsTasksChunked({ ...base, repairErrors: [], onChunk: () => undefined })

    steps.length = 0
    await generateWbsTasksChunked({
      ...base,
      repairErrors: [{ path: '(root)', message: 'HL-001: 遗漏已确认事实' }],
      onChunk: () => undefined,
    })
    expect(steps.filter((step) => step === 'wbs_skeleton')).toHaveLength(0)
    expect(steps.filter((step) => step === 'branch_tasks')).toHaveLength(3)

    steps.length = 0
    await generateWbsTasksChunked({
      ...base,
      repairErrors: [{ path: 'wbs.1.3', message: '可执行 WBS 叶节点未映射任何任务' }],
      onChunk: () => undefined,
    })
    expect(steps.filter((step) => step === 'wbs_skeleton')).toHaveLength(1)
  })

  it('骨架以扁平列表返回时按 parentId 组装成树，再按分支生成任务', async () => {
    const flat = [
      node('wbs-1', null, '1', false),
      ...Array.from({ length: 3 }, (_, i) => node(`wbs-1-${i + 1}`, 'wbs-1', `1.${i + 1}`, true)),
      node('wbs-2', null, '2', false),
      ...Array.from({ length: 2 }, (_, i) => node(`wbs-2-${i + 1}`, 'wbs-2', `2.${i + 1}`, true)),
    ]
    const call: ChunkCall = async ({ prompt }) => {
      const input = JSON.parse(prompt.userPrompt) as { step: string }
      if (input.step === 'wbs_skeleton') return JSON.stringify({ wbs: flat })
      return JSON.stringify({ tasks: tasksFor(leafIdsFromPrompt(prompt.userPrompt)) })
    }
    const merged = JSON.parse(
      await generateWbsTasksChunked({
        groundingFacts: [],
        priorArtifacts: { charter: {} },
        target,
        repairErrors: [],
        cache: createChunkedWbsTasksCache(),
        call,
        onChunk: () => undefined,
      }),
    ) as { wbs: Array<{ id: string; children: Array<{ id: string }> }>; tasks: unknown[] }
    expect(merged.wbs.map((root) => root.id)).toEqual(['wbs-1', 'wbs-2'])
    expect(merged.wbs[0].children.map((child) => child.id)).toEqual([
      'wbs-1-1',
      'wbs-1-2',
      'wbs-1-3',
    ])
    expect(merged.tasks).toHaveLength(10)
  })

  it('按真实父子关系修正 isLeaf 标错的节点', () => {
    const wbs = nestedWbs() as Array<{ isLeaf: boolean; children: Array<{ isLeaf: boolean }> }>
    wbs[0].isLeaf = true
    wbs[0].children[0].isLeaf = false
    expect(normalizeWbsLeafFlags(wbs)).toBe(true)
    expect(wbs[0].isLeaf).toBe(false)
    expect(wbs[0].children[0].isLeaf).toBe(true)
    expect(normalizeWbsLeafFlags(wbs)).toBe(false)
  })
})
