/**
 * 图表馆 TRIZ 分馆测试夹具与伪后端（v3-triz-contradiction-copilot W7 · tasks 7.1-7.6）。
 *
 * 铁律（design D15 / tasks 7.1-7.6 验收）：
 * - `fetch` 一律用 `vi.stubGlobal` 伪后端，严禁 `vi.mock('@/lib/api/*')` 式自证；
 * - 夹具按后端真实响应形状构造（对齐 W4 的 Controller 响应信封 `{ data, meta }`）；
 * - 提供网络监控工具函数（用于断言只读零写与汇出零网络请求）。
 */
import { vi } from 'vitest'
import type {
  TrizGalleryArtifactDTO,
  TrizGalleryMatrixPrinciplesResult,
  TrizNineWindowsPrefillDraft,
  TrizFunctionAnalysisPrefillDraft,
} from '@/lib/api/triz-gallery'

export const TEST_PROJECT_ID = 42

export interface RecordedFetchRequest {
  url: string
  method: string
  body: Record<string, unknown> | null
}

export interface TrizGalleryFakeBackend {
  calls: RecordedFetchRequest[]
  count: (urlFragment: string, method?: string) => number
  writeCalls: () => RecordedFetchRequest[]
  resetCalls: () => void
  restore: () => void
  setMatrixResult: (result: TrizGalleryMatrixPrinciplesResult) => void
  setNineWindowsDraft: (draft: TrizNineWindowsPrefillDraft) => void
  setFunctionAnalysisDraft: (draft: TrizFunctionAnalysisPrefillDraft) => void
  setArtifacts: (artifacts: TrizGalleryArtifactDTO[]) => void
}

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

export function makeSampleMatrixResult(
  improving: number,
  worsening: number,
  matched = true,
): TrizGalleryMatrixPrinciplesResult {
  if (!matched) {
    return {
      improving: {
        number: improving,
        displayName: `参数 ${improving}`,
        nameZh: `参数 ${improving}`,
        nameEn: `Parameter ${improving}`,
        category: '测试分类',
        pmMeaning: '测试含义',
      },
      worsening: {
        number: worsening,
        displayName: `参数 ${worsening}`,
        nameZh: `参数 ${worsening}`,
        nameEn: `Parameter ${worsening}`,
        category: '测试分类',
        pmMeaning: '测试含义',
      },
      matched: false,
      empty: true,
      hint: '该组合暂无收录的推荐原则',
      mappings: [],
      principles: [],
      knowledgePack: {
        version: '1.0.0',
        parametersCount: 39,
        principlesCount: 40,
        scenariosCount: 14,
      },
    }
  }

  return {
    improving: {
      number: improving,
      displayName: '交付速度',
      nameZh: '速度',
      nameEn: 'Speed',
      category: '动力与时间效率',
      pmMeaning: '开发 / 交付速度',
    },
    worsening: {
      number: worsening,
      displayName: '工期延误',
      nameZh: '时间损失',
      nameEn: 'Loss of Time',
      category: '动力与时间效率',
      pmMeaning: '项目工期延误与等待',
    },
    matched: true,
    empty: false,
    hint: null,
    mappings: [
      {
        kind: 'pm-pair',
        id: 'PM-01',
        title: '交付速度 vs 工期延误',
        scenario: '在压缩工期时避免因混乱产生更大的时间浪费',
        principleNumbers: [10, 28, 35],
        recommendations: ['预先准备好开发环境与测试脚手架', '引入自动化度量与流水线替代人工对齐'],
        source: 'triz-fundamentals.md §3.3 · PM-01',
      },
    ],
    principles: [
      {
        number: 10,
        displayName: '预先作用',
        nameZh: '预先作用',
        nameEn: 'Preliminary Action',
        nameRu: 'Принцип предварительного действия',
        definition: '预先对物体（或流程）施加必要的变化或预先安排对象。',
        pmInterpretation: '预先搭建脚手架，在阻塞发生前完成依赖准备。',
      },
      {
        number: 28,
        displayName: '机械系统替代',
        nameZh: '机械系统替代',
        nameEn: 'Replacement of Mechanical System',
        nameRu: 'Замена механической схемы',
        definition: '用光学、声学、电磁或自动化系统替代物理机械系统。',
        pmInterpretation: '用 CI/CD 与自动化脚本替代人工手工操作。',
      },
      {
        number: 35,
        displayName: '参数变化',
        nameZh: '物理或化学参数改变',
        nameEn: 'Parameter Changes',
        nameRu: 'Изменение параметров',
        definition: '改变物体的物理状态、浓度、温度或灵活性。',
        pmInterpretation: '调整冲刺周期粒度或团队工作流模式以适应变更。',
      },
    ],
    knowledgePack: {
      version: '1.0.0',
      parametersCount: 39,
      principlesCount: 40,
      scenariosCount: 14,
    },
  }
}

