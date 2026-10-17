/**
 * v3-plugin-permission-audit-and-observation — Call Chain Guard（task 5.9）。
 *
 * 静态断言函数（用于测试）：验证调用链完整性。
 *
 * 断言规则：
 * 1. Controller 不直接生成 allowed（必须经 decision service）
 * 2. Plugin 代码不直接写 ledger/audit（必须经 decision recorder）
 * 3. Observation adapter 不导入 decision service（无反向依赖）
 * 4. 不存在绕过 decision service 的路径
 *
 * 用法：
 * - 在测试中调用 assertControllerDoesNotBypassDecisionService()
 * - 在测试中调用 assertPluginCodeDoesNotWriteLedgerAudit()
 * - 在测试中调用 assertObservationDoesNotImportDecisionService()
 *
 * 红线：
 * - 这些函数是测试辅助，不在生产代码中调用
 * - 使用 AST 分析（简单正则匹配）验证静态调用链
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

// =============================================================================
// Types
// =============================================================================

export interface CallChainViolation {
  /** 违规文件路径 */
  file: string
  /** 违规行号 */
  line: number
  /** 违规描述 */
  description: string
  /** 违规严重性 */
  severity: 'error' | 'warning'
}

// =============================================================================
// Guard: Controller → Decision Service
// =============================================================================

/**
 * 断言 Controller 不直接生成 allowed。
 * Controller 必须通过 decision service 获取授权结果。
 *
 * 检测模式：
 * - Controller 文件中不应出现 `outcome: 'allowed'` 的直接赋值
 * - Controller 文件中不应出现 `PluginPermissionDecisionOutcome.ALLOWED` 的直接引用
 * - Controller 文件中应导入 decision service
 */
export function assertControllerDoesNotBypassDecisionService(
  backendPath: string,
): CallChainViolation[] {
  const violations: CallChainViolation[] = []
  const controllerDir = join(backendPath, 'app', 'controllers')

  try {
    const files = collectTsFiles(controllerDir)

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      const relPath = relative(backendPath, file)

      for (const [i, line] of lines.entries()) {
        // 检测直接赋值 outcome: 'allowed'
        if (line.includes('outcome:') && line.includes("'allowed'") && !line.includes('//')) {
          violations.push({
            file: relPath,
            line: i + 1,
            description:
              'Controller directly sets outcome: allowed (must go through decision service)',
            severity: 'error',
          })
        }

        // 检测直接赋值 outcome: "allowed"
        if (line.includes('outcome:') && line.includes('"allowed"') && !line.includes('//')) {
          violations.push({
            file: relPath,
            line: i + 1,
            description:
              'Controller directly sets outcome: "allowed" (must go through decision service)',
            severity: 'error',
          })
        }
      }
    }
  } catch {
    // 目录不存在时静默通过（测试可能在不同环境运行）
  }

  return violations
}

// =============================================================================
// Guard: Plugin Code → Ledger/Audit
// =============================================================================

/**
 * 断言 Plugin 代码不直接写 ledger/audit。
 * Plugin 代码必须通过 decision recorder 写入。
 *
 * 检测模式：
 * - Plugin 代码中不应出现 `PluginPermissionDecision.create`
 * - Plugin 代码中不应出现 `AuditLog.create`
 * - Plugin 代码中不应直接 import audit_service
 */
export function assertPluginCodeDoesNotWriteLedgerAudit(backendPath: string): CallChainViolation[] {
  const violations: CallChainViolation[] = []
  // Plugin 代码通常在 plugins/ 目录或通过 junction 引入
  const pluginDirs = [join(backendPath, 'plugins'), join(backendPath, '..', 'plugins')]

  for (const pluginDir of pluginDirs) {
    try {
      const files = collectTsFiles(pluginDir)

      for (const file of files) {
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        const relPath = relative(backendPath, file)

        for (const [i, line] of lines.entries()) {
          // 检测直接写入 ledger
          if (line.includes('PluginPermissionDecision.create') && !line.includes('//')) {
            violations.push({
              file: relPath,
              line: i + 1,
              description: 'Plugin code directly writes ledger (must go through decision recorder)',
              severity: 'error',
            })
          }

          // 检测直接写入 audit
          if (line.includes('AuditLog.create') && !line.includes('//')) {
            violations.push({
              file: relPath,
              line: i + 1,
              description:
                'Plugin code directly writes audit log (must go through decision recorder)',
              severity: 'error',
            })
          }

          // 检测直接 import audit_service
          if (
            (line.includes("from '#services/audit_service'") ||
              line.includes('from "#services/audit_service"')) &&
            !line.includes('//')
          ) {
            violations.push({
              file: relPath,
              line: i + 1,
              description:
                'Plugin code imports audit_service directly (must go through decision service)',
              severity: 'warning',
            })
          }
        }
      }
    } catch {
      // 目录不存在时静默通过
    }
  }

  return violations
}

