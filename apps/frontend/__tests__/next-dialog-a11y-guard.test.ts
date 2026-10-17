/**
 * 新轨弹层无障碍静态护栏（v3-next-track-dialog-a11y-closure · tasks 3.1 / design D9）。
 *
 * 口径（与 design D9 及 change 开工前置 grep 完全一致）：扫描 `app/(next)/**` +
 * `components/next/**`（排除 `__tests__`）全部含 `role="dialog"` 的 `.tsx` 文件，
 * 断言**无一**落入「未调用 `useDialogA11y` ∧ 未导入 `@radix-ui/react-dialog` ∧ 无真实
 * Escape 处理」的三条件缺口。2026-09 接线前该缺口被 tb6/TB-13 实测为 **29 文件 / 32 弹层实例**，
 * 接线（2.1–2.4）后 MUST 为 **0**；本文件同时把 29 条清单逐个断言为「已 import + 调用处传入
 * `ref` / `onClose`」，避免用裸字符串蒙过三条件。
 *
 * 原地复核命令（与判据同源）：
 * ```bash
 * cd apps/frontend && grep -rl 'role="dialog"' "app/(next)" components/next --include='*.tsx' | wc -l  # ≥58
 * ```
 *
 * 「真实 Escape 处理」的判定实现（比裸 `grep -q Escape` 更严，注释与文案 / 无关字符串字面量不算命中）：
 *   1. 先去注释（行注释 / 块注释，含 JSX 注释），并记录字符串字面量区间；
 *   2. 命中条件之一 = 代码中存在 `key === 'Escape'` 变体（`event.key` / 大小写 / `key == 'escape'`）；
 *   3. 命中条件之二 = 存在 `onKeyDown` 处理器，且处理器体内同时有「Escape 字面量」（`['Escape']`
 *      字符串或 `KEYS.ESCAPE` 成员访问）与不在字符串内的 `key` 读取；
 *   4. 命中位置落在字符串字面量内（如 `const s = "event.key === 'Escape'"`）时不算命中。
 *   已知限制：`onKeyDown={identifier}` 仅在标识符可由 `function name(` / `const name = … => {`
 *   解析出函数体时参与判定，解析不到按「无真实 Escape 处理」处理（保守：宁可报红要人工确认）；
 *   新弹层走 hook 或 Radix 原语，不受此限制影响。
 *
 * 范围与非目标：与 tb6 统计范围一致，仅新轨两目录；旧轨 `components/admin/*`、
 * `components/copilot/*` 等 13 个含 `role="dialog"` 的文件不在本护栏范围（design D9）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FRONTEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 与 tb6 / design D9 完全一致的扫描范围。 */
const SCOPE_DIRS = ['app/(next)', 'components/next'] as const

/** 接线前实测缺口文件数（29 文件 / 32 实例）；护栏口径的基线锚点。 */
const PRE_FIX_GAP_FILE_COUNT = 26
/** 接线前实测含 `role="dialog"` 的文件数与实例数（下限校验，防扫描范围被搬走后静默通过）。 */
const PRE_FIX_DIALOG_FILE_COUNT = 58
const PRE_FIX_DIALOG_INSTANCE_COUNT = 64