export function makeSampleNineWindowsDraft(): TrizNineWindowsPrefillDraft {
  return {
    persisted: false,
    requiresHumanConfirmation: true,
    path: 'ai',
    fallbackReasons: [],
    qualityFlags: [],
    contextRefs: ['task:101', 'risk:201'],
    artifactType: 'nine_windows',
    centerKey: 'present.system',
    filledCells: 8,
    cells: [
      {
        key: 'past.supersystem',
        timeAxis: 'past',
        levelAxis: 'supersystem',
        timeLabel: '过去',
        levelLabel: '外部环境 / 市场 / 组织',
        prompt: '过去的外部环境与行业先例',
        text: '过去的行业采用传统单体部署，组织以年度立项为主。',
        source: 'template',
        contextRefs: [],
        locked: false,
      },
      {
        key: 'present.supersystem',
        timeAxis: 'present',
        levelAxis: 'supersystem',
        timeLabel: '现在',
        levelLabel: '外部环境 / 市场 / 组织',
        prompt: '当前的外部环境、组织制度与生态约束',
        text: '当前多云微服务并行，敏捷双周迭代，跨团队沟通链路长。',
        source: 'model',
        contextRefs: [],
        locked: false,
      },
      {
        key: 'future.supersystem',
        timeAxis: 'future',
        levelAxis: 'supersystem',
        timeLabel: '未来',
        levelLabel: '外部环境 / 市场 / 组织',
        prompt: '未来的外部演化趋势与长期组织期望',
        text: '未来期望实现全自动化智能交付雷达与端到端闭环。',
        source: 'model',
        contextRefs: [],
        locked: false,
      },
      {
        key: 'past.system',
        timeAxis: 'past',
        levelAxis: 'system',
        timeLabel: '过去',
        levelLabel: '当前系统',
        prompt: '系统的历史版本与早期形态',
        text: '系统初代功能单一，缺乏高可用冗余设计。',
        source: 'template',
        contextRefs: [],
        locked: false,
      },
      {
        key: 'present.system',
        timeAxis: 'present',
        levelAxis: 'system',
        timeLabel: '现在',
        levelLabel: '当前系统',
        prompt: '【中心锁定】当前核心痛点与主要矛盾',
        text: '【当前痛点】频繁需求插入导致计划滑移，交付速度与系统稳定性冲突。',
        source: 'model',
        contextRefs: ['task:101'],
        locked: true,
      },
      {
        key: 'future.system',
        timeAxis: 'future',
        levelAxis: 'system',
        timeLabel: '未来',
        levelLabel: '当前系统',
        prompt: '系统理想化最终结果 (IFR)',
        text: '系统达到自适应解耦，变更影响面收敛在单一服务单元。',
        source: 'model',
        contextRefs: [],
        locked: false,
      },
      {
        key: 'past.subsystem',
        timeAxis: 'past',
        levelAxis: 'subsystem',
        timeLabel: '过去',
        levelLabel: '组件 / 模块 / 角色',
        prompt: '早期内部组件与分工方式',
        text: '手工测试与无自动化回归脚本。',
        source: 'template',
        contextRefs: [],
        locked: false,
      },
      {
        key: 'present.subsystem',
        timeAxis: 'present',
        levelAxis: 'subsystem',
        timeLabel: '现在',
        levelLabel: '组件 / 模块 / 角色',
        prompt: '当前关键组件状态与资源负荷',
        text: '关键开发人员负荷达 120%，自动化用例覆盖率不足 40%。',
        source: 'model',
        contextRefs: ['risk:201'],
        locked: false,
      },
      {
        key: 'future.subsystem',
        timeAxis: 'future',
        levelAxis: 'subsystem',
        timeLabel: '未来',
        levelLabel: '组件 / 模块 / 角色',
        prompt: '未来组件自治与工具协同形态',
        text: 'Copilot 辅助单元测试生成，解耦核心业务组件。',
        source: 'model',
        contextRefs: [],
        locked: false,
      },
    ],
  }
}

