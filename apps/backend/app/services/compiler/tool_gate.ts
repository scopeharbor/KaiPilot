/**
 * v2-project-compiler-foundation —— ToolGate（tasks 4.2）。
 *
 * 可见性控制：输入 Stage 的 allowedTools 与全量可用工具描述，
 * 输出当前 Stage 可见工具集合。未授权工具不可见也不可调用。
 */

export interface ToolDescriptor {
  toolId: string
  description: string
  parameters?: Record<string, unknown>
}

export interface AllowedToolEntry {
  toolId: string
  description: string
  required: boolean
}

/** 当前 Stage 可见的工具集合。 */
export interface VisibleToolSet {
  toolIds: string[]
  tools: ToolDescriptor[]
  restricted: boolean
}

/**
 * ToolGate —— Stage 工具可见性门控。
 * 输入 Stage 的 allowedTools 与全量可用工具描述，
 * 输出当前 Stage 可见工具集合。
 */
export class ToolGate {
  /** 全量可用工具描述（toolId → ToolDescriptor）。 */
  readonly #availableTools: Map<string, ToolDescriptor>

  constructor(availableTools: ToolDescriptor[]) {
    this.#availableTools = new Map(availableTools.map((t) => [t.toolId, t]))
  }

  /**
   * 根据 Stage 的 allowedTools 计算可见工具集合。
   * 未授权的工具不可见也不可调用。
   */
  resolve(allowedTools: AllowedToolEntry[]): VisibleToolSet {
    const visible: ToolDescriptor[] = []

    for (const entry of allowedTools) {
      const tool = this.#availableTools.get(entry.toolId)
      if (tool) {
        visible.push(tool)
      }
    }

    return {
      toolIds: visible.map((t) => t.toolId),
      tools: visible,
      restricted: visible.length < this.#availableTools.size,
    }
  }

  /**
   * 判断某工具在当前 Stage 是否可用。
   */
  isAllowed(allowedTools: AllowedToolEntry[], toolId: string): boolean {
    return allowedTools.some((t) => t.toolId === toolId)
  }
}