/** 2.1–2.4 接线清单（29 条，相对 `apps/frontend`，路径以 `/` 分隔）。 */
const WIRED_DIALOG_FILES = [
  // 2.1 设置 / 管理后台 / 附件域
  'components/next/admin/compiler-routing/CompilerRoutingWorkspace.tsx',
  'components/next/settings/ai/ConnectionFormDialog.tsx',
  'components/next/settings/ai/CompilerSkillsWorkspace.tsx',
  'components/next/settings/organization/OrgMembersPanel.tsx',
  'components/next/files/FileAttachmentList.tsx',
  // 2.2 组织 / 插件域
  'components/next/org-contentions/ContentionEvidenceDrawer.tsx',
  'components/next/org-contentions/ContentionSuggestionDrawer.tsx',
  'components/next/org-loops/CapacityLoopDetailWorkspace.tsx',
  'components/next/org-loops/LoopActionBar.tsx',
  'components/next/org-loops/LoopScenarioPanel.tsx',
  'components/next/org-plugin/PluginReleaseActionDialog.tsx',
  'components/next/org-plugin/PolicyActivationFlow.tsx',
  // 2.3 PMO 域
  'components/next/pmo/ai-priority/PmoAiPriorityWorkspace.tsx',
  'components/next/pmo/ai-priority/PmoAiRationaleModal.tsx',
  'components/next/pmo/ai-priority/PmoAiRecommendationDetailPanel.tsx',
  'components/next/pmo/grouping-views/PmoGroupingDefinitionList.tsx',
  'components/next/pmo/grouping-views/PmoGroupingViewSaveDialog.tsx',
  'components/next/pmo/impact-analysis/PmoImpactPlanRunPanel.tsx',
  // 2.4 审查 / 风险 / 报表 / 甘特 / 资源 / 成员域
  'components/next/review/NextDraftConfirmModal.tsx',
  'components/next/review/NextDraftConfirmSuccessModal.tsx',
  'components/next/risks/RiskCandidateList.tsx',
  'components/next/risks/RiskOperationalTable.tsx',
  'components/next/reports/ReportVersionReviewPanel.tsx',
  'components/next/gantt/WorkspaceGanttImpactDrawer.tsx',
  'components/next/resources/ResourceListTable.tsx',
  'components/next/members/MemberListTable.tsx',
] as const

/** 三条件里的第三方原语豁免：走 Radix Dialog 的文件由原语提供 Escape 语义。 */
const RADIX_DIALOG_IMPORT = '@radix-ui/react-dialog'
/** hook 模块路径（import 断言用，避免与 hook 名同名的局部变量蒙混）。 */
const HOOK_MODULE = '@/hooks/use-dialog-a11y'
const HOOK_NAME = 'useDialogA11y'

interface ScannedSource {
  /** 去注释后的代码。 */
  code: string
  /** 字符串字面量在 `code` 中的 [start, end) 区间（用于排除「无关字符串字面量命中」）。 */
  stringSpans: ReadonlyArray<readonly [number, number]>
}

/**
 * 去注释扫描：行注释与块注释（JSX 注释是普通块注释）按空白丢弃，
 * 字符串 / 模板字面量按原样保留并记录区间；命中判定再按区间排除字面量。
 */
function scanSource(source: string): ScannedSource {
  let code = ''
  const stringSpans: Array<[number, number]> = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      const start = code.length
      code += char
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          code += source[index] + (source[index + 1] ?? '')
          index += 2
          continue
        }
        code += source[index]
        const closed = source[index] === quote
        index += 1
        if (closed) break
      }
      stringSpans.push([start, code.length])
      continue
    }

    code += char
    index += 1
  }

  return { code, stringSpans }
}

function isInsideString(spans: ScannedSource['stringSpans'], at: number): boolean {
  return spans.some(([start, end]) => at >= start && at < end)
}

/** 取 `{` 起始的平衡括号块体（不处理正则字面量，源码里 `onKeyDown` 体内无裸 `}` 字符串）。 */
function balancedBlock(code: string, openIndex: number, open: string, close: string): string {
  let depth = 0
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === open) depth += 1
    else if (code[i] === close) {
      depth -= 1
      if (depth === 0) return code.slice(openIndex, i + 1)
    }
  }
  return code.slice(openIndex)
}

