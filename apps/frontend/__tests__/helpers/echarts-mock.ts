/**
 * ECharts 在 jsdom 的确定性测试桩（v3-ui-next-chart-gallery design §8.1）。
 *
 * - 由于 jsdom 不具备 Canvas 2D / SVG 容器尺寸解算，测试环境统一以本桩替换
 *   `@/lib/next/echarts-core` 模块：`init` 返回伪实例（setOption/resize/dispose/
 *   on/getOption/isDisposed），并为宿主 DOM 节点回填
 *   `data-echarts-mock-rendered="true"` 的 SVG 结构（html-to-image 截取不抛错）；
 * - 测试断言 setOption 收到的 option（series 数据 / markLine 阈值 / xAxis 类别）
 *   精确验证业务数据映射。
 *
 * 用法（vitest 的 vi.mock 工厂在模块静态导入期间即被执行，因此工厂不得引用
 * 未初始化的导入绑定；本桩把 bundle 挂到 globalThis 上的固定键，工厂与用例
 * 都经 `createEchartsMockBundle()` / `getEchartsMockBundle()` 访问）：
 * ```ts
 * import { ensureLazyEchartsMock } from './helpers/echarts-mock'
 * vi.mock('@/lib/next/echarts-core', () => ({
 *   default: {
 *     init: (dom: HTMLElement) => {
 *       const bundle = ensureLazyEchartsMock()
 *       const instance = new FakeEChartsInstance(dom)
 *       bundle.instances.push(instance)
 *       bundle.lastDom = dom
 *       return instance
 *     },
 *     use: () => undefined,
 *     registerTheme: () => undefined,
 *   },
 * }))
 * beforeEach(() => ensureLazyEchartsMock().reset())
 * ```
 *
 * 注意：vi.mock 工厂在模块静态导入期间即执行，因此工厂体内不得**同步调用**
 * 任何导入绑定（否则 TDZ ReferenceError）；上述写法把对 helper 的调用都推迟到
 * `init` 运行时（此时全部模块已求值完毕），对导入顺序零依赖。
 */
export class FakeEChartsInstance {
  /** 每次 setOption 的入参（notMerge 全量替换语义下按序记录）。 */
  readonly options: unknown[] = []
  disposed = false
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  constructor(public readonly dom: HTMLElement) {
    dom.setAttribute('data-echarts-mock-rendered', 'true')
    dom.innerHTML =
      '<svg data-echarts-mock-rendered="true" xmlns="http://www.w3.org/2000/svg"><g data-mock-canvas></g></svg>'
  }

  setOption(option: unknown): void {
    this.options.push(option)
  }

  on(eventName: string, handler: (...args: unknown[]) => void): void {
    const list = this.listeners.get(eventName) ?? []
    list.push(handler)
    this.listeners.set(eventName, list)
  }

  off(eventName: string, handler: (...args: unknown[]) => void): void {
    const list = this.listeners.get(eventName) ?? []
    this.listeners.set(
      eventName,
      list.filter((candidate) => candidate !== handler),
    )
  }

  resize(): void {
    // jsdom 无真实布局，no-op
  }

  getOption(): unknown {
    return this.options[this.options.length - 1]
  }

  dispose(): void {
    this.disposed = true
  }

  isDisposed(): boolean {
    return this.disposed
  }
}

/** globalThis 上的固定键：同一测试文件内工厂与用例共享同一 bundle。 */
export const ECHARTS_MOCK_KEY = '__aiproj_echarts_mock_bundle__'

export interface EchartsMockBundle {
  /** 创建的实例（含已 dispose；按 init 顺序）。 */
  instances: FakeEChartsInstance[]
  /** 最近一次 init 的 DOM 宿主。 */
  lastDom: HTMLElement | null
  /** 替换 '@/lib/next/echarts-core' 的模块形状（default 导出）。 */
  module: { default: Record<string, unknown> }
  reset: () => void
  /** 最近一次 setOption 的 option（未 setOption 时为 undefined）。 */
  readonly lastOption: unknown
}

/** 工厂：每个测试文件创建独立桩状态。 */
export function createEchartsMockBundle(): EchartsMockBundle {
  const bundle: EchartsMockBundle = {
    instances: [],
    lastDom: null,
    module: { default: {} },
    get lastOption(): unknown {
      const last = bundle.instances[bundle.instances.length - 1]
      return last ? last.getOption() : undefined
    },
    reset: () => {
      bundle.instances.length = 0
      bundle.lastDom = null
    },
  }
  bundle.module.default = {
    init: (dom: HTMLElement) => {
      const instance = new FakeEChartsInstance(dom)
      bundle.instances.push(instance)
      bundle.lastDom = dom
      return instance
    },
    use: () => undefined,
    registerTheme: () => undefined,
  }
  return bundle
}

/** 惰性单例：工厂/用例共享同一 bundle（首次访问时创建并挂到 globalThis）。 */
export function ensureLazyEchartsMock(): EchartsMockBundle {
  const global = globalThis as Record<string, unknown>
  const existing = global[ECHARTS_MOCK_KEY]
  if (existing) return existing as EchartsMockBundle
  const bundle = createEchartsMockBundle()
  global[ECHARTS_MOCK_KEY] = bundle
  return bundle
}

/** 读取本文件已挂载的 bundle（在 vi.mock 工厂执行后可用）。 */
export function getEchartsMockBundle(): EchartsMockBundle {
  return ensureLazyEchartsMock()
}
