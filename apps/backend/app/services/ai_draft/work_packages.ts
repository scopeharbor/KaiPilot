/**
 * 拆解层：能力 → 工作包（2026-09-27）。
 *
 * 原来 WBS 骨架由一次模型调用凭空生成，能力地图只是参考。现在按用户确认的项目理解逐项能力拆工作包：
 * - 每项能力一次独立调用（全新对话），只看项目主干、本能力、其它能力的名称与交付物、业务流程；
 * - 多候选：每项能力并行生成 2 份候选，再由评审调用按标准比较、取长补短合成最终版；
 * - WBS 由程序据此构建：一级 = 能力，二级 = 工作包（叶节点），任务随后按工作包分批生成，
 *   每个任务都能追溯到「能力 › 工作包」。
 */

import type {
  ConfirmedProjectContext,
  ProjectDraftWorkPackage,
  ProjectPlanUnderstanding,
} from '@aiproj/types'
import type { PromptSet } from '../ai_m0/prompts.ts'
import { tryParseJson } from '../ai_m0/recovery.ts'
import { buildSpine, memoryView, type ContextUsageLog } from './draft_memory.ts'
import { relevantBriefLines } from '../ai_intent/requirement_brief_service.ts'

type JsonObject = Record<string, unknown>

export type DecomposeCall = (args: {
  prompt: PromptSet
  promptName: 'draft.decompose.candidate' | 'draft.decompose.judge'
  sentence: string
}) => Promise<string>

const CONCURRENCY = 4

const CANDIDATE_SYSTEM = [
  '你是资深项目经理，正在把项目的一项「能力」拆成工作包。只返回 JSON。',
  '工作包 = 一组连续的工作，产出一个可验收的交付物，工作量 3–20 人天；一项能力拆成 2–5 个工作包。',
  '【工作量预算】effortBudgetDays 是团队在工期内能投入本能力的人天：所有工作包 effortDays 合计不得超过它。' +
    '预算紧就做减法——合并相近的工作、只保留交付必需的工作，不要为了「完整」堆砌工作包；确实装不下的交付物写进 overBudget。',
  '要求：1) 覆盖本能力 deliverables 中的每一项交付物，且不与其它能力（otherCapabilities）重复；',
  '2) 按真实执行顺序排列（设计 → 开发 / 准备 → 联调 / 执行 → 测试 / 验收），包含容易被遗漏但必需的准备、评审、联调、验证工作；',
  '3) deliverable 写可验收的具体产物；doneDefinition 写可观察的完成判定（能量化就量化）；',
  '4) dependsOn 只写真实前置：本能力内用序号（如 "L1"），依赖其它能力写其 id（如 "cap-2"，表示要等那项能力的产出）；',
  '5) 若 requiredStageGates 中的阶段门属于本能力（如测试类能力负责 SIT / UAT），用含该关键词的工作包名称体现。',
  '6) roleEffort 写每个工作包各角色的投入人天（角色名只能用 spine.teamRoster 中的角色，合计等于 effortDays）。',
  'requirementDetails 是用户原始需求里与本能力相关的具体条目（带〔段N〕出处）：工作包必须覆盖其中每一项具体要求，不得遗漏或改写数字。',
  '输出：{"workPackages":[{"key":"L1","name":"…","deliverable":"…","doneDefinition":"…","dependsOn":["cap-1"],"effortDays":8,"roleEffort":{"后端开发":6,"测试":2}}],"overBudget":"预算装不下的内容（没有则空字符串）"}',
].join('\n')