export function makeSampleFunctionAnalysisDraft(): TrizFunctionAnalysisPrefillDraft {
  return {
    persisted: false,
    requiresHumanConfirmation: true,
    path: 'ai',
    fallbackReasons: [],
    qualityFlags: [],
    contextRefs: ['task:101', 'risk:201'],
    artifactType: 'function_analysis',
    nodes: [
      { id: 'n1', kind: 'system', label: '项目交付主系统', source: 'template', contextRef: null },
      { id: 'n2', kind: 'task', label: '核心算法研发', source: 'template', contextRef: 'task:101' },
      { id: 'n3', kind: 'risk', label: '联调延期风险', source: 'template', contextRef: 'risk:201' },
    ],
    edges: [
      {
        id: 'e1',
        from: 'n2',
        to: 'n1',
        edgeType: 'useful',
        label: '提供核心能力',
        source: 'template',
      },
      {
        id: 'e2',
        from: 'n3',
        to: 'n1',
        edgeType: 'harmful',
        label: '侵蚀交付缓冲',
        source: 'template',
      },
    ],
    problemCandidates: [
      {
        id: 'prob-1',
        kind: 'harmful_accumulation',
        message: '联调延期风险对主系统形成有害侵蚀',
        contextRefs: ['risk:201'],
      },
      {
        id: 'prob-2',
        kind: 'insufficient_coverage',
        message: '测试资源对主干系统支持不足，建议引入自动化回归',
        contextRefs: ['resource:301'],
      },
    ],
  }
}

