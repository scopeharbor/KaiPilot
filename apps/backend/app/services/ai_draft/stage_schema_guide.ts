/**
 * 草案生成提示词的共享输出契约 —— 单一事实来源（single source of truth）。
 *
 * 背景（实测缺陷）：原分阶段 `stagePrompt` 只告诉模型「输出 requiredOutputFields 对应的
 * JSON」，不给字段结构、AIMarker 契约或示例，模型只能自造结构（如 charter 输出
 * `{projectType, businessConcepts}`）；前四阶段又只查字段存在性而放行，
 * 最终在 reconcile_review 的全量 zod 校验处必然失败（STAGE_GENERATION_FAILED）。
 *
 * 本文件把原来只存在于 `prompt_builder.ts` SYSTEM_PROMPT（单次生成路径）里的
 * 契约拆成可复用常量，供两条生成路径共用：
 *   - 单次路径：`prompt_builder.buildPromptSet` 组合全部模块结构说明；
 *   - 分阶段路径：`generation_service.stagePrompt` 按阶段注入对应模块结构 + 示例 + 硬规则。
 * 修改契约规则时只改这里，两条路径不漂移。
 */

import type { ProjectDraftGenerationStage } from '@aiproj/types'

/** 提示词/结构契约版本：与 checkpoint 复用条件绑定。 */
export const DRAFT_STAGE_GUIDE_VERSION = '2.1' as const

/**
 * 任务可执行标准（任务翻译器）：拿到任务的人不用再问就能开工。
 * 计划层任务 1–5 个工作日；steps 是任务内部清单，每步约半天，写成可勾选的动作。
 */
export const DRAFT_TASK_EXECUTION_GUIDE = `【任务可执行标准】每个任务必须带 execution（普通对象，不用 Marked）：
{"purpose":"为什么做：它解决计划中的哪个问题、不做会怎样（20–60 字）",
 "inputs":["开工前必须具备的输入：前置任务产出、资料、环境、权限、决策"],
 "outputs":["完成后交付的具体产物（文档名 / 功能 / 记录），下游任务会用到"],
 "doneCriteria":["可验证的完成标准，能量化就写数值（如用例通过率 ≥ 95%、评审意见全部关闭）"],
 "steps":["动词开头的执行步骤，每步约半天，2–10 步"],
 "reviewerRole":"验收人角色"}
任务名用「动词 + 对象 + 结果」（如「完成订单服务接口联调并出具联调报告」），不用「推进 / 跟进 / 完善 / 相关工作」这类空泛说法。
计划层任务工期 1–5 个工作日；等待型任务（测评、试运行、观察期、审批）最多 15 个工作日；超过就拆成多个任务。`

/** AIMarker 契约 + 高影响字段规则 + 输出语言（两条生成路径共用，逐字一致）。 */
export const DRAFT_MARKER_CONTRACT_GUIDE = `【AIMarker 契约】草案中所有内容字段必须包装为 Marked 结构：
{"value": <实际值>, "marker": {"confidence": 0到1的数字, "source": "inferred", "reason": "简体中文说明依据", "needsConfirmation": 布尔}}。
【高影响字段强制 needsConfirmation=true】charter.startDate/endDate、task.durationDays/startDate/endDate/assigneeHint、dependency.lagDays、risk.level、milestone.targetDate。
【reason 精简】高影响字段的 reason 不超过 25 字并写出估算依据；其余字段的 reason 不超过 10 字（如"来自已确认事实"、"按领域惯例"）。把篇幅留给 name/description 等业务内容，不要在 reason 里重复 value。
【输出语言】所有 name/description/reason/statement 用简体中文。`

/** ID 命名约定：跨字段引用（任务→WBS、依赖→任务、里程碑/验收→任务）全部依赖这些 id 保持一致。 */
export const DRAFT_ID_CONVENTION_GUIDE = `【ID 约定】wbs 节点 id 用 "wbs-1"、"wbs-2"…；任务 id 用 "task-1"、"task-2"…；依赖 id 用 "dep-1"…；验收 id 用 "ac-1"…；资源 id 用 "res-1"…；风险 id 用 "rk-1"…；里程碑 id 用 "ms-1"…。跨字段引用一律使用这些 id，且只能引用真实存在的 id。`

/** 任务状态枚举（与 DRAFT_TASK_STATUSES 一致）。 */
export const DRAFT_TASK_STATUS_GUIDE = `【任务 status 仅限】not_started/in_progress/completed/blocked/on_hold/cancelled。`

/**
 * 9 大模块的字段级结构说明（键 = 草案 JSON 字段名）。
 * 每个模块说明在单次路径里作为列表项、在分阶段路径里作为该阶段的输出规范复用。
 */