const JUDGE_SYSTEM = [
  '你是项目计划评审专家，正在比较同一项能力的两份工作包拆解，产出最终版。只返回 JSON。',
  '评审标准（按重要性）：1) 是否覆盖该能力全部交付物且不越界；2) 每个工作包是否有可验收的交付物与可观察的完成判定；',
  '3) 颗粒度是否合适（3–20 人天，不过粗不过碎）；4) 执行顺序与前置是否真实；5) 是否遗漏了真实项目里必需的准备 / 评审 / 验证工作。',
  '可以直接选用较好的一份，也可以取长补短合成；但「取长补短」是择优替换，不是把两份合并在一起：' +
    '最终工作包数量不得多于两份候选中较多的那份，effortDays 合计不得超过 effortBudgetDays。输出结构与候选相同，并用一句话说明取舍理由。',
  '6) 工作量是否在预算内（超预算的一份应被扣分）。',
  '输出：{"workPackages":[…],"verdict":"一句话理由"}',
].join('\n')

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

interface RawPackage {
  key: string
  name: string
  deliverable: string
  doneDefinition: string
  dependsOn: string[]
  effortDays: number
  roleEffort?: Record<string, number>
}

function roleEffortOf(value: unknown): Record<string, number> | undefined {
  if (!isObject(value)) return undefined
  const entries = Object.entries(value)
    .map(
      ([role, days]) =>
        [role.trim().slice(0, 20), Math.max(0, Math.round(Number(days) || 0))] as const,
    )
    .filter(([role, days]) => role && days > 0)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function parsePackages(raw: string): RawPackage[] | null {
  const parsed = tryParseJson(raw)
  if (!parsed.ok || !isObject(parsed.value) || !Array.isArray(parsed.value.workPackages))
    return null
  const list = parsed.value.workPackages
    .filter(isObject)
    .slice(0, 10)
    .map((item, index) => ({
      key: str(item.key, 12) || `L${index + 1}`,
      name: str(item.name, 60),
      deliverable: str(item.deliverable, 300),
      doneDefinition: str(item.doneDefinition, 300),
      dependsOn: Array.isArray(item.dependsOn)
        ? item.dependsOn.map((dep) => str(dep, 20)).filter(Boolean)
        : [],
      effortDays: Math.max(1, Math.min(60, Math.round(Number(item.effortDays) || 5))),
      roleEffort: roleEffortOf(item.roleEffort),
    }))
    .filter((item) => item.name && item.deliverable)
  return list.length > 0 ? list : null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await run(items[index])
      }
    }),
  )
  return results
}

export interface DecompositionResult {
  workPackages: ProjectDraftWorkPackage[]
  reviews: Array<{ capabilityId: string; candidates: number; verdict: string }>
  /** 评审后仍明显超出工作量预算的能力（人天）。 */
  overBudget: Array<{ capabilityId: string; requested: number; budget: number }>
}

/**
 * 逐项能力拆工作包（多候选 + 评审合成）。任一能力全部候选失败时整体返回 null，
 * 由调用方退回原来的「模型生成 WBS 骨架」路径。
 */
/**
 * 长需求整理稿里与这项能力相关的条目（没有整理稿或没有相关条目时不带）。
 * 细节不能只停留在理解层：拆工作包时要看到用户原文里对这部分的具体要求。
 */
function requirementDetailsFor(
  context: ConfirmedProjectContext,
  capability: ProjectPlanUnderstanding['capabilities'][number],
) {
  const lines = relevantBriefLines(
    context.requirementBrief,
    [capability.name, capability.purpose, ...capability.deliverables].join(' '),
  )
  return lines || undefined
}