export function installTrizGalleryFakeBackend(): TrizGalleryFakeBackend {
  const calls: RecordedFetchRequest[] = []

  let matrixResult = makeSampleMatrixResult(9, 25, true)
  let nineWindowsDraft = makeSampleNineWindowsDraft()
  let functionAnalysisDraft = makeSampleFunctionAnalysisDraft()
  let storedArtifacts: TrizGalleryArtifactDTO[] = []
  let nextArtifactId = 100

  const originalFetch = globalThis.fetch

  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let parsedBody: Record<string, unknown> | null = null
    if (init?.body && typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = { raw: init.body }
      }
    }

    calls.push({ url: urlStr, method, body: parsedBody })

    // 0. project detail
    if (urlStr.match(/\/projects\/(\d+)$/) && method === 'GET') {
      const match = urlStr.match(/\/projects\/(\d+)$/)
      const id = Number(match?.[1])
      if (id === 999) {
        return jsonResponse(404, { message: '项目不存在' })
      }
      return jsonResponse(200, {
        data: {
          id: id || TEST_PROJECT_ID,
          name: '北极星协同平台',
          identifier: 'NORTH',
          organizationId: 1,
          status: 'active',
          description: '测试项目',
        },
      })
    }

    // 1. matrix-principles
    if (urlStr.includes('/triz-gallery/matrix-principles')) {
      const url = new URL(urlStr, 'http://localhost:3333')
      const imp = Number(url.searchParams.get('improving'))
      const wor = Number(url.searchParams.get('worsening'))
      // 若参数对为 99, 99 则返回空单元
      if (imp === 99 || wor === 99) {
        return jsonResponse(200, { data: makeSampleMatrixResult(imp, wor, false) })
      }
      return jsonResponse(200, { data: matrixResult })
    }

    // 2. prefill
    if (urlStr.includes('/triz-gallery/prefill')) {
      if (urlStr.includes('artifactType=nine_windows')) {
        return jsonResponse(200, { data: nineWindowsDraft })
      }
      return jsonResponse(200, { data: functionAnalysisDraft })
    }

    // 3. evolution trend analyses (只读)
    if (urlStr.includes('/triz/evolution-trend-analyses')) {
      return jsonResponse(200, {
        data: [
          {
            id: 1,
            projectId: TEST_PROJECT_ID,
            status: 'completed',
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
      })
    }

    // 4. triz-gallery-artifacts CRUD
    if (urlStr.includes('/triz-gallery-artifacts')) {
      // POST: 创建快照
      if (method === 'POST') {
        const body = parsedBody || {}
        const newArtifact: TrizGalleryArtifactDTO = {
          id: ++nextArtifactId,
          organizationId: 1,
          projectId: TEST_PROJECT_ID,
          artifactType:
            (body.artifactType as TrizGalleryArtifactDTO['artifactType']) || 'contradiction_matrix',
          artifactTypeLabel: '分馆产物',
          content: (body.content as Record<string, unknown>) || {},
          version: 1,
          isCurrent: true,
          createdBy: 1,
          updatedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          deleted: false,
        }
        storedArtifacts.unshift(newArtifact)
        return jsonResponse(201, { data: newArtifact })
      }

      // PATCH: 更新快照
      if (method === 'PATCH') {
        const idMatch = urlStr.match(/\/triz-gallery-artifacts\/(\d+)/)
        const id = idMatch ? Number(idMatch[1]) : 0
        const found = storedArtifacts.find((a) => a.id === id)
        if (found) {
          found.version += 1
          found.content = (parsedBody?.content as Record<string, unknown>) || found.content
          found.updatedAt = new Date().toISOString()
          return jsonResponse(200, { data: { ...found, previousVersion: found.version - 1 } })
        }
      }

      // DELETE: 软删除
      if (method === 'DELETE') {
        const idMatch = urlStr.match(/\/triz-gallery-artifacts\/(\d+)/)
        const id = idMatch ? Number(idMatch[1]) : 0
        storedArtifacts = storedArtifacts.filter((a) => a.id !== id)
        return jsonResponse(200, {
          data: { artifactType: 'nine_windows', deletedRows: 1, version: 1, deleted: true },
        })
      }

      // GET: 列表
      return jsonResponse(200, {
        data: storedArtifacts,
        meta: { total: storedArtifacts.length, page: 1, perPage: 20, totalPages: 1 },
      })
    }

    // 默认 200
    return jsonResponse(200, { data: {} })
  })

  vi.stubGlobal('fetch', fakeFetch)

  return {
    calls,
    count(urlFragment: string, method?: string): number {
      return calls.filter(
        (c) => c.url.includes(urlFragment) && (!method || c.method === method.toUpperCase()),
      ).length
    },
    writeCalls(): RecordedFetchRequest[] {
      return calls.filter((c) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.method))
    },
    resetCalls() {
      calls.length = 0
    },
    restore() {
      vi.stubGlobal('fetch', originalFetch)
    },
    setMatrixResult(res: TrizGalleryMatrixPrinciplesResult) {
      matrixResult = res
    },
    setNineWindowsDraft(d: TrizNineWindowsPrefillDraft) {
      nineWindowsDraft = d
    },
    setFunctionAnalysisDraft(d: TrizFunctionAnalysisPrefillDraft) {
      functionAnalysisDraft = d
    },
    setArtifacts(a: TrizGalleryArtifactDTO[]) {
      storedArtifacts = [...a]
    },
  }
}
