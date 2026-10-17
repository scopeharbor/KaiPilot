/**
 * v2-project-compiler-foundation —— ContractValidator（tasks 4.4）。
 *
 * Stage 执行前校验 inputSchema，执行后校验 outputSchema 与 validators。
 * 输入/输出校验失败时返回可写入 Stage Event 的错误摘要，
 * 不把失败输出交给下游。（阻断语义由 Pipeline Executor 实施。）
 */
import type { StageContract } from '@aiproj/compiler-spec'

export interface ValidationError {
  path: string
  message: string
  code: string
}

export interface ValidationResult {
  passed: boolean
  errors: ValidationError[]
  errorSummary: string | null
}

/**
 * ContractValidator —— Stage I/O 契约校验器。
 * 校验结果供 PipelineExecutor 判断下游阻断，错误摘要写入 StageEvent。
 */
export class ContractValidator {
  /**
   * 校验 Stage 输入。
   * 失败时不阻断，但 Executor 应避免将无效输入传给 Stage。
   */
  validateInput<I>(contract: StageContract<I, unknown>, input: unknown): ValidationResult {
    const result = contract.validateInput(input)
    if (result.success) {
      return { passed: true, errors: [], errorSummary: null }
    }
    const errors = result.errors.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: 'INPUT_VALIDATION_ERROR',
    }))
    return {
      passed: false,
      errors,
      errorSummary: `Input validation failed (${errors.length} error(s)): ${errors[0]?.message ?? 'unknown'}`,
    }
  }

  /**
   * 校验 Stage 输出。
   * 失败时 Executor 不应将失败输出交给下游。
   */
  validateOutput<O>(contract: StageContract<unknown, O>, output: unknown): ValidationResult {
    const result = contract.validateOutput(output)
    if (result.success) {
      return { passed: true, errors: [], errorSummary: null }
    }
    const errors = result.errors.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: 'OUTPUT_VALIDATION_ERROR',
    }))
    return {
      passed: false,
      errors,
      errorSummary: `Output validation failed (${errors.length} error(s)): ${errors[0]?.message ?? 'unknown'}`,
    }
  }
}