export async function decomposeCapabilities(args: {
  context: ConfirmedProjectContext
  understanding: ProjectPlanUnderstanding
  call: DecomposeCall
  usage?: ContextUsageLog
  requiredStageGates?: readonly string[]
  candidates?: number
  /** 团队在工期内的可用人天（人数 × 工作日 × 投入系数）；未知时为 null（不设硬预算，只限制工作包数）。 */
  capacityPersonDays?: number | null
}): Promise<DecompositionResult | null> {
  const { understanding } = args
  // 按交付物数量把可用人天分给各项能力（至少 3 人天）。
  const weights = understanding.capabilities.map(
    (item) => Math.max(1, item.deliverables.length) + 1,
  )
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  const budgetOf = new Map(
    understanding.capabilities.map((item, index) => [
      item.id,
      args.capacityPersonDays
        ? Math.max(3, Math.round((args.capacityPersonDays * weights[index]!) / weightSum))
        : null,
    ]),
  )
  const candidateCount = Math.max(1, args.candidates ?? 2)
  const capabilities = understanding.capabilities
  const perCapability = await mapWithConcurrency(capabilities, CONCURRENCY, async (capability) => {
    const view = memoryView('decompose.candidate', [
      ['spine', () => buildSpine({ context: args.context, aggregate: {}, understanding })],
      ['capability', () => capability],
      ['requirementDetails', () => requirementDetailsFor(args.context, capability)],
      [
        'effortBudgetDays',
        () => budgetOf.get(capability.id) ?? '未给出团队人数：按精简原则拆 2–5 个工作包',
      ],
      [
        'otherCapabilities',
        () =>
          capabilities
            .filter((item) => item.id !== capability.id)
            .map((item) => ({ id: item.id, name: item.name, deliverables: item.deliverables })),
      ],
      ['businessFlows', (level) => (level >= 1 ? undefined : understanding.businessFlows)],
      ['requiredStageGates', () => args.requiredStageGates ?? []],
    ])
    args.usage?.record(view.usage)
    const prompt = { systemPrompt: CANDIDATE_SYSTEM, userPrompt: JSON.stringify(view.payload) }
    const settled = await Promise.all(
      Array.from({ length: candidateCount }, () =>
        args
          .call({
            prompt,
            promptName: 'draft.decompose.candidate',
            sentence: `拆解工作包：${capability.name}`,
          })
          .then(parsePackages)
          .catch(() => null),
      ),
    )
    const drafts = settled.filter((item): item is RawPackage[] => item !== null)
    if (drafts.length === 0) return null
    if (drafts.length === 1) {
      return {
        capability,
        packages: drafts[0]!,
        verdict: '仅一份候选有效，直接采用',
        candidates: 1,
      }
    }
    try {
      const judgeView = memoryView('decompose.judge', [
        ['spine', () => buildSpine({ context: args.context, aggregate: {}, understanding })],
        ['capability', () => capability],
        ['requirementDetails', () => requirementDetailsFor(args.context, capability)],
        ['effortBudgetDays', () => budgetOf.get(capability.id) ?? null],
        ['candidateA', () => drafts[0]],
        ['candidateB', () => drafts[1]],
      ])
      args.usage?.record(judgeView.usage)
      const raw = await args.call({
        prompt: { systemPrompt: JUDGE_SYSTEM, userPrompt: JSON.stringify(judgeView.payload) },
        promptName: 'draft.decompose.judge',
        sentence: `评审工作包拆解：${capability.name}`,
      })
      const judged = parsePackages(raw)
      const parsed = tryParseJson(raw)
      const verdict = parsed.ok && isObject(parsed.value) ? str(parsed.value.verdict, 200) : ''
      if (judged) {
        return {
          capability,
          packages: judged,
          verdict: verdict || '评审合成',
          candidates: drafts.length,
        }
      }
    } catch {
      // 评审失败：退回第一份候选。
    }
    return {
      capability,
      packages: drafts[0]!,
      verdict: '评审失败，采用第一份候选',
      candidates: drafts.length,
    }
  })
  if (perCapability.some((item) => item === null)) return null

  const workPackages: ProjectDraftWorkPackage[] = []
  const reviews: DecompositionResult['reviews'] = []
  const overBudget: DecompositionResult['overBudget'] = []
  const capabilityIds = new Set(capabilities.map((item) => item.id))
  for (const entry of perCapability) {
    if (!entry) continue
    // 评审版仍超预算 20% 以上：按比例压缩工作量估计（任务按 effortDays 拆，超出的范围在决策与待确认里提示）。
    const budget = budgetOf.get(entry.capability.id)
    const total = entry.packages.reduce((sum, pkg) => sum + pkg.effortDays, 0)
    if (budget && total > budget * 1.2) {
      const ratio = budget / total
      for (const pkg of entry.packages)
        pkg.effortDays = Math.max(1, Math.round(pkg.effortDays * ratio))
      overBudget.push({ capabilityId: entry.capability.id, requested: total, budget })
    }
    const idOf = new Map(
      entry.packages.map((pkg, index) => [pkg.key, `${entry.capability.id}-wp${index + 1}`]),
    )
    entry.packages.forEach((pkg, index) => {
      workPackages.push({
        id: `${entry.capability.id}-wp${index + 1}`,
        capabilityId: entry.capability.id,
        name: pkg.name,
        deliverable: pkg.deliverable,
        doneDefinition: pkg.doneDefinition,
        dependsOn: pkg.dependsOn
          .map((dep) => idOf.get(dep) ?? (capabilityIds.has(dep) ? dep : null))
          .filter(
            (dep): dep is string => dep !== null && dep !== `${entry.capability.id}-wp${index + 1}`,
          ),
        effortDays: pkg.effortDays,
        ...(pkg.roleEffort ? { roleEffort: pkg.roleEffort } : {}),
      })
    })
    reviews.push({
      capabilityId: entry.capability.id,
      candidates: entry.candidates,
      verdict: entry.verdict,
    })
  }
  return { workPackages, reviews, overBudget }
}