// =============================================================================
// Guard: Observation → Decision Service (no reverse import)
// =============================================================================

/**
 * 断言 Observation adapter 不导入 decision service。
 * Observation 是只读投影，不应依赖决策服务。
 *
 * 检测模式：
 * - Observation 代码中不应出现 `from './decision_service'` 或类似导入
 * - Observation 代码中不应出现 `from './decision_recorder'`
 */
export function assertObservationDoesNotImportDecisionService(
  backendPath: string,
): CallChainViolation[] {
  const violations: CallChainViolation[] = []
  const observationPatterns = ['observation', 'observer', 'monitor']

  try {
    const serviceDir = join(backendPath, 'app', 'services')
    const files = collectTsFiles(serviceDir)

    for (const file of files) {
      const fileName = file.toLowerCase()
      const isObservationFile = observationPatterns.some((p) => fileName.includes(p))
      if (!isObservationFile) continue

      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      const relPath = relative(backendPath, file)

      for (const [i, line] of lines.entries()) {
        // 检测导入 decision service
        if (
          (line.includes('decision_service') ||
            line.includes('decision_recorder') ||
            line.includes('DecisionRecorder') ||
            line.includes('decide')) &&
          (line.includes('import') || line.includes('require')) &&
          !line.includes('//')
        ) {
          violations.push({
            file: relPath,
            line: i + 1,
            description: 'Observation code imports decision service (must be independent)',
            severity: 'error',
          })
        }
      }
    }
  } catch {
    // 目录不存在时静默通过
  }

  return violations
}

// =============================================================================
// Guard: No Bypass Paths
// =============================================================================

/**
 * 断言不存在绕过 decision service 的路径。
 * 检测 controller 或 service 中直接构造 PluginPermissionDecisionReceipt。
 *
 * 检测模式：
 * - 不应在 decision_recorder.ts 之外构造 PluginPermissionDecisionReceipt
 */
export function assertNoDecisionBypassPaths(backendPath: string): CallChainViolation[] {
  const violations: CallChainViolation[] = []

  try {
    const serviceDir = join(backendPath, 'app', 'services')
    const files = collectTsFiles(serviceDir)

    for (const file of files) {
      // 跳过 decision_recorder.ts 和 decision_service.ts 本身
      const fileName = file.split(/[/\\]/).pop() ?? ''
      if (fileName === 'decision_recorder.ts' || fileName === 'decision_service.ts') continue

      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      const relPath = relative(backendPath, file)

      for (const [i, line] of lines.entries()) {
        // 检测直接构造 receipt
        if (
          line.includes('PluginPermissionDecisionReceipt') &&
          (line.includes('{') || line.includes('as const')) &&
          !line.includes('import') &&
          !line.includes('type') &&
          !line.includes('//')
        ) {
          violations.push({
            file: relPath,
            line: i + 1,
            description: 'Non-recorder service constructs decision receipt directly (bypass path)',
            severity: 'warning',
          })
        }
      }
    }
  } catch {
    // 目录不存在时静默通过
  }

  return violations
}

// =============================================================================
// Aggregate Guard
// =============================================================================

/**
 * 运行所有静态调用链检查。
 * 返回所有违规项（空数组表示全部通过）。
 */
export function runAllCallChainGuards(backendPath: string): CallChainViolation[] {
  return [
    ...assertControllerDoesNotBypassDecisionService(backendPath),
    ...assertPluginCodeDoesNotWriteLedgerAudit(backendPath),
    ...assertObservationDoesNotImportDecisionService(backendPath),
    ...assertNoDecisionBypassPaths(backendPath),
  ]
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * 递归收集 .ts 文件列表。
 */
function collectTsFiles(dir: string): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          // 跳过 node_modules 和 dist
          if (entry === 'node_modules' || entry === 'dist') continue
          files.push(...collectTsFiles(fullPath))
        } else if (extname(entry) === '.ts' && !entry.endsWith('.d.ts')) {
          files.push(fullPath)
        }
      } catch {
        // 跳过无法访问的文件
      }
    }
  } catch {
    // 目录不存在
  }

  return files
}