export const DRAFT_MODULE_STRUCTURE_GUIDES = {
  charter: `charter（章程）：对象，含 7 个字段、均为 Marked 包装——title（value 非空字符串，项目名）、vision（value 非空字符串，项目愿景）、scope（value 非空字符串，项目范围）、objectives（value 字符串数组、至少 1 条）、successCriteria（value 字符串数组、至少 1 条）、startDate（value "YYYY-MM-DD"，高影响）、endDate（value "YYYY-MM-DD"，高影响，不早于 startDate）。`,
  wbs: `wbs（工作分解结构）：节点数组，可通过 children 嵌套成树。每个节点字段：id（字符串）、parentId（根节点为 null，否则为父节点 id）、outlineCode（层级编码如 "1"、"1.1"）、name（Marked，value 非空字符串）、description（Marked，value 字符串）、isLeaf（布尔）、isNote（布尔，说明性分组节点为 true）、children（子节点数组，可为空）。可执行叶节点 = isLeaf:true 且 isNote:false。`,
  tasks: `tasks（任务）：数组，至少 1 条。每个任务字段：id、wbsNodeId（必须引用 wbs 中真实存在的叶节点 id）、name（Marked 非空字符串）、description（Marked 字符串）、status（枚举见任务状态规则）、durationDays（Marked，value 非负数字，高影响，按投入人数折算后的实际工作日）、startDate / endDate（可省略：日期由系统按依赖、工作日历与团队人数统一排定）、assigneeHint（Marked 字符串，高影响）、execution（可执行说明，见任务可执行标准）、assigneeRoleIds（可选，Marked 字符串数组，负责人稳定角色 ID，如 ["app-dev","ops"]；不写时系统按 assigneeHint 分词推导）、estimate（三点估算，普通对象非 Marked：{"optimisticDays": 数字, "pessimisticDays": 数字}，工作日，乐观 ≤ durationDays ≤ 悲观；联调、迁移、测评、切换等不确定性高的任务悲观值应明显放大）、headcount（可选，普通数字：同时投入该任务的人数，缺省 1；多人并行做同一项工作时填写，如 3 人并行开发同一子系统——不要把角色总人数抄进来，只写这一件事真正同时投入几个人）。`,
  dependencies: `dependencies（依赖）：数组，可为空。每条字段：id、predecessorId、successorId（都必须引用 tasks 中真实存在的任务 id，且禁止自环）、type（仅限 FS/SS/FF/SF）、lagDays（Marked，value 数字，高影响）。`,
  acceptanceCriteria: `acceptanceCriteria（验收标准）：数组，至少 1 条。每条字段：id、statement（Marked 非空字符串）、linkedTaskId（tasks 中真实存在的任务 id 或 null）、linkedSuccessIndex（非负整数或 null）。`,
  resourceHints: `resourceHints（资源建议）：数组。每条字段：id、role（Marked 非空字符串）、headcount（Marked，value 正整数）、allocationNote（Marked 字符串）。`,
  riskHints: `riskHints（风险建议）：数组。每条字段：id、description（Marked 非空字符串）、level（Marked，value 仅限 low/medium/high，高影响）、mitigation（Marked 字符串）、trigger（Marked 字符串：可观测的触发条件 / 预警信号）、ownerRole（Marked 字符串：责任角色）、strategy（Marked，value 仅限 avoid/transfer/mitigate/accept，即规避/转移/减轻/接受）。`,
  milestoneHints: `milestoneHints（里程碑）：数组。每条字段：id、name（Marked 非空字符串）、targetDate（Marked "YYYY-MM-DD"，高影响）、linkedTaskIds（tasks 中真实存在的任务 id 数组，可为空）。`,
  ganttPreview: `ganttPreview（甘特预览）：对象，字段：startDate（Marked "YYYY-MM-DD"）、endDate（Marked "YYYY-MM-DD"）、totalDurationDays（Marked，value 非负数字）、criticalPathTaskIds（tasks 中真实存在的任务 id 数组）、phaseCount（非负整数）。`,
} as const

/** 单次生成路径的模块顺序（与 PROJECT_DRAFT_MODULES 的 JSON 字段序一致）。 */
export const DRAFT_MODULE_GUIDE_ORDER = [
  'charter',
  'wbs',
  'tasks',
  'dependencies',
  'acceptanceCriteria',
  'resourceHints',
  'riskHints',
  'milestoneHints',
  'ganttPreview',
] as const