const REBALANCE_SYSTEM = [
  '你是资深项目经理。项目已拆成工作包，但按角色核对后，有的角色工作量超出了他们在工期内的可用人天。只返回 JSON。',
  '在不删减交付范围的前提下做单点调整：1) 把能由其它角色完成的工作改派给有余量的角色（只能用 roleCapacity 中的角色）；',
  '2) 按真实工作量重估明显偏大的 effortDays；3) 合并重复的工作。不得把工作量压到不现实。',
  '输出：{"ops":[{"id":"cap-1-wp2","effortDays":6,"roleEffort":{"后端开发":4,"测试":2}}],"reasoning":"一句话","stillOver":"仍然装不下时给用户的具体建议（加几人 / 哪些放二期）"}',
].join('\n')

/** 各角色的投入合计（工作包未给角色时不计）。 */
/** 按系数整体缩放工作包工作量（跨生成记忆的历史校准用），角色投入同比例缩放。 */
export function scaleWorkPackageEffort(workPackages: ProjectDraftWorkPackage[], factor: number) {
  for (const pkg of workPackages) {
    pkg.effortDays = Math.max(1, Math.round(pkg.effortDays * factor))
    if (pkg.roleEffort) {
      pkg.roleEffort = Object.fromEntries(
        Object.entries(pkg.roleEffort).map(([role, days]) => [
          role,
          Math.max(0.5, Math.round(days * factor * 2) / 2),
        ]),
      )
    }
  }
}

export function roleLoads(workPackages: readonly ProjectDraftWorkPackage[]): Map<string, number> {
  const loads = new Map<string, number>()
  for (const pkg of workPackages) {
    for (const [role, days] of Object.entries(pkg.roleEffort ?? {})) {
      loads.set(role, (loads.get(role) ?? 0) + days)
    }
  }
  return loads
}

/**
 * 按角色容量再平衡：某角色投入超出「人数 × 工作日 × 投入系数」15% 以上时，把紧凑的工作包清单与各角色容量交给模型，
 * 做改派 / 重估 / 合并（单次调用、全新对话），再核对一次。返回仍超载的角色与模型建议。
 */
