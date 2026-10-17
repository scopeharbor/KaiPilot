import type { CommandContext, CommandEffect, RegisteredCommand } from '@/lib/command-registry/types'
import type {
  NaturalLanguageCommandCandidate,
  NaturalLanguageCommandResult,
  NaturalLanguageConfidence,
  NaturalLanguageResultStrategy,
} from './types'

/**
 * 确定性中文意图解析器（design.md D2）。
 *
 * 输入为面板已按 `requiresPermission` 与 `when` 过滤后的 `visibleCommands`，
 * 因此解析结果天然不含无权限/上下文不符的命令（spec「无权限命令不进入自然语言候选」）。
 *
 * 规则：
 * - 中文动词词典识别意图：导航 / 设置切换 / 写意图（创建、更新、删除、审批、应用、同步等）；
 * - 写意图只映射到 `open-form`/`open-confirm`，没有承接命令时返回阻断候选，绝不猜测执行；
 * - 命令 label/keywords 匹配评分，上下文命令（contextual 分组）加权；
 * - 置信度分级：高 → 主候选；中/多匹配 → 多候选；低 → 空态 + 高级搜索提示。
 */

// ── 词典 ─────────────────────────────────────────────────

/** 写意图动词：创建类（→ open-form）。 */
const FORM_VERBS = ['新建', '创建', '新增', '添加', 'create', 'add', 'new']
/** 写意图动词：确认/审批/应用类（→ open-confirm）。 */
const CONFIRM_VERBS = ['确认', '批准', '审批', '应用', '同意', 'apply', 'approve']
/** 其他写意图动词：更新/删除/同步/落库等，只能降级为 open-form/open-confirm。 */
const OTHER_WRITE_VERBS = [
  '更新',
  '修改',
  '编辑',
  '删除',
  '移除',
  '同步',
  '提交',
  '落库',
  'update',
  'edit',
  'delete',
  'remove',
  'sync',
]
const SETTING_VERBS = ['切换', '切成', '改为', '改成', '设置为', '设为', 'switch']
const NAVIGATE_VERBS = [
  '打开',
  '前往',
  '跳转',
  '进入',
  '查看',
  '看看',
  '看一下',
  '去',
  'open',
  'go',
]

const WRITE_VERBS = [...FORM_VERBS, ...CONFIRM_VERBS, ...OTHER_WRITE_VERBS]

/** 语义填充词，评分前剥离。 */
const FILLER_TOKENS = [
  '这个项目',
  '这个',
  '当前',
  '帮我',
  '我要',
  '我想',
  '一下',
  '一个',
  '请',
  '给',
  '把',
  '的',
]

type IntentKind = 'write' | 'setting' | 'navigate' | 'general'

/** 各意图的偏好副作用；写意图为硬过滤，其余为加权。 */
const PREFERRED_EFFECTS: Record<IntentKind, CommandEffect[] | null> = {
  write: ['open-form', 'open-confirm'],
  setting: ['ui-setting'],
  navigate: ['navigate'],
  general: null,
}

// ── 阈值 ─────────────────────────────────────────────────

const HIGH_SCORE = 8
const MEDIUM_SCORE = 4
const PRIMARY_GAP = 3
const MAX_CANDIDATES = 3
const CONTEXTUAL_BONUS = 2
const PREFERRED_EFFECT_BONUS = 3

const EMPTY_HINT = '未识别该指令，可换个说法，或输入关键词使用高级搜索'

// ── 工具函数 ─────────────────────────────────────────────

function classifyIntent(lowerInput: string): IntentKind {
  if (WRITE_VERBS.some((v) => lowerInput.includes(v))) return 'write'
  if (SETTING_VERBS.some((v) => lowerInput.includes(v))) return 'setting'
  if (NAVIGATE_VERBS.some((v) => lowerInput.includes(v))) return 'navigate'
  return 'general'
}

/** 剥离意图动词与填充词，得到用于匹配命令的目标短语。 */
function extractTargetPhrase(lowerInput: string): string {
  const tokens = [...WRITE_VERBS, ...SETTING_VERBS, ...NAVIGATE_VERBS, ...FILLER_TOKENS].sort(
    (a, b) => b.length - a.length,
  )
  let out = lowerInput
  for (const token of tokens) {
    out = out.split(token).join(' ')
  }
  return out.replace(/\s+/g, ' ').trim()
}

interface ScoredCommand {
  cmd: RegisteredCommand
  score: number
  matchedField: string | null
}