/** charter_scope 阶段的最小示例（首阶段最易错，给一个完整样例锚定结构）。 */
const CHARTER_EXAMPLE = `【输出示例】{"charter":{"title":{"value":"智能审批中台","marker":{"confidence":0.9,"source":"inferred","reason":"来自项目名称。","needsConfirmation":false}},"vision":{"value":"愿景……","marker":{"confidence":0.7,"source":"inferred","reason":"根据输入推断。","needsConfirmation":false}},"scope":{"value":"范围……","marker":{"confidence":0.7,"source":"inferred","reason":"根据输入推断。","needsConfirmation":false}},"objectives":{"value":["目标一"],"marker":{"confidence":0.7,"source":"inferred","reason":"根据输入推断。","needsConfirmation":false}},"successCriteria":{"value":["标准一"],"marker":{"confidence":0.7,"source":"inferred","reason":"根据输入推断。","needsConfirmation":false}},"startDate":{"value":"2026-10-01","marker":{"confidence":0.6,"source":"inferred","reason":"按事实推断。","needsConfirmation":true}},"endDate":{"value":"2026-12-31","marker":{"confidence":0.6,"source":"inferred","reason":"按工期推断。","needsConfirmation":true}}}}`

const WBS_TASKS_EXAMPLE = `【输出示例】{"wbs":[{"id":"wbs-1","parentId":null,"outlineCode":"1","name":{"value":"需求与设计","marker":{"confidence":0.7,"source":"inferred","reason":"按软件项目常规阶段推断。","needsConfirmation":false}},"description":{"value":"","marker":{"confidence":0.7,"source":"inferred","reason":"无补充说明。","needsConfirmation":false}},"isLeaf":true,"isNote":false,"children":[]}],"tasks":[{"id":"task-1","wbsNodeId":"wbs-1","name":"完成报销流程现状调研并输出痛点清单","description":"访谈财务与业务部门代表，梳理现有报销流程与痛点。","status":"not_started","durationDays":3,"assigneeHint":"产品经理","estimate":{"optimisticDays":2,"pessimisticDays":5},"execution":{"purpose":"明确现有流程的卡点，作为新流程设计的依据；不做会导致方案脱离实际。","inputs":["项目章程","财务部现行报销制度文件","访谈对象名单"],"outputs":["《报销流程现状与痛点清单》"],"doneCriteria":["覆盖差旅、采购、日常费用三类报销","痛点清单经财务负责人确认"],"steps":["约定访谈时间与提纲","访谈财务部 2 人、业务部门 3 人","整理流程图与痛点","与财务负责人评审并定稿"],"reviewerRole":"财务负责人"}}]}`