export async function rebalanceRoleLoads(args: {
  workPackages: ProjectDraftWorkPackage[]
  capacity: ReadonlyMap<string, number>
  call: (input: {
    prompt: PromptSet
    promptName: 'draft.decompose.rebalance'
    sentence: string
  }) => Promise<string>
  usage?: ContextUsageLog
}): Promise<{
  rebalanced: boolean
  overloaded: Array<{ role: string; load: number; capacity: number }>
  advice: string | null
}> {
  const overloadedOf = () =>
    [...roleLoads(args.workPackages).entries()]
      .map(([role, load]) => ({ role, load, capacity: args.capacity.get(role) ?? 0 }))
      .filter((item) => item.capacity > 0 && item.load > item.capacity * 1.15)
  const before = overloadedOf()
  if (before.length === 0) return { rebalanced: false, overloaded: [], advice: null }
  const view = memoryView('decompose.rebalance', [
    ['roleCapacity', () => Object.fromEntries(args.capacity)],
    ['overloaded', () => before],
    [
      'workPackages',
      () =>
        args.workPackages.map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          effortDays: pkg.effortDays,
          roleEffort: pkg.roleEffort ?? {},
        })),
    ],
  ])
  args.usage?.record(view.usage)
  let advice: string | null = null
  try {
    const raw = await args.call({
      promptName: 'draft.decompose.rebalance',
      sentence: '按角色容量再平衡工作包',
      prompt: { systemPrompt: REBALANCE_SYSTEM, userPrompt: JSON.stringify(view.payload) },
    })
    const parsed = tryParseJson(raw)
    if (parsed.ok && isObject(parsed.value)) {
      const byId = new Map(args.workPackages.map((pkg) => [pkg.id, pkg]))
      for (const op of Array.isArray(parsed.value.ops) ? parsed.value.ops.filter(isObject) : []) {
        const pkg = byId.get(str(op.id, 40))
        if (!pkg) continue
        if (Number(op.effortDays) >= 1)
          pkg.effortDays = Math.min(60, Math.round(Number(op.effortDays)))
        const roles = roleEffortOf(op.roleEffort)
        if (roles && [...Object.keys(roles)].every((role) => args.capacity.has(role)))
          pkg.roleEffort = roles
      }
      advice = str(parsed.value.stillOver, 300) || null
    }
  } catch {
    // 再平衡失败：保持原拆解，超载在待确认里如实提示。
  }
  return { rebalanced: true, overloaded: overloadedOf(), advice }
}

/** 行业必备阶段门在工作包名称里缺失时，确定性补到测试 / 上线类能力下（任务仍由模型按工作包生成）。 */
/** 阶段先后（按名称识别）：立项 → 需求 → 设计 → 开发 → SIT 等测试 → UAT → 上线 → 稳定期。 */
const PHASE_RANKS: Array<[RegExp, number]> = [
  [/稳定期|保障期|试运行|运维移交|移交运维|hypercare/iu, 7],
  [/上线|投产|切换|割接|切流/u, 6],
  [/uat|用户验收|业务验收/iu, 5],
  [/sit|系统集成测试|集成测试|性能与安全|性能测试|安全测试|等保|测评/iu, 4],
  [/开发与单元测试|单元测试/u, 3],
  [/设计评审|架构与详细设计|详细设计|概要设计/u, 2],
  [/需求分析|需求评审/u, 1],
  [/立项|启动/u, 0],
]
const PROJECT_MANAGEMENT = /项目管理|项目治理|PMO|沟通|协调/u