function scoreCommand(cmd: RegisteredCommand, phrase: string, intent: IntentKind): ScoredCommand {
  let score = 0
  let matchedField: string | null = null
  const fields = [cmd.label, ...(cmd.keywords ?? [])]
  if (phrase.length > 0) {
    for (const field of fields) {
      const lowerField = field.toLowerCase()
      let fieldScore = 0
      if (lowerField === phrase) fieldScore = 10
      else if (lowerField.includes(phrase)) fieldScore = 6 + Math.min(phrase.length, 4)
      else if (phrase.length >= 2 && lowerField.length >= 2 && phrase.includes(lowerField))
        fieldScore = 5 + Math.min(lowerField.length, 3)
      if (fieldScore > score) {
        score = fieldScore
        matchedField = field
      }
    }
    // 字符级兜底：短语中的连续二字组命中 label/keywords。
    if (score === 0 && phrase.length >= 2) {
      const haystack = fields.join(' ').toLowerCase()
      let bigramScore = 0
      for (let i = 0; i < phrase.length - 1; i++) {
        if (haystack.includes(phrase.slice(i, i + 2))) bigramScore += 1
      }
      score = bigramScore
    }
  }
  // 上下文加权：当前页面挂载的上下文命令优先（design.md D2）。
  if (score > 0 && cmd.group === 'contextual') score += CONTEXTUAL_BONUS
  // 意图偏好副作用加权（写意图在调用方硬过滤，不走到这里）。
  const preferred = PREFERRED_EFFECTS[intent]
  if (score > 0 && intent !== 'write' && preferred?.includes(cmd.effect)) {
    score += PREFERRED_EFFECT_BONUS
  }
  return { cmd, score, matchedField }
}

function confidenceOf(score: number): NaturalLanguageConfidence {
  return score >= HIGH_SCORE ? 'high' : 'medium'
}

function previewTextOf(cmd: RegisteredCommand): string {
  switch (cmd.effect) {
    case 'navigate':
      return `跳转到「${cmd.label}」`
    case 'ui-setting':
      return `切换设置：${cmd.label}`
    case 'open-form':
      return `打开「${cmd.label}」表单，填写后需手动提交`
    case 'open-confirm':
      return `打开「${cmd.label}」确认界面，确认后才生效`
  }
}

function toCandidate(
  scored: ScoredCommand,
  ctx: CommandContext,
  requiresReview: boolean,
): NaturalLanguageCommandCandidate {
  const { cmd } = scored
  const reasonParts: string[] = []
  if (scored.matchedField) reasonParts.push(`命中「${scored.matchedField}」`)
  if (cmd.group === 'contextual') reasonParts.push(`当前页面（${ctx.pathname}）的快捷操作`)
  return {
    commandId: cmd.id,
    label: cmd.label,
    effect: cmd.effect,
    confidence: confidenceOf(scored.score),
    reason: reasonParts.length > 0 ? reasonParts.join('，') : '与输入内容匹配',
    requiresReview,
    previewText: previewTextOf(cmd),
    command: cmd,
  }
}

function emptyResult(): NaturalLanguageCommandResult {
  return { strategy: 'empty', candidates: [], emptyHint: EMPTY_HINT }
}

function pickStrategy(
  candidates: NaturalLanguageCommandCandidate[],
  scores: number[],
): NaturalLanguageResultStrategy {
  const top = scores[0]
  const second = scores[1]
  if (candidates.length === 0 || top === undefined) return 'empty'
  if (candidates.length === 1 || second === undefined) return 'primary'
  return top - second >= PRIMARY_GAP ? 'primary' : 'multiple'
}

// ── 主入口 ───────────────────────────────────────────────

/**
 * 解析自然语言输入为候选命令。纯函数，无副作用，不调用任何 API。
 */
export function parseNaturalLanguageCommand(
  input: string,
  visibleCommands: RegisteredCommand[],
  ctx: CommandContext,
): NaturalLanguageCommandResult {
  const trimmed = input.trim()
  if (trimmed.length < 2 || visibleCommands.length === 0) return emptyResult()

  const lowerInput = trimmed.toLowerCase()
  const intent = classifyIntent(lowerInput)
  // 只在输入包含动作语句（导航/设置/写意图动词）时生成候选；
  // 普通关键词输入沿用既有 cmdk 过滤与搜索建议，不叠加智能建议分组（proposal「What Changes」）。
  if (intent === 'general') return emptyResult()
  const phrase = extractTargetPhrase(lowerInput)

  const scored = visibleCommands
    .map((cmd) => scoreCommand(cmd, phrase, intent))
    .filter((s) => s.score >= MEDIUM_SCORE)
    .sort((a, b) => b.score - a.score)

  // 写意图：只允许 open-form / open-confirm 承接（design.md D3 硬过滤）。
  if (intent === 'write') {
    const safe = scored.filter((s) => PREFERRED_EFFECTS.write!.includes(s.cmd.effect))
    if (safe.length === 0) {
      return {
        strategy: 'blocked',
        candidates: [
          {
            commandId: null,
            label: '无法直接执行该操作',
            effect: null,
            confidence: 'low',
            reason: '该写意图需要有已注册的表单或确认界面承接，当前没有可用命令',
            requiresReview: true,
            previewText: `「${trimmed}」需要进入对应表单或确认页手动完成`,
            blockedReason: 'write-intent-no-safe-open-target',
          },
        ],
      }
    }
    const top = safe.slice(0, MAX_CANDIDATES)
    const candidates = top.map((s) => toCandidate(s, ctx, true))
    return {
      strategy: pickStrategy(
        candidates,
        top.map((s) => s.score),
      ),
      candidates,
    }
  }

  const top = scored.slice(0, MAX_CANDIDATES)
  const candidates = top.map((s) =>
    toCandidate(s, ctx, s.cmd.effect !== 'navigate' && s.cmd.effect !== 'ui-setting'),
  )
  const strategy = pickStrategy(
    candidates,
    top.map((s) => s.score),
  )
  if (strategy === 'empty') return emptyResult()
  return { strategy, candidates }
}