/** 分阶段路径：每个阶段的输出结构说明（模块结构复用 + 阶段硬规则 + 示例）。 */
export const STAGE_OUTPUT_GUIDES: Record<ProjectDraftGenerationStage, string> = {
  charter_scope: `【本阶段输出】只输出 {"charter": ...} 一个 JSON 对象，不要输出其他顶层键。
${DRAFT_MODULE_STRUCTURE_GUIDES.charter}
${CHARTER_EXAMPLE}`,

  wbs_tasks: `【本阶段输出】只输出 {"wbs": [...], "tasks": [...]} 一个 JSON 对象，不要输出其他顶层键。
${DRAFT_MODULE_STRUCTURE_GUIDES.wbs}
${DRAFT_MODULE_STRUCTURE_GUIDES.tasks}
${DRAFT_TASK_STATUS_GUIDE}
${DRAFT_TASK_EXECUTION_GUIDE}
【紧凑任务格式】tasks 中的字段直接写普通值即可（系统自动补 AI 标注），例如 {"id":"task-1","wbsNodeId":"wbs-3","name":"…","description":"…","status":"not_started","durationDays":3,"assigneeHint":"产品经理","estimate":{"optimisticDays":2,"pessimisticDays":5},"execution":{…}}；不要写 startDate/endDate。
【真实专案质量】不得只生成“规划、执行、验收”等通用占位任务。一级 WBS 按 spine.understanding.capabilities（能力地图）与横向工作（项目管理、质量保障、上线切换）划分；覆盖从启动到收尾会真实发生的工作流、外部依赖、采购/供应商、合规/安全、测试/演练、上线或现场执行与复盘。任务与叶节点数量按下方【颗粒度要求】（未给出时至少 8 个可执行叶节点和 8 个任务）。
【硬规则】每个可执行 WBS 叶节点（isLeaf:true 且 isNote:false）必须至少有 1 个任务的 wbsNodeId 指向它。
${WBS_TASKS_EXAMPLE}`,

  schedule_dependencies: `【本阶段输出】只输出 {"dependencies": [...]} 一个 JSON 对象。任务日期、甘特预览与关键路径由系统按依赖、工作日历与团队人数确定性计算，你只负责判断「谁必须在谁之前」。
【紧凑格式】每条依赖写成数组 ["前置任务id","后继任务id","类型",滞后工作日]，如 ["task-3","task-7","FS",0]；类型仅限 FS/SS/FF/SF，绝大多数用 FS，滞后一般为 0。
【硬规则】只能引用 taskIndex 中存在的任务 id；禁止自环与循环。
【依赖要完整】每个任务都要想清楚：它开工前需要哪些产出（见 taskIndex 的产出摘要）？它的产出交给谁？除项目起点任务与贯穿全程的管理类任务外，每个任务都应有前置；除收尾任务外，每个任务都应有后继。跨分支的接口约束（如「接口规范评审」→各服务开发、「各子系统测试完成」→系统集成测试→用户验收→上线演练→生产切换）必须写出。
【依赖只表达真实约束】只写直接前置，不写可传递推出的依赖。不同子系统的设计、开发、联调彼此并行推进，严禁把它们首尾串成一条链。
【工期约束】沿依赖的最长链（关键路径）总工期不得超过 scheduleConstraints.projectWorkdays 个工作日。
【工作包计划】给出 workPackagePlan 时，它是已按人手验证可行的工作包先后：跨工作包的依赖只能沿其 after 关系（系统会删除没有依据的跨包依赖），同一工作包内的任务按执行先后衔接。`,

  resources_risks_acceptance: `【本阶段输出】只输出 {"acceptanceCriteria": [...], "resourceHints": [...], "riskHints": [...], "milestoneHints": [...], "governance": {...}} 一个 JSON 对象，不要输出其他顶层键。
${DRAFT_MODULE_STRUCTURE_GUIDES.acceptanceCriteria}
${DRAFT_MODULE_STRUCTURE_GUIDES.resourceHints}
${DRAFT_MODULE_STRUCTURE_GUIDES.riskHints}
${DRAFT_MODULE_STRUCTURE_GUIDES.milestoneHints}
【真实专案质量】验收标准必须覆盖每一项量化成功指标；风险不得只有“进度延误”等空泛描述，至少覆盖 3 项该领域特有风险并给出可执行缓解措施；里程碑应覆盖关键决策、就绪检查和最终验收。
【规模匹配】前置任务超过 40 个时：风险至少 8 项（覆盖技术、合规、数据迁移、外部依赖、人员、进度），里程碑至少 6 个（每个阶段门各 1 个），验收标准覆盖每个核心子系统/交付物并尽量 linkedTaskId 到对应任务；resourceHints 按已确认的团队角色逐一给出人数与投入说明；每条风险都写 trigger、ownerRole、strategy。
【追溯链】每个交付物（groundingFacts 中 category=deliverable）至少 1 条验收标准，且 linkedTaskId 指向产出该交付物的任务；每个里程碑的 linkedTaskIds 非空，指向该阶段的收尾任务。
【治理文档】governance（普通对象，字段值为普通字符串 / 数组，不用 Marked）：
- raci：数组，每条 {"activity","responsible":[角色],"accountable":角色,"consulted":[角色],"informed":[角色]}，覆盖每个一级阶段与核心交付物，角色用团队名册中的角色名；
- qualityGates：数组，每条 {"name","entryCriteria":[...],"exitCriteria":[...]}，至少包含 SIT、UAT；金融或等保项目还要有「等保测评」「投产评审」；准入、准出各至少 3 条，能量化的写数值（如缺陷密度、严重缺陷数、用例通过率）；
- releaseWindows：数组，每条 {"name","startDate","endDate","scope","rollbackPlan"}，日期 "YYYY-MM-DD"，必须避开 workCalendar.changeFreezeWindows 与法定节假日，写清本窗口投产范围与回滚预案。
【硬规则】linkedTaskId/linkedTaskIds 只能引用 taskIndex 中存在的任务 id 或 null/空数组；acceptanceCriteria 至少 1 条。里程碑 targetDate 可先写章程截止日前的估计值，系统会按关联任务的实际排期校正。`,

  reconcile_review: `【本阶段输出】复核全部前置产物后输出完整 ProjectDraft JSON 对象，顶层键依次为 "schemaVersion"（字符串 "1.0"）、"projectType"（与前置产物原样一致）以及以下 9 个模块字段，不要输出其他顶层键：
${DRAFT_MODULE_GUIDE_ORDER.map((key) => DRAFT_MODULE_STRUCTURE_GUIDES[key]).join('\n')}
${DRAFT_TASK_STATUS_GUIDE}
【复核硬规则】优先原样保留前置阶段产物（含全部 Marked 包装）；仅在跨阶段引用断裂、已确认事实遗漏或确定性校验冲突时做最小修正——任务 wbsNodeId 必须指向存在的 WBS 叶节点、依赖/里程碑/验收的任务引用必须存在、每个可执行 WBS 叶节点至少映射 1 个任务、依赖不得自环、任务日期必须落在工作日且同一明确单人负责人的任务日期不得同日重叠（团队角色可用 assigneeRoleIds 区分并可并行）。修复事实遗漏时，把事实写入最匹配的章程、任务、验收、资源、风险或里程碑字段，不得只写进 marker.reason。禁止丢弃 Marked 结构、禁止把数组字段输出为字符串、禁止自创字段。`,
}