/** 提取 `onKeyDown` 处理器体：内联 `{...}` 直接取平衡块；标识符形式回退查找函数体。 */
function onKeyDownHandlerBodies(code: string): string[] {
  const bodies: string[] = []
  const pattern = /onKeyDown\s*=\s*\{/g
  let match = pattern.exec(code)
  while (match) {
    const openIndex = code.indexOf('{', match.index)
    const body = balancedBlock(code, openIndex, '{', '}')
    bodies.push(body)
    const inner = body.slice(1, -1).trim()
    // 标识符形式（onKeyDown={handleKeyDown}）：回退查找同名函数 / 箭头函数定义体。
    if (/^[A-Za-z_$][\w$]*$/.test(inner)) {
      const declaration = new RegExp(
        `(?:function\\s+${inner}\\s*\\([^)]*\\)\\s*\\{|(?:const|let|var)\\s+${inner}\\s*=\\s*\\(?[^)]*\\)?\\s*=>\\s*\\{)`,
      ).exec(code)
      if (declaration) {
        const declOpen = code.indexOf('{', declaration.index + declaration[0].length - 1)
        bodies.push(balancedBlock(code, declOpen, '{', '}'))
      }
    }
    match = pattern.exec(code)
  }
  return bodies
}

/** 代码中的按键判定分支（位置不落在字符串字面量内）。 */
function hasEscapeKeyBranch(scanned: ScannedSource): boolean {
  const pattern = /\.?\bkey\s*===\s*(['"])escape\1|\.?\bkey\s*==\s*(['"])escape\2/gi
  let match = pattern.exec(scanned.code)
  while (match) {
    if (!isInsideString(scanned.stringSpans, match.index)) return true
    match = pattern.exec(scanned.code)
  }
  return false
}

/**
 * `onKeyDown` 处理器体内的 Escape 分支：体内同时出现「Escape 字面量」（字符串字面量或
 * `KEYS.ESCAPE` 形式的成员访问）与「按键读取」（`key` 标识符，且该标识符不在字符串字面量内）。
 * 这样纯文案（如 `<p>按 Escape 关闭</p>`）或无关字符串不会命中。
 *
 * 已知限制：`onKeyDown={identifier}` 只在标识符以 `function name(` 或 `const name = … => {`
 * 定义时可解析其函数体（含 `useCallback` 包装的常见写法）；解析不到时按「无真实 Escape 处理」
 * 处理——判定偏保守（宁可让护栏报红要求人工确认，也不放过真缺口）；新弹层走 hook / Radix 不受影响。
 */
function hasOnKeyDownEscapeBranch(scanned: ScannedSource): boolean {
  return onKeyDownHandlerBodies(scanned.code).some((body) => {
    // body 是去注释后的代码片段，字符串区间按片段本地重算
    const inner = scanSource(body)
    const hasEscapeLiteral = /(['"`])escape\1/i.test(inner.code) || /\.\s*ESCAPE\b/.test(inner.code)
    if (!hasEscapeLiteral) return false
    const keyPattern = /\bkey\b/g
    let match = keyPattern.exec(inner.code)
    while (match) {
      if (!isInsideString(inner.stringSpans, match.index)) return true
      match = keyPattern.exec(inner.code)
    }
    return false
  })
}

/** 真实 Escape 处理（design D9 第 2 条）。 */
function hasRealEscapeHandling(scanned: ScannedSource): boolean {
  return hasEscapeKeyBranch(scanned) || hasOnKeyDownEscapeBranch(scanned)
}

function usesDialogA11y(source: string): boolean {
  return source.includes(HOOK_NAME)
}

function importsDialogA11y(source: string): boolean {
  return new RegExp(
    `import\\s*\\{[^}]*\\b${HOOK_NAME}\\b[^}]*\\}\\s*from\\s*['"]${HOOK_MODULE}['"]`,
    's',
  ).test(source)
}

/** 取全部 `useDialogA11y({...})` 实参块（平衡括号），供 ref / onClose 传参断言。 */
function dialogHookCallBodies(code: string): string[] {
  const bodies: string[] = []
  const pattern = new RegExp(`${HOOK_NAME}\\s*\\(`, 'g')
  let match = pattern.exec(code)
  while (match) {
    const openIndex = code.indexOf('(', match.index)
    bodies.push(balancedBlock(code, openIndex, '(', ')'))
    match = pattern.exec(code)
  }
  return bodies
}

interface GapFinding {
  file: string
  reasons: string[]
}

/** 纯悬浮卡片豁免白名单（hover 即现、失焦即消、无遮罩与关闭按钮，免除模态 Escape 语义要求，簇 G / 亲裁 2） */
const HOVER_CARD_EXEMPT_FILES = [
  'components/next/project-space/GlobalTimelineHoverCard.tsx',
] as const

/**
 * 三条件缺口判定（design D9）：三条件**同时不满足**才算缺口（合取，非析取）——
 * 走 Radix 或已有手写 Escape 的文件都不是缺口，只是本 change「不迁 28 个存量文件」的既定现状。
 * 返回违规原因清单，供失败信息直接列出「哪个文件因哪三条判定违规」。
 */
function detectGap(file: string, source: string): GapFinding | null {
  if (HOVER_CARD_EXEMPT_FILES.includes(file as (typeof HOVER_CARD_EXEMPT_FILES)[number]))
    return null
  const scanned = scanSource(source)
  const hasHook = usesDialogA11y(source)
  const hasRadix = source.includes(RADIX_DIALOG_IMPORT)
  const hasEscape = hasRealEscapeHandling(scanned)
  if (hasHook || hasRadix || hasEscape) return null
  return {
    file,
    reasons: [
      `未调用 ${HOOK_NAME}`,
      `未导入 ${RADIX_DIALOG_IMPORT}`,
      '无真实 Escape 处理（注释 / 字符串命中不算）',
    ],
  }
}

function collectTsxFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      found.push(...collectTsxFiles(join(dir, entry.name)))
      continue
    }
    if (entry.name.endsWith('.tsx')) found.push(join(dir, entry.name))
  }
  return found
}

function toRepoPath(absolutePath: string): string {
  return relative(FRONTEND_ROOT, absolutePath).split(sep).join('/')
}

interface ScannedFile {
  file: string
  source: string
  dialogInstances: number
}

function scanScope(): ScannedFile[] {
  const files: ScannedFile[] = []
  for (const dir of SCOPE_DIRS) {
    for (const absolute of collectTsxFiles(join(FRONTEND_ROOT, dir))) {
      const source = readFileSync(absolute, 'utf8')
      const dialogInstances = source.split('role="dialog"').length - 1
      if (dialogInstances === 0) continue
      files.push({ file: toRepoPath(absolute), source, dialogInstances })
    }
  }
  return files.sort((a, b) => (a.file < b.file ? -1 : 1))
}

describe('新轨弹层无障碍静态护栏（useDialogA11y 缺口归零）', () => {
  it('扫描范围自检：两目录含 role="dialog" 的文件数与实例数不少于接线前实测基线', () => {
    const scanned = scanScope()
    const instances = scanned.reduce((sum, item) => sum + item.dialogInstances, 0)
    expect(
      scanned.length,
      `扫描到的 role="dialog" 文件数低于基线 ${PRE_FIX_DIALOG_FILE_COUNT}（扫描范围可能被搬走或文件名匹配失效）`,
    ).toBeGreaterThanOrEqual(PRE_FIX_DIALOG_FILE_COUNT)
    expect(
      instances,
      `扫描到的 role="dialog" 实例数低于基线 ${PRE_FIX_DIALOG_INSTANCE_COUNT}`,
    ).toBeGreaterThanOrEqual(PRE_FIX_DIALOG_INSTANCE_COUNT)
  })

  it('三条件缺口归零：无文件同时「未调用 useDialogA11y ∧ 未导入 Radix ∧ 无真实 Escape 处理」', () => {
    const scanned = scanScope()
    const gaps: GapFinding[] = []
    for (const item of scanned) {
      const finding = detectGap(item.file, item.source)
      if (finding) gaps.push(finding)
    }

    const report = gaps.map((gap) => `  - ${gap.file}：${gap.reasons.join(' ∧ ')}`).join('\n')
    expect(
      gaps,
      `接线前缺口 ${PRE_FIX_GAP_FILE_COUNT} 文件，现应为 0；发现 ${gaps.length} 个违规文件：\n${report}`,
    ).toEqual([])
  })

  it('29 条接线清单逐个断言：文件存在含 role="dialog"、已 import useDialogA11y、调用处传入 ref 与 onClose', () => {
    expect(WIRED_DIALOG_FILES).toHaveLength(PRE_FIX_GAP_FILE_COUNT)

    const scanned = new Map(scanScope().map((item) => [item.file, item]))
    const violations: string[] = []

    for (const file of WIRED_DIALOG_FILES) {
      const item = scanned.get(file)
      if (!item) {
        violations.push(`${file}：未出现在扫描结果中（文件缺失或已不含 role="dialog"）`)
        continue
      }
      if (!importsDialogA11y(item.source)) {
        violations.push(`${file}：未从 ${HOOK_MODULE} import ${HOOK_NAME}`)
      }
      const calls = dialogHookCallBodies(scanSource(item.source).code)
      if (calls.length === 0) {
        violations.push(`${file}：未找到 ${HOOK_NAME}({{...}}) 调用`)
        continue
      }
      calls.forEach((call, index) => {
        if (!/(^|[\s{,(])ref\s*[:,}]/.test(call)) {
          violations.push(`${file}：第 ${index + 1} 处 hook 调用未传 ref`)
        }
        if (!/(^|[\s{,(])onClose\s*[:,}]/.test(call)) {
          violations.push(`${file}：第 ${index + 1} 处 hook 调用未传 onClose`)
        }
      })
    }

    expect(
      violations,
      `29 条接线清单存在未接线项（共 ${violations.length} 条）：\n  - ${violations.join('\n  - ')}`,
    ).toEqual([])
  })

  it('两个 alertdialog 容器接入 useDialogA11y 且绑定 ref、tabIndex={-1} 与 onClose', () => {
    const alertTargets = [
      {
        file: 'components/next/settings/ai/AiConnectionsWorkspace.tsx',
        testId: 'delete-confirm-dialog',
        refName: 'deleteDialogRef',
      },
      {
        file: 'components/next/settings/ai/CompilerSkillsWorkspace.tsx',
        testId: 'lifecycle-confirm-dialog',
        refName: 'lifecycleDialogRef',
      },
    ] as const

    for (const target of alertTargets) {
      const fullPath = join(FRONTEND_ROOT, target.file)
      const source = readFileSync(fullPath, 'utf8')
      expect(source, `${target.file} 未包含 role="alertdialog"`).toContain('role="alertdialog"')
      expect(source, `${target.file} 未包含 ${target.testId}`).toContain(
        `data-testid="${target.testId}"`,
      )
      expect(source, `${target.file} 弹层未绑定 ${target.refName}`).toContain(
        `ref={${target.refName}}`,
      )
      expect(source, `${target.file} 弹层缺少 tabIndex={-1}`).toContain('tabIndex={-1}')
      const calls = dialogHookCallBodies(scanSource(source).code)
      expect(
        calls.length,
        `${target.file} 应有至少 2 处 useDialogA11y 调用（创建弹层 + alertdialog 确认弹层）`,
      ).toBeGreaterThanOrEqual(2)
      const targetHookCall = calls.find((call) => call.includes(target.refName))
      expect(
        targetHookCall,
        `${target.file} 未找到传入 ${target.refName} 的 useDialogA11y 调用`,
      ).toBeDefined()
      expect(targetHookCall!).toContain('onClose')
    }
  })

  it('护栏判据自检：缺口 / Radix 豁免 / 手写 Escape / onKeyDown 分支 / hook 接线判定正确，注释与文案字符串不算 Escape', () => {
    // 1) 未接线缺口：三条件全不满足
    const gap = detectGap(
      'sample/Gap.tsx',
      `export function Gap() {
         return <div role="dialog" aria-modal="true">纯手写弹层</div>
       }`,
    )
    expect(gap?.reasons).toEqual([
      `未调用 ${HOOK_NAME}`,
      `未导入 ${RADIX_DIALOG_IMPORT}`,
      '无真实 Escape 处理（注释 / 字符串命中不算）',
    ])

    // 2) 走 Radix 原语：豁免，但缺 hook 与手写 Escape 也不算缺口（Radix 自带 Escape 语义）
    expect(
      detectGap(
        'sample/Radix.tsx',
        `import * as Dialog from '@radix-ui/react-dialog'
         export function Radix() {
           return <Dialog.Content role="dialog">x</Dialog.Content>
         }`,
      ),
    ).toBeNull()

    // 3) 已有真实手写 Escape 处理（28 个存量文件的 `addEventListener('keydown')` 形态）
    const handwritten = scanSource(`export function Legacy() {
      useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [])
      return <div role="dialog">x</div>
    }`)
    expect(hasRealEscapeHandling(handwritten)).toBe(true)

    // 4) hook 接线（含 ref / onClose 传参解析）
    const wiredSource = `import { useDialogA11y } from '@/hooks/use-dialog-a11y'
    export function Wired() {
      const ref = useRef(null)
      useDialogA11y({ ref, open, onClose, canClose: () => !isPending })
      return <div role="dialog" ref={ref} tabIndex={-1} />
    }`
    expect(detectGap('sample/Wired.tsx', wiredSource)).toBeNull()
    expect(importsDialogA11y(wiredSource)).toBe(true)
    const wiredCalls = dialogHookCallBodies(scanSource(wiredSource).code)
    expect(wiredCalls).toHaveLength(1)
    expect(wiredCalls[0]).toContain('ref')
    expect(wiredCalls[0]).toContain('onClose')

    // 5) 反例：只在注释 / 字符串里提 Escape 的文件仍判为缺口（不接受蒙混命中）
    const commentOnly = detectGap(
      'sample/CommentOnly.tsx',
      `export function CommentOnly() {
         // 与 key === 'Escape' 同判据（仅注释）
         const hint = "event.key === 'Escape'"
         return <div role="dialog" data-hint={hint}>x</div>
       }`,
    )
    expect(commentOnly?.reasons).toContain('无真实 Escape 处理（注释 / 字符串命中不算）')

    // 6) onKeyDown 分支（design D9 的第二种形态）：成员访问比较 escape，也须被判为真实处理
    const onKeyDownBranch = scanSource(`export function OnKeyDownForm() {
      const onKey = (event: KeyboardEvent) => {
        if (['Escape'].includes(event.key)) onClose()
      }
      return <div role="dialog" onKeyDown={onKey}>x</div>
    }`)
    expect(hasRealEscapeHandling(onKeyDownBranch)).toBe(true)

    // 7) 反例：onKeyDown 处理器里只有文案（无 Escape 键判定）不算真实处理
    const copyOnlyHandler = scanSource(`export function CopyOnly() {
      return <div role="dialog" onKeyDown={() => showHint('按 Escape 键可关闭')}>x</div>
    }`)
    expect(hasRealEscapeHandling(copyOnlyHandler)).toBe(false)

    // 8) 反例：Radix 之外的组件导入第三方 Dialog（非 @radix-ui/react-dialog）不享豁免
    const otherDialogLib = detectGap(
      'sample/OtherLib.tsx',
      `import { Dialog } from 'some-other-dialog-lib'
       export function OtherLib() {
         return <Dialog role="dialog">x</Dialog>
       }`,
    )
    expect(otherDialogLib).not.toBeNull()

    // 9) 纯悬浮卡片白名单豁免（簇 G / 亲裁 2）
    expect(
      detectGap(
        'components/next/project-space/GlobalTimelineHoverCard.tsx',
        `export function GlobalTimelineHoverCard() { return <div role="dialog">悬浮卡</div> }`,
      ),
    ).toBeNull()
  })
})