function phaseRank(name: string): number | null {
  return PHASE_RANKS.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

/**
 * 程序补的阶段门要接上先后：之前一律 `dependsOn: []`，排期时「上线后稳定期观察」被排到开工第一天（实测）。
 * - 依赖排在它之前、阶段最靠后的那批工作包（程序补的或模型拆的都算）；
 * - 从 SIT 起（测试、验收、上线、稳定期）还要等全部普通功能开发工作包（项目管理类除外）。
 * 新补的阶段门没有后继，不会成环。
 */
function gatePredecessors(
  gate: string,
  capabilityOf: ReadonlyMap<string, string>,
  workPackages: readonly ProjectDraftWorkPackage[],
): string[] {
  const rank = phaseRank(gate)
  if (rank === null || rank === 0) return []
  const ranked = workPackages
    .map((pkg) => ({ pkg, rank: phaseRank(pkg.name) }))
    .filter((item): item is { pkg: ProjectDraftWorkPackage; rank: number } => item.rank !== null)
  const earlier = ranked.filter((item) => item.rank < rank)
  const latest = Math.max(-1, ...earlier.map((item) => item.rank))
  const previousPhase = earlier.filter((item) => item.rank === latest).map((item) => item.pkg.id)
  const featureWork =
    rank >= 4
      ? workPackages
          .filter(
            (pkg) =>
              phaseRank(pkg.name) === null &&
              !PROJECT_MANAGEMENT.test(capabilityOf.get(pkg.capabilityId) ?? '') &&
              !PROJECT_MANAGEMENT.test(pkg.name),
          )
          .map((pkg) => pkg.id)
      : []
  return [...new Set([...previousPhase, ...featureWork])]
}

export function ensureStageGateWorkPackages(
  understanding: ProjectPlanUnderstanding,
  workPackages: ProjectDraftWorkPackage[],
  gates: readonly string[],
): string[] {
  const added: string[] = []
  const names = workPackages.map((pkg) => pkg.name).join('|')
  const capabilityOf = new Map(understanding.capabilities.map((item) => [item.id, item.name]))
  for (const gate of gates) {
    if (names.includes(gate)) continue
    const host =
      understanding.capabilities.find((item) => /测试|质量|验收|验证/u.test(item.name)) ??
      understanding.capabilities.find((item) => /上线|发布|切换|交付/u.test(item.name)) ??
      understanding.capabilities[understanding.capabilities.length - 1]
    if (!host) continue
    const index = workPackages.filter((pkg) => pkg.capabilityId === host.id).length + 1
    workPackages.push({
      id: `${host.id}-wp${index}`,
      capabilityId: host.id,
      name: gate,
      deliverable: `${gate}记录与结论报告`,
      doneDefinition: `${gate}准出标准全部满足并经负责人签字确认`,
      dependsOn: gatePredecessors(gate, capabilityOf, workPackages),
      effortDays: 5,
    })
    added.push(gate)
  }
  return added
}

const WBS_MARKER = {
  confidence: 0.85,
  source: 'inferred',
  reason: '按确认的能力地图拆解',
  needsConfirmation: false,
}

/** WBS 由程序构建：一级 = 能力，二级 = 工作包（叶节点）。返回树与「WBS 节点 → 工作包」映射。 */
export function buildWbsFromDecomposition(
  understanding: ProjectPlanUnderstanding,
  workPackages: ProjectDraftWorkPackage[],
): {
  wbs: JsonObject[]
  nodeOfPackage: Map<string, string>
  nodeOfCapability: Map<string, string>
} {
  const nodeOfPackage = new Map<string, string>()
  const nodeOfCapability = new Map<string, string>()
  const wbs = understanding.capabilities
    .map((capability, capIndex) => {
      const packages = workPackages.filter((pkg) => pkg.capabilityId === capability.id)
      if (packages.length === 0) return null
      const nodeId = `wbs-${capIndex + 1}`
      nodeOfCapability.set(capability.id, nodeId)
      return {
        id: nodeId,
        parentId: null,
        outlineCode: `${capIndex + 1}`,
        name: { value: capability.name, marker: WBS_MARKER },
        description: { value: capability.purpose, marker: WBS_MARKER },
        isLeaf: false,
        isNote: false,
        children: packages.map((pkg, pkgIndex) => {
          const childId = `wbs-${capIndex + 1}-${pkgIndex + 1}`
          nodeOfPackage.set(pkg.id, childId)
          return {
            id: childId,
            parentId: nodeId,
            outlineCode: `${capIndex + 1}.${pkgIndex + 1}`,
            name: { value: pkg.name, marker: WBS_MARKER },
            description: {
              value: `交付：${pkg.deliverable}；完成判定：${pkg.doneDefinition}`,
              marker: WBS_MARKER,
            },
            isLeaf: true,
            isNote: false,
            children: [],
          }
        }),
      }
    })
    .filter((node): node is NonNullable<typeof node> => node !== null)
  return { wbs, nodeOfPackage, nodeOfCapability }
}
