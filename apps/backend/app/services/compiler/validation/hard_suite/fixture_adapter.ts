/**
 * @aiproj/backend —— Fixture Adapter：确定性输入提供器（测试用）。
 *
 * 当 deterministic baseline 接口未完成时，用此 adapter 提供 fixture 数据。
 * 使 HardValidationSuite 保持可编译和可测试。
 *
 * @aiproj/backend
 */

import type { DeterministicInputProvider } from './hard_validation_suite.js'

/**
 * Fixture 数据提供器。
 * 所有字段为 optional——未提供的字段对应输入标记为不可用。
 */
export interface FixtureProviderOptions {
  graphValidation?: unknown
  schedule?: unknown
  criticalPath?: unknown
  resourceLoad?: unknown
  diff?: unknown
  pdmSnapshot?: unknown
}

/**
 * Fixture Adapter：基于可选数据的确定性输入提供器。
 */
export class FixtureAdapter implements DeterministicInputProvider {
  readonly #data: FixtureProviderOptions

  constructor(data: FixtureProviderOptions = {}) {
    this.#data = data
  }

  allRequiredAvailable(_ruleIds: string[]): boolean {
    return true
  }

  getGraphValidation(): unknown {
    return this.#data.graphValidation
  }

  getSchedule(): unknown {
    return this.#data.schedule
  }

  getCriticalPath(): unknown {
    return this.#data.criticalPath
  }

  getResourceLoad(): unknown {
    return this.#data.resourceLoad
  }

  getDiff(): unknown {
    return this.#data.diff
  }

  getPdmSnapshot(): unknown {
    return this.#data.pdmSnapshot
  }
}
