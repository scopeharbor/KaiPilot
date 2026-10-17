// AI 同事 —— 自然语言操作计划（「把登录页那个任务勾掉，然后把 12 号移到进行中，再打开甘特图」）。
//
// 职责：用模型把一句话理解成**一串**工具调用建议，服务端逐条校验后交回前端，
// 由前端逐条经既有 `/ai/tools/execute` 执行：
// - 只读 / 导航工具直接执行；
// - 写工具（任务状态、排程）一律 PREVIEW_REQUIRED，用户逐条点「确认应用」才落库（RL-01）。
// 本服务**零写入**：只读项目与任务清单，产出建议。
//
// 反幻觉：模型给出的任务编号必须出现在本项目任务清单里，日期必须是合法 YYYY-MM-DD，
// 状态 / 镜头必须在白名单内；不合格的建议整条丢弃并如实告诉用户。
import { TASK_VIEW } from '#rbac'
import ApiException, { ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import Project from '#models/project'
import AiToolsPolicy from '#policies/ai_tools_policy'
import SearchPolicy from '#policies/search_policy'
import MemberDirectoryService, {
  memberAlias,
  pseudonymizeText,
  resolveAliasesToNames,
  type DirectoryMember,
} from '#services/ai_colleague/member_directory_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import type { NativeToolApi } from '#services/ai_m0/gateway'
import type {
  AiToolCallingMode,
  ColleagueAppDestination,
  ColleagueUiPreferenceOptions,
} from '@aiproj/types'
import { SEARCH_ENTITY_TYPES, formatTaskCode, parseEntityCodes } from '@aiproj/types'
import { TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '#services/task_status_machine'
import { inject } from '@adonisjs/core'
import { numberedSteps } from '#services/ai_tools/handlers/mappers'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import SettingsCatalogService from '#services/settings_catalog/settings_catalog_service'
import { DateTime } from 'luxon'

/** 模型可选的项目内镜头（与 navigate_to_space 白名单的子集一致）。 */
export const COLLEAGUE_PLANNER_LENSES = [
  'kanban',
  'gantt',
  'wbs',
  'list',
  'calendar',
  'charts',
  'reports',
  'risks',
  'change_requests',
  'resources',
  'members',
  'files',
] as const

/** 打开项目时可直达的视图（新版项目空间 ?lens=）。 */
export const COLLEAGUE_OPEN_PROJECT_LENSES = [
  'kanban',
  'gantt',
  'wbs',
  'list',
  'calendar',
  'timeline',
] as const

const LENS_LABELS: Record<(typeof COLLEAGUE_PLANNER_LENSES)[number], string> = {
  kanban: '看板',
  gantt: '甘特图',
  wbs: 'WBS',
  list: '任务列表',
  calendar: '日历',
  charts: '图表馆',
  reports: '报表',
  risks: '风险',
  change_requests: '变更请求',
  resources: '资源',
  members: '成员',
  files: '文件',
}

/** 界面偏好缺省可选值（前端未送时使用；与界面外观菜单、文字变体一致）。 */
export const DEFAULT_UI_PREFERENCE_OPTIONS: ColleagueUiPreferenceOptions = {
  themes: [
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
    { value: 'system', label: '跟随系统' },
  ],
  densities: [
    { value: 'comfortable', label: '舒适' },
    { value: 'compact', label: '紧凑' },
  ],
  textVariants: [
    { value: 'cn', label: '简体中文' },
    { value: 'tw', label: '繁體中文（台灣）' },
    { value: 'hk', label: '繁體中文（香港）' },
  ],
}

const SEARCHABLE_ENTITY_TYPES = [...SEARCH_ENTITY_TYPES]

/** 一次最多串几步（防止模型生成过长的链）。 */
export const COLLEAGUE_PLANNER_MAX_ACTIONS = 8
/** 交给模型的任务清单上限。 */
export const COLLEAGUE_PLANNER_MAX_TASKS = 400
/** 我负责的其他项目未完成任务上限。 */
export const COLLEAGUE_PLANNER_MAX_MY_TASKS = 80

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface PlannerTaskRow {
  id: number
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  /** 所属项目（跨项目操作时用任务自己的项目）。 */
  projectId: number
  /** 任务编号 `项目编号#任务号`。 */
  code: string
  /** 负责人用户 ID（给模型时只以〔成员·编码〕代号出现）。 */
  assigneeId?: number | null
  /** 执行步骤（序号从 1 起；「把第 2 步打勾」按这个序号）。 */
  steps?: Array<{ n: number; text: string; done: boolean }>
}

/** 任务不多时给模型每个任务的完整步骤；任务多时只给被点名 / 选中 / 上一张清单里任务的步骤。 */
const PLANNER_FULL_STEPS_TASK_LIMIT = 80

/** 交给模型的设置目录（日历第 4 批：用自然语言改设置）。 */
export interface PlannerSettingRow {
  key: string
  label: string
  layer: 'personal' | 'project' | 'organization'
  current: string
  valueHint: string
  writable: boolean
}

/** 交给模型的项目清单（已授权项目；「打开项目一 / 带我去 PROJ-6」）。 */
export interface PlannerProjectRow {
  id: number
  code: string | null
  name: string
  status: string
}

/** 没有可用模型时的说明（所选连接不可用，组织与环境也没有其他可用模型）。 */
export const COLLEAGUE_NO_MODEL_MESSAGE =
  '没有可用的 AI 模型：所选模型连接不可用（可能已停用、缺少密钥或模型已删除），组织里也没有其他可用模型。请在「AI 连接」检查，或在对话框里换一个模型'

/** 交给模型的项目清单上限。 */
export const COLLEAGUE_PLANNER_MAX_PROJECTS = 60
/** 一键生成项目：需求描述长度上限（与生成剧场输入上限同量级，超出截断）。 */
export const COLLEAGUE_PROJECT_IDEA_MAX = 2000

export interface PlannedColleagueAction {
  toolName:
    | 'update_task_status'
    | 'update_task_schedule'
    | 'navigate_to_space'
    | 'list_project_tasks'
    | 'get_task_detail'
    // 以下在浏览器本地执行（导航 / 搜索 / 界面偏好都没有服务端副作用）
    | 'open_app_page'
    | 'search_global_entities'
    | 'set_ui_preference'
    | 'get_my_work'
    | 'update_task_assignee'
    // 删除任务（移入回收站，30 天内可恢复；写操作，先预览再确认）
    | 'delete_task'
    // 新建任务、勾选 / 取消执行步骤（写操作，先预览再确认）
    | 'create_task'
    | 'toggle_task_steps'
    // 一键生成新项目：在生成剧场填好需求并自动开始（草案仍须人工审查才转正，红线 2）
    | 'start_project_generation'
    // 退出登录（浏览器本地执行：吊销会话、清本地登录态）
    | 'sign_out'
    // 只读：项目概况 / 风险清单（多步任务里「先看一看」）
    | 'get_project_summary'
    | 'list_project_risks'
    // 看一眼当前页面（浏览器截图 → 能看图的模型描述成文字，作为下一轮的观察结果）
    | 'capture_page'
    // 用自然语言改设置（个人 / 项目 / 组织；写操作，先预览再确认，日历第 4 批）
    | 'update_setting'
  parameters: Record<string, unknown>
  /** 给用户看的一句话说明（程序生成，不用模型原话）。 */
  summary: string
  /** 执行后的后续：prioritize = 把结果交给模型排优先级、给建议（「我的工作」）。 */
  followUp?: 'prioritize'
}

export interface ColleagueActionPlan {
  /** 模型判断这句话是否是「要系统去做事」；false 时前端改走普通问答。 */
  isAction: boolean
  actions: PlannedColleagueAction[]
  /**
   * 多步任务：本轮动作执行完后要不要把结果交回来再想下一步（像 Claude Code 一样读 → 想 → 做）。
   * 前端执行完本轮动作后带上观察结果再请求一轮，直到 false 或达到轮数上限。
   */
  continue: boolean
  /** 多步任务的最终答复（Markdown；看过结果之后给用户的结论）。 */
  answer: string | null
  /** 模型给用户的简短说明（可空）。 */
  reply: string | null
  /** 缺信息时要问用户的话（如「有两个『登录』任务，指哪一个？」）。 */
  clarification: string | null
  /** 追问的候选答案（2–4 个，界面渲染成选项卡片，最后一项固定是「自己输入」）。 */
  clarificationOptions: string[]
  /** 被丢弃的建议说明（如任务编号不在本项目）。 */
  rejected: string[]
  model: string | null
  /** 本次实际使用的工具调用方式。 */
  toolCallingMode: AiToolCallingMode
  /** 连接配置的方式（与实际不同说明发生了回退）。 */
  requestedToolCallingMode: AiToolCallingMode
  /** 原生方式失败、回退到 Prompt + JSON 的原因（未回退为 null）。 */
  fallbackReason: string | null
}

export interface PlanActionsInput {
  user: User
  organizationId: number
  /** 当前项目（不在项目空间时为 null：只提供打开页面 / 搜索 / 界面偏好）。 */
  projectId: number | null
  text: string
  /** 前端从界面目录实时生成的应用地图（已按权限过滤）。 */
  appDestinations?: readonly ColleagueAppDestination[]
  /** 界面偏好可选值（来自界面自己的选项常量）。 */
  uiPreferences?: ColleagueUiPreferenceOptions | null
  modelPreference?: { connectionId?: number | null; modelId?: number | null } | null
  /** 用户所在页面的选中任务（如任务详情抽屉），可让「这个任务」有指代对象。 */
  selectedTaskId?: number | null
  /** 上一张任务清单（如「我的工作」）的显示顺序：让「第 2 个」有指代对象。 */
  recentTaskIds?: readonly number[]
  /** 最近几轮对话（前端本地对话，理解「直接带我过去」这类指代）。 */
  conversation?: readonly { role: 'user' | 'assistant'; text: string }[]
  /** 多步任务：前几轮动作的执行结果（前端整理、已截断），第几轮。 */
  observations?: readonly ColleagueObservation[]
  iteration?: number
  /** 当前页面：可见文字摘要（标题、按钮、表格行…），以及看图模型对截图的描述（有则带）。 */
  page?: ColleaguePageContext | null
}

/** 一步动作的执行结果（交回模型的「观察」）。 */
export interface ColleagueObservation {
  step: string
  tool: string
  /** success / committed / cancelled / error / awaiting_confirmation。 */
  status: string
  /** 结果的紧凑 JSON 或说明（已截断）。 */
  result: string
}

export interface ColleaguePageContext {
  route?: string | null
  title?: string | null
  /** 页面可见文字（前端提取，已截断）。 */
  visibleText?: string | null
  /** 截图的看图描述（capture_page 之后才有）。 */
  visualDescription?: string | null
}

/** 多步任务的最大轮数（含第一轮）。 */
export const COLLEAGUE_AGENT_MAX_ITERATIONS = 30
const OBSERVATION_RESULT_MAX = 4000
/** 交回模型的观察条数上限；最近若干条给完整结果，更早的只留摘要长度。 */
const OBSERVATION_KEEP = 80
const OBSERVATION_FULL_RECENT = 20
const OBSERVATION_RESULT_OLDER_MAX = 600
const PAGE_TEXT_MAX = 4000

/** 对话上下文条数与单条长度上限。 */
export const COLLEAGUE_PLANNER_MAX_CONVERSATION = 6
const CONVERSATION_TEXT_MAX = 300

function dateOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return null
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  return DateTime.fromISO(value).isValid
}

function toPositiveInt(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(num) && num > 0 ? num : null
}

/** 系统提示：工具说明 + 输出格式（只输出 JSON）。 */
export function buildPlannerSystemPrompt(): string {
  return [
    '你是项目管理平台「开项」里 AI 同事的操作理解器。把用户的一句话理解成要系统执行的操作序列，只输出一个 JSON 对象，不要输出任何其他文字。',
    '可用操作（action 字段）：',
    '1. {"action":"set_status","taskId":数字,"status":"not_started|in_progress|completed|blocked|on_hold|cancelled"} —— 改任务状态。「完成/做完/勾掉/打勾」=completed；「开始做/移到进行中」=in_progress；「卡住/受阻」=blocked；「暂停」=on_hold；「取消」=cancelled；「退回/重置/还没开始」=not_started；「重新打开」=in_progress。',
    '2. {"action":"reschedule","taskId":数字,"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"} —— 改任务日期。整体平移（延期/提前 N 天、改到某天开始）给新的 startDate 与同样工期的 endDate；只改截止日时 startDate 保持原值、endDate 给新值。按任务清单里的原日期计算，「N 天」按自然日。',
    '3. {"action":"navigate","lens":"kanban|gantt|wbs|list|calendar|charts|reports|risks|change_requests|resources|members|files"} —— 打开项目内页面。',
    '4. {"action":"list_tasks","status":"可选，同上状态","search":"可选关键词"} —— 查看任务列表。',
    '5. {"action":"task_detail","taskId":数字} —— 查看任务详情。',
    '6. {"action":"open_destination","destinationId":"应用地图里的 id","projectId":可选数字} —— 打开任意页面（设置、AI 连接、通知、组织、PMO、帮助、图表馆里的具体图表如 AON 网络图等）。appMap 是当前版本界面的实时目录，只能用其中的 id。',
    '7. {"action":"search","keyword":"关键词","entityType":"可选：project|task|file|risk|change_request|report|comment|activity|milestone|document","open":true|false} —— 像空间地图一样全域搜索（任务、风险、文件、变更…）；用户说「带我去/打开」某个具体东西时 open=true。',
    '8. {"action":"set_preference","theme":"可选","density":"可选","textVariant":"可选"} —— 切换界面偏好，取值见 uiPreferences（如 浅色/深色/跟随系统、舒适/紧凑、简体/繁體）。',
    '9. {"action":"my_work","filter":"open|today|overdue|this_week","prioritize":true|false} —— 跨项目列出「我负责、还没完成」的工作（「我今天还有什么没做完」filter=today；问「先做哪个 / 怎么排」时 prioritize=true）。',
    '10. {"action":"open_task","taskId":数字} —— 打开某个任务的详情页（「带我去第一个」「打开 PROJ-5#128」「我想先做这个」）。只是在对话里看详情用 task_detail。',
    '11. {"action":"assign","taskId":数字,"member":"〔成员·XXXXXXXX〕"} —— 把任务指派给某位成员（member 原样填整个代号；「指派给我」用 me 的代号）；取消指派用 {"action":"assign","taskId":数字,"unassign":true}。成员只以〔成员·编码〕代号出现；只能指派给 members 里在该任务所属项目（projectIds）的成员。',
    '12. {"action":"open_project","projectId":数字,"lens":"可选：kanban|gantt|wbs|list|calendar|timeline"} —— 打开某个项目（「打开 PROJ-6」「带我去食堂订餐那个项目」「进入演唱会项目的甘特图」）。projectId 必须来自 projects。',
    '13. {"action":"create_project","idea":"完整的项目需求描述"} —— 一键生成新项目：用户说「帮我办一场校园演唱会」「我想做一个 xx 项目 / 帮我建个项目 / 生成项目计划」时使用。idea 用简体中文把用户提到的目标、规模、时间、预算、人员等细节完整写成一两句话（至少 15 个字，不要编造用户没说的细节）。系统会先问用户要全自动（包括转为正式项目）还是自己回答追问，再打开生成剧场生成；草案经规则与反幻觉校验，有阻断项时交给用户审查。',
    '14. {"action":"sign_out"} —— 退出登录。只在用户明确要求「退出登录 / 登出 / 注销账号」时使用；只是问登出在哪里时用 open_destination 打开对应页面。',
    '15. {"action":"delete_task","taskId":数字} —— 删除任务（移入回收站，30 天内可恢复）。「删除 #551」「把那个测试任务删掉」。taskId 必须来自任务清单；只是建议，系统会先给用户看删除预览，确认后才删除。',
    'tasks 里包含当前项目的任务、我负责的其他项目未完成任务、以及用户提到编号的任务（每条带 code=「项目编号#任务号」与 projectId）；set_status / reschedule / task_detail 可以作用于其中任何一条。',
    '「第 N 个 / 第一条」指 recentTasks 里的第 N 条（上一张清单的显示顺序）。',
    '没有 project 时，navigate 与 list_tasks 不可用（它们只作用于当前项目）。',
    '19. {"action":"create_task","projectId":可选数字,"name":"任务名","description":"可选说明","startDate":"可选 YYYY-MM-DD","endDate":"可选 YYYY-MM-DD","priority":"可选 low|medium|high|urgent","member":"可选〔成员·XXXXXXXX〕负责人","parentTaskId":可选数字,"steps":["可选执行步骤",...]} —— 新建任务（不给 projectId 用当前项目；parentTaskId 来自任务清单，表示建成它的子任务）。只是建议，系统会先给用户看新建预览，确认后才新建。',
    '20. {"action":"toggle_steps","taskId":数字,"steps":[步骤序号,...],"all":可选 true,"done":true|false} —— 把任务里的执行步骤打勾（done=true）或取消打勾（done=false）；步骤序号来自任务清单里该任务的 steps（n 从 1 起），全部步骤用 all=true。勾选会按比例更新进度，全部勾上自动转已完成、取消已完成任务的步骤会退回进行中。任务清单里只有 stepCount 没有步骤内容时，先用 task_detail 看步骤再勾。',
    '21. {"action":"change_setting","key":"settings 里的 key","value":新值,"projectId":可选数字} —— 改一项设置（个人 / 项目 / 组织），如「我的日历改成农历为主」「项目日历加上节气」「下周三到周五我请假」「项目结束日改到 12 月 20 日」「我只在周一到周三上班」。key 只能来自 settings（writable=false 的不能改，告诉用户需要什么权限）；value 按该项 valueHint 给出完整新值（曆法要给完整的有序列表，包含原有并按用户意思调整）。系统会先给用户看前后差异，确认后才生效。界面主题 / 密度 / 简繁仍用 set_preference；密码、两步验证、AI 连接与密钥、KMS、SSO、集成凭据等敏感设置不能代改，用 open_destination 带用户到对应页面；settings 里没有的设置也用 open_destination 打开对应设置页。',
    '16. {"action":"project_summary","projectId":可选数字} —— 查看项目概况（进度、任务状态分布、起止日期）。不给 projectId 时用当前项目。',
    '17. {"action":"list_risks","projectId":可选数字} —— 查看项目风险清单。',
    '18. {"action":"look_at_page"} —— 看一眼用户当前页面（截图交给能看图的模型描述）。用户说「这是什么 / 帮我看看这个页面 / 这里怎么操作」而 page.visibleText 不够判断时使用，结果会在下一轮的 observations 里。',
    '输出格式：{"isAction":true|false,"actions":[...按用户说的先后顺序...],"continue":true|false,"reply":"一句简体中文说明你准备做什么","answer":null 或 "看过结果后的最终答复（Markdown）","clarification":null 或 "需要用户补充的问题","options":[]}',
    '多步任务（像 Claude Code 一样读 → 想 → 做）：复杂的事可以分几轮完成。需要先看数据再决定时，本轮只放查看类动作（list_tasks / task_detail / my_work / search / project_summary / list_risks / look_at_page）并设 continue=true；系统执行后会把结果放进下一轮的 observations（带 iteration）再问你。看够了就给出要做的修改动作，或在 answer 里给出结论并设 continue=false。修改类动作同样可以分几轮提出，每个修改都会先让用户确认，observations 会告诉你用户确认了还是放弃了。最多 30 轮，复杂的事可以拆成很多轮逐步完成。',
    'observations 是上一轮动作的真实执行结果，以它为准，不要重复已经做过的动作；全部完成后 actions=[]、continue=false、answer 写结论（做了什么、结果如何、还有什么建议）。',
    'page 是用户当前页面：visibleText 是页面上看得到的文字，visualDescription 是截图描述（有则带）。回答「这是什么 / 我在哪里 / 这里怎么做」时以它为准。',
    '规则：',
    '- 只要能用上面的动作帮用户做事或拿到需要的数据，就输出动作（isAction=true）：改状态、改日期、改负责人、删除、打开页面 / 项目、搜索前往、切换界面、列出/查看任务或风险、看项目概况、看当前页面、生成新项目。需要数据才能回答的分析类问题（「我这周有什么风险」「哪些任务逾期」）也先用查看类动作拿数据（continue=true），再在下一轮 answer 里回答。只有纯知识问答、闲聊时 isAction=false、actions=[]。',
    '- 绝不要说「我没有写入权限 / 只能只读 / 请你自己去页面操作」：修改都由上面的动作完成，系统会先让用户确认。',
    '- 改日期（reschedule）与改状态（set_status）时，系统会按依赖关系自动顺延或往前拉后续任务（与界面拖动同一套排期逻辑），不要再逐个去改后续任务；observations 会说明联动调整了哪些。',
    '- 用户可能用繁体中文、口语、语音转写（有错别字/同音字）表达，按意思理解：「帶我去 / 帶我過去 / 我要去 / 我想去 / 打開 / 進入」都是要打开页面；「我要配置 AI 模型」「我想改密码」这类「我要做某事」等于要打开做这件事的页面——直接 open_destination，不要只回答在哪里。',
    '- 用户说「直接帶我過去」「就去那里」等指代时，结合 conversation（最近几轮对话）判断要去的页面。',
    '- 用户问「X 在哪里」且 appMap 里有唯一明确的页面时，也直接 open_destination 打开它（reply 里说一句它所在的分组）。',
    '- 需要项目的页面（appMap 中 path 含 :id，如图表馆里的各个图表、风险管理）在没有 project 时：用户点名了项目就给 open_destination 加 projectId（来自 projects）；否则用 ask_clarification 让用户从 projects 里选项目（options 放 2–4 个项目名）。',
    '- 「项目一 / 第一个项目」这类说法含义不明确（可能是编号 PROJ-1，也可能是列表第一个）时，用 clarification 追问并把候选项目放进 options。',
    '- 项目内视图（看板/甘特图/WBS 等）用 navigate；其余页面用 open_destination；找具体的任务/风险/文件等用 search。',
    '- taskId 必须来自给定的任务清单：用户可能说任务编号（PROJ-5#12、#12）或任务名的一部分，按名称匹配；「这个任务 / 当前任务」指 selectedTaskId。',
    '- 名称匹配到多个任务或完全找不到、日期说不清时，不要猜：对应动作不要输出，并在 clarification 里简短问用户；有明确候选时把候选放进 options（2–4 个简短完整的答案，如「PROJ-5#12 登录页开发」「明天」），界面会显示成可点选的卡片，用户也能自己输入。',
    '- 一句话里有多个操作时全部按顺序列出（最多 8 个）。',
    '- 你只是提出建议，真正修改前系统会让用户逐条确认；不要在 reply 里说「已完成」。',
  ].join('\n')
}

export function buildPlannerUserPrompt(input: {
  text: string
  today: string
  project: { id: number; name: string } | null
  tasks: readonly PlannerTaskRow[]
  selectedTaskId: number | null
  appDestinations?: readonly ColleagueAppDestination[]
  uiPreferences?: ColleagueUiPreferenceOptions
  recentTaskIds?: readonly number[]
  /** 调用者自己的代号（「指派给我」）。 */
  meAlias?: string
  /** 相关成员（只给代号与所在项目，不给姓名）。 */
  members?: readonly { alias: string; projectIds: readonly number[] }[]
  /** 用户 ID → 代号（任务负责人）。 */
  aliasOf?: (userId: number) => string
  /** 已授权项目清单。 */
  projects?: readonly PlannerProjectRow[]
  /** 最近几轮对话（理解「直接带我过去」之类的指代；不是指令）。 */
  conversation?: readonly { role: 'user' | 'assistant'; text: string }[]
  /** 多步任务：前几轮的执行结果与当前轮次。 */
  observations?: readonly ColleagueObservation[]
  iteration?: number
  /** 当前页面（可见文字 / 截图描述）。 */
  page?: ColleaguePageContext | null
  /** 需要给出完整步骤内容的任务（用户点名编号的任务）。 */
  detailTaskIds?: readonly number[]
  /** 可用自然语言修改的设置（含当前值与能否修改）。 */
  settings?: readonly PlannerSettingRow[]
}): string {
  const byId = new Map(input.tasks.map((task) => [task.id, task]))
  // 步骤内容：任务不多时全部给；多时只给被点名 / 选中 / 上一张清单里的任务（其余给 stepCount）
  const detailIds = new Set<number>([
    ...(input.selectedTaskId ? [input.selectedTaskId] : []),
    ...(input.recentTaskIds ?? []),
    ...(input.detailTaskIds ?? []),
  ])
  const fullSteps = input.tasks.length <= PLANNER_FULL_STEPS_TASK_LIMIT
  return JSON.stringify({
    request: input.text,
    today: input.today,
    ...(input.meAlias ? { me: input.meAlias } : {}),
    ...(input.members && input.members.length > 0
      ? {
          members: input.members.map((member) => ({
            alias: member.alias,
            projectIds: member.projectIds,
          })),
        }
      : {}),
    project: input.project,
    ...(input.projects && input.projects.length > 0
      ? {
          projects: input.projects.map((project) => ({
            id: project.id,
            code: project.code,
            name: project.name,
            status: project.status,
          })),
        }
      : {}),
    ...(input.conversation && input.conversation.length > 0
      ? { conversation: input.conversation }
      : {}),
    ...(input.page ? { page: input.page } : {}),
    ...(input.observations && input.observations.length > 0
      ? {
          iteration: input.iteration ?? 1,
          maxIterations: COLLEAGUE_AGENT_MAX_ITERATIONS,
          observations: input.observations,
        }
      : {}),
    selectedTaskId: input.selectedTaskId,
    recentTasks: (input.recentTaskIds ?? [])
      .map((id, index) => {
        const task = byId.get(id)
        return task ? { n: index + 1, id: task.id, code: task.code, name: task.name } : null
      })
      .filter((task) => task !== null),
    appMap: (input.appDestinations ?? []).map((destination) => ({
      id: destination.id,
      title: destination.title,
      group: destination.group,
      ...(destination.description ? { description: destination.description } : {}),
    })),
    uiPreferences: input.uiPreferences ?? DEFAULT_UI_PREFERENCE_OPTIONS,
    ...(input.settings && input.settings.length > 0 ? { settings: input.settings } : {}),
    tasks: input.tasks.map((task) => ({
      id: task.id,
      code: task.code,
      projectId: task.projectId,
      name: task.name,
      status: task.status,
      start: task.startDate,
      end: task.endDate,
      ...(task.assigneeId && input.aliasOf ? { assignee: input.aliasOf(task.assigneeId) } : {}),
      ...(task.steps && task.steps.length > 0
        ? fullSteps || detailIds.has(task.id)
          ? { steps: task.steps }
          : { stepCount: task.steps.length }
        : {}),
    })),
  })
}

// ---------------------------------------------------------------------------
// 统一工具定义（Tool Registry）：Prompt + JSON 与三种原生工具调用共用同一组操作语义。
// 原生方式把它们转换成各家 tools 格式；模型的调用再映射回同一套「动作」交给
// normalizePlannedActions 校验，保证四种方式的反幻觉规则完全一致。
// ---------------------------------------------------------------------------

const STATUS_ENUM = [...TASK_STATUSES]

export interface PlannerToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** 模型调用参数 → 统一动作（normalizePlannedActions 的输入）。 */
  toAction: (args: Record<string, unknown>) => Record<string, unknown>
}

export const PLANNER_CLARIFY_TOOL_NAME = 'ask_clarification'

export const COLLEAGUE_PLANNER_TOOLS: readonly PlannerToolDefinition[] = [
  {
    name: 'set_task_status',
    description:
      '修改一个任务的状态。「完成/做完/勾掉/打勾」=completed；「开始做/移到进行中/重新打开」=in_progress；「卡住/受阻」=blocked；「暂停」=on_hold；「取消」=cancelled；「退回/还没开始」=not_started。taskId 必须取自给定任务清单。只是建议，系统会让用户确认后才生效。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: '任务编号（来自任务清单的 id）' },
        status: { type: 'string', enum: STATUS_ENUM, description: '目标状态' },
      },
      required: ['taskId', 'status'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'set_status', taskId: args.taskId, status: args.status }),
  },
  {
    name: 'reschedule_task',
    description:
      '修改一个任务的起止日期。整体平移（延期/提前 N 天、改到某天开始）时给新 startDate 与保持原工期的 endDate；只改截止日时只给 endDate。按任务清单里的原日期与 today 计算，N 天按自然日。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: '任务编号（来自任务清单的 id）' },
        startDate: { type: 'string', description: '新的开始日期 YYYY-MM-DD（只改截止日时可省略）' },
        endDate: { type: 'string', description: '新的结束日期 YYYY-MM-DD' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'reschedule',
      taskId: args.taskId,
      startDate: args.startDate,
      endDate: args.endDate,
    }),
  },
  {
    name: 'open_page',
    description:
      '打开当前项目内的某个页面（看板、甘特图、WBS、任务列表、日历、图表、报表、风险、变更、资源、成员、文件）。',
    parameters: {
      type: 'object',
      properties: {
        lens: { type: 'string', enum: [...COLLEAGUE_PLANNER_LENSES], description: '页面' },
      },
      required: ['lens'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'navigate', lens: args.lens }),
  },
  {
    name: 'list_tasks',
    description: '列出当前项目的任务，可按状态或关键词过滤。',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUS_ENUM, description: '可选：只看某个状态' },
        search: { type: 'string', description: '可选：任务名关键词' },
      },
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'list_tasks', status: args.status, search: args.search }),
  },
  {
    name: 'show_task_detail',
    description: '查看一个任务的详情。',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'integer', description: '任务编号（来自任务清单的 id）' } },
      required: ['taskId'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'task_detail', taskId: args.taskId }),
  },
  {
    name: 'open_destination',
    description:
      '打开应用里的任意页面（设置、AI 连接、通知、组织、PMO、帮助、知识库等）。destinationId 必须取自用户消息 appMap 里的 id（这是当前版本界面的实时目录）。项目内的看板/甘特图等视图用 open_page。',
    parameters: {
      type: 'object',
      properties: {
        destinationId: { type: 'string', description: 'appMap 里的页面 id' },
        projectId: {
          type: 'integer',
          description: '可选：页面需要项目（path 含 :id）而用户点名了项目时，填 projects 里的 id',
        },
      },
      required: ['destinationId'],
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'open_destination',
      destinationId: args.destinationId,
      projectId: args.projectId,
    }),
  },
  {
    name: 'open_project',
    description:
      '打开某个项目（「打开 PROJ-6」「带我去食堂订餐那个项目」「进入演唱会项目的甘特图」）。projectId 必须来自用户消息里的 projects；可选 lens 直达该项目的某个视图。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: '项目 id（来自 projects）' },
        lens: {
          type: 'string',
          enum: [...COLLEAGUE_OPEN_PROJECT_LENSES],
          description: '可选：直达的视图',
        },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'open_project', projectId: args.projectId, lens: args.lens }),
  },
  {
    name: 'create_project',
    description:
      '一键生成新项目：用户说「帮我办一场校园演唱会」「我想做一个 xx 项目」「帮我建个项目 / 生成项目计划」时使用。系统会打开生成剧场、填好需求并自动开始生成；草案仍由用户审查确认后才转为正式项目。',
    parameters: {
      type: 'object',
      properties: {
        idea: {
          type: 'string',
          description:
            '用简体中文把用户提到的目标、规模、时间、预算、人员等细节完整写成一两句话（至少 15 个字，不要编造用户没说的细节）',
        },
      },
      required: ['idea'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'create_project', idea: args.idea }),
  },
  {
    name: 'delete_task',
    description:
      '删除一个任务（移入回收站，30 天内可恢复）。「删除 #551」「把那个测试任务删掉」。taskId 必须来自任务清单。只是建议，系统会先给用户看删除预览，确认后才删除。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: '任务编号里的任务号（来自任务清单的 id）' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'delete_task', taskId: args.taskId }),
  },
  {
    name: 'create_task',
    description:
      '新建任务（不给 projectId 用当前项目）。parentTaskId 来自任务清单（建成它的子任务）；member 填负责人的〔成员·编码〕代号；steps 为执行步骤（界面可打勾）。只是建议，系统会先给用户看新建预览，确认后才新建。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: '可选：项目 id（来自 projects）' },
        name: { type: 'string', description: '任务名' },
        description: { type: 'string', description: '可选：说明' },
        startDate: { type: 'string', description: '可选：开始日期 YYYY-MM-DD' },
        endDate: { type: 'string', description: '可选：结束日期 YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        member: { type: 'string', description: '可选：负责人代号〔成员·XXXXXXXX〕' },
        parentTaskId: { type: 'integer', description: '可选：父任务 id（来自任务清单）' },
        steps: { type: 'array', items: { type: 'string' }, description: '可选：执行步骤' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'create_task', ...args }),
  },
  {
    name: 'toggle_task_steps',
    description:
      '把任务的执行步骤打勾（done=true）或取消打勾（done=false）。steps 为步骤序号（来自任务清单里该任务的 steps，n 从 1 起），全部步骤用 all=true。进度按比例更新，全部勾上自动转已完成。任务清单里只有 stepCount 时先用 show_task_detail 看步骤。只是建议，系统会先让用户确认。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: '任务 id（来自任务清单）' },
        steps: { type: 'array', items: { type: 'integer' }, description: '步骤序号（从 1 起）' },
        all: { type: 'boolean', description: '作用于全部步骤' },
        done: { type: 'boolean', description: 'true 打勾 / false 取消打勾' },
      },
      required: ['taskId', 'done'],
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'toggle_steps',
      taskId: args.taskId,
      steps: args.steps,
      all: args.all,
      done: args.done,
    }),
  },
  {
    name: 'project_summary',
    description: '查看项目概况（进度、任务状态分布、起止日期）。不给 projectId 时用当前项目。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: '可选：项目 id（来自 projects）' },
      },
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'project_summary', projectId: args.projectId }),
  },
  {
    name: 'list_risks',
    description: '查看项目风险清单。不给 projectId 时用当前项目。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', description: '可选：项目 id（来自 projects）' },
      },
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'list_risks', projectId: args.projectId }),
  },
  {
    name: 'look_at_page',
    description:
      '看一眼用户当前页面（截图交给能看图的模型描述），结果在下一轮 observations 里。用户问「这是什么 / 帮我看看这个页面 / 这里怎么操作」而 page.visibleText 不够判断时使用。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    toAction: () => ({ action: 'look_at_page' }),
  },
  {
    name: 'sign_out',
    description:
      '退出登录。只在用户明确要求「退出登录 / 登出 / 注销账号」时使用；只是问登出在哪里时用 open_destination 打开对应页面。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    toAction: () => ({ action: 'sign_out' }),
  },
  {
    name: 'search_entities',
    description:
      '像空间地图一样全域搜索项目、任务、风险、文件、变更请求、报告、里程碑等。用户说「带我去 / 打开」某个具体东西时 open=true（只有一个结果时直接打开）。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        entityType: {
          type: 'string',
          enum: SEARCHABLE_ENTITY_TYPES,
          description: '可选：只搜某一类',
        },
        open: { type: 'boolean', description: '是否在唯一命中时直接打开' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'search',
      keyword: args.keyword,
      entityType: args.entityType,
      open: args.open,
    }),
  },
  {
    name: 'set_ui_preference',
    description:
      '切换界面偏好：主题（浅色 light / 深色 dark / 跟随系统 system）、密度（舒适 comfortable / 紧凑 compact）、文字（简体 cn / 繁體台灣 tw / 繁體香港 hk）。只给需要改的项。',
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string', description: '主题取值，见 uiPreferences.themes' },
        density: { type: 'string', description: '密度取值，见 uiPreferences.densities' },
        textVariant: { type: 'string', description: '文字取值，见 uiPreferences.textVariants' },
      },
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'set_preference',
      theme: args.theme,
      density: args.density,
      textVariant: args.textVariant,
    }),
  },
  {
    name: 'assign_task',
    description:
      '修改任务负责人：指派给某位成员（member 原样填整个〔成员·编码〕代号；「指派给我」用 me 的代号），或 unassign=true 取消指派。成员只以代号出现；只能指派给 members 里在该任务所属项目的成员。只是建议，系统会让用户确认后才生效。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: '任务编号里的任务号（来自任务清单的 id）' },
        member: { type: 'string', description: '成员代号，如〔成员·7KQ2M9XD〕' },
        unassign: { type: 'boolean', description: '取消指派' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'assign',
      taskId: args.taskId,
      member: args.member,
      unassign: args.unassign,
    }),
  },
  {
    name: 'open_task',
    description:
      '打开某个任务的详情页（跳转到所在项目并展开任务详情）。用户说「带我去第一个」「打开 PROJ-5#128」「我想先做这个」时使用；只想在对话里看详情用 show_task_detail。taskId 必须来自任务清单。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'integer', description: '任务编号里的任务号（来自任务清单的 id）' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'open_task', taskId: args.taskId }),
  },
  {
    name: 'list_my_work',
    description:
      '跨项目列出当前用户负责、还没完成的工作（按紧急程度排好序）。「我今天还有什么没做完」filter=today；已逾期 overdue；本周 this_week；全部 open。用户问「先做哪个 / 怎么排 / 怎么安排」时 prioritize=true，系统会在清单基础上给出优先级建议。',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['open', 'today', 'overdue', 'this_week'] },
        prioritize: { type: 'boolean', description: '是否需要优先级建议' },
      },
      additionalProperties: false,
    },
    toAction: (args) => ({ action: 'my_work', filter: args.filter, prioritize: args.prioritize }),
  },
  {
    name: 'change_setting',
    description:
      '改一项设置（个人 / 项目 / 组织），key 只能来自 settings 且 writable=true；value 按该项 valueHint 给完整新值。界面主题 / 密度 / 简繁用 set_ui_preference；敏感设置（密码、两步验证、AI 密钥、KMS、SSO、集成凭据）与 settings 里没有的设置用 open_destination 打开对应页面。系统会先给用户看前后差异，确认后才生效。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'settings 里的 key' },
        value: { description: '新值（格式见该项 valueHint）' },
        projectId: { type: 'integer', description: '项目设置所属项目（不给用当前项目）' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    toAction: (args) => ({
      action: 'change_setting',
      key: args.key,
      value: args.value,
      projectId: args.projectId,
    }),
  },
  {
    name: PLANNER_CLARIFY_TOOL_NAME,
    description:
      '指代不明（名称匹配到多个任务或找不到）、日期说不清时，不要猜，调用本工具向用户追问。有明确候选时放进 options（界面显示成可点选卡片，用户也能自己输入）。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '给用户的简短追问' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            '2–4 个简短完整的候选答案（如「PROJ-5#12 登录页开发」「明天」）；没有明确候选时省略',
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
    toAction: () => ({}),
  },
]

/** 不在项目空间时仍可用的工具。 */
export const GLOBAL_PLANNER_TOOL_NAMES: ReadonlySet<string> = new Set([
  // 任务类工具作用于任务自己的项目（我负责的 / 提到编号的），不需要先进项目
  'set_task_status',
  'reschedule_task',
  'show_task_detail',
  'assign_task',
  'open_task',
  'list_my_work',
  'open_destination',
  'open_project',
  'create_project',
  'delete_task',
  'create_task',
  'toggle_task_steps',
  'project_summary',
  'list_risks',
  'look_at_page',
  'sign_out',
  'search_entities',
  'set_ui_preference',
  'change_setting',
  PLANNER_CLARIFY_TOOL_NAME,
])

/** 查看类工具（原生方式下调用它们即表示「先看结果再继续」）。 */
const READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  'list_tasks',
  'show_task_detail',
  'list_my_work',
  'search_entities',
  'project_summary',
  'list_risks',
  'look_at_page',
])

/** 原生工具调用方式 → 适配器 API。 */
export const NATIVE_TOOL_API_BY_MODE: Readonly<Partial<Record<AiToolCallingMode, NativeToolApi>>> =
  {
    openai_chat_tools: 'openai_chat',
    openai_responses_tools: 'openai_responses',
    anthropic_tool_use: 'anthropic_messages',
  }

/** 原生方式的系统提示（工具定义由 API 的 tools 参数携带，这里只讲规则）。 */
export function buildNativePlannerSystemPrompt(): string {
  return [
    '你是项目管理平台「开项」里 AI 同事的操作理解器。用户会用一句话让系统做事，你用提供的工具表达要执行的操作。',
    '- 一句话里有多个操作时，按用户说的先后顺序调用多个工具（最多 8 个）。',
    '- taskId 必须来自用户消息里的任务清单：用户可能说编号（#12、12 号）或任务名的一部分，按名称匹配；「这个任务 / 当前任务」指 selectedTaskId。',
    '- 名称匹配到多个任务、找不到、或日期说不清时不要猜，调用 ask_clarification 追问。',
    '- 项目内视图（看板/甘特图/WBS 等）用 open_page；其余页面（设置、AI 连接、通知…）用 open_destination；找具体的任务/风险/文件等用 search_entities；切换浅色/深色、密度、简繁体用 set_ui_preference。',
    '- 用户消息里的 tasks 包含当前项目任务、我负责的其他项目未完成任务、以及提到编号的任务（code=「项目编号#任务号」）；「第 N 个」指 recentTasks 的第 N 条。',
    '- 问「我今天/这周还有什么工作」用 list_my_work；问先做哪个、怎么安排时 prioritize=true。',
    '- 没有 project 时（用户不在项目空间）open_page 不可用；打开别的项目用 open_project（projectId 来自 projects）。',
    '- 用户可能用繁体中文、口语、语音转写（有错别字/同音字）表达，按意思理解：「帶我去 / 帶我過去 / 我要去 / 打開」都是要打开页面；「我要配置 AI 模型」这类「我要做某事」等于要打开做这件事的页面，直接 open_destination，不要只回答在哪里；「直接帶我過去」结合 conversation 判断去哪。',
    '- 用户问「X 在哪里」且 appMap 里有唯一明确的页面时，也直接 open_destination 打开它。需要项目的页面（path 含 :id）在没有 project 时：用户点名了项目就加 projectId，否则 ask_clarification 让用户从 projects 里选。',
    '- 「帮我办一场 xx / 我想做个 xx 项目 / 帮我建项目」用 create_project 一键生成（系统会先问全自动还是手动，草案都要经过校验）。「项目一 / 第一个项目」含义不明时 ask_clarification 并给候选项目。',
    '- 只要能用工具帮用户做事或拿到需要的数据就调用工具；需要数据才能回答的分析类问题先用查看类工具（list_tasks / show_task_detail / list_my_work / search_entities / project_summary / list_risks / look_at_page）拿数据，系统会把结果放进下一轮的 observations 再问你。只有纯知识问答、闲聊时才不调用工具、直接用简体中文回答。',
    '- 多步任务：observations 是上一轮工具的真实执行结果（带 iteration），以它为准、不要重复已做过的调用；全部完成后不再调用工具，直接用 Markdown 写结论（做了什么、结果如何、还有什么建议）。修改都会先让用户确认，observations 会告诉你用户确认了还是放弃了。',
    '- 绝不要说「我没有写入权限 / 只能只读 / 请你自己去页面操作」：修改都由工具完成，系统会先让用户确认。',
    '- 改日期与改状态时系统会按依赖自动顺延或往前拉后续任务（与界面同一套排期逻辑），不要再逐个改后续任务。',
    '- page 是用户当前页面（visibleText 可见文字、visualDescription 截图描述）；回答「这是什么 / 这里怎么做」以它为准，不够时调用 look_at_page。',
    '- 你只是提出建议，真正修改前系统会让用户逐条确认；不要说「已完成」。可以附一句简短说明你准备做什么。',
  ].join('\n')
}

/**
 * 原生工具调用结果 → 与 Prompt + JSON 相同的原始计划结构（再交给 normalizePlannedActions）。
 * 未知工具名、参数不是合法 JSON 的调用记入 unknownCalls。
 */
export function nativeToolCallsToRawPlan(result: {
  text: string
  toolCalls: readonly { name: string; arguments: Record<string, unknown> | null }[]
}): { raw: Record<string, unknown>; unknownCalls: string[] } {
  const byName = new Map(COLLEAGUE_PLANNER_TOOLS.map((tool) => [tool.name, tool]))
  const actions: Record<string, unknown>[] = []
  const questions: string[] = []
  const options: unknown[] = []
  const unknownCalls: string[] = []
  for (const call of result.toolCalls) {
    const tool = byName.get(call.name)
    if (!tool || call.arguments === null) {
      unknownCalls.push(call.name || '（无名调用）')
      continue
    }
    if (tool.name === PLANNER_CLARIFY_TOOL_NAME) {
      if (typeof call.arguments.question === 'string') questions.push(call.arguments.question)
      if (Array.isArray(call.arguments.options)) options.push(...call.arguments.options)
      continue
    }
    actions.push(tool.toAction(call.arguments))
  }
  const text = result.text.trim()
  const hasCalls = result.toolCalls.length > 0
  // 调用了查看类工具 = 要先看结果再想下一步（多步任务）
  const looked = result.toolCalls.some(
    (call) =>
      READ_TOOL_NAMES.has(call.name) &&
      !(call.name === 'search_entities' && call.arguments?.open === true),
  )
  return {
    raw: {
      isAction: hasCalls,
      actions,
      continue: looked,
      // 没有调用工具时的文字就是答复（多步任务的最后一轮）
      answer: hasCalls ? null : text || null,
      reply: hasCalls && text ? text : null,
      clarification: questions.length > 0 ? questions.join('\n') : null,
      options,
    },
    unknownCalls,
  }
}

/** 从模型原文里取出 JSON 对象（兼容 ```json 包裹与前后赘述）。 */
export function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const start = rawText.indexOf('{')
  const end = rawText.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(rawText.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function shortText(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * 校验并规范化模型给出的动作（纯函数，便于单测）。
 * 任务编号不在本项目 / 日期非法 / 枚举越界 → 丢弃并记一条原因。
 */
export function normalizePlannedActions(
  raw: Record<string, unknown>,
  context: {
    projectId: number | null
    tasks: readonly PlannerTaskRow[]
    appDestinations?: readonly ColleagueAppDestination[]
    uiPreferences?: ColleagueUiPreferenceOptions
    /** 可指派成员（含姓名，只用于界面文案，不回传模型）。 */
    members?: readonly DirectoryMember[]
    /** 已授权项目（open_project / 需要项目的页面只能落在这些项目上）。 */
    projects?: readonly PlannerProjectRow[]
    /** 可改的设置目录（change_setting 的 key 只能来自这里）。 */
    settings?: readonly PlannerSettingRow[]
  },
): Pick<
  ColleagueActionPlan,
  | 'isAction'
  | 'actions'
  | 'continue'
  | 'answer'
  | 'reply'
  | 'clarification'
  | 'clarificationOptions'
  | 'rejected'
> {
  const memberById = new Map((context.members ?? []).map((member) => [member.userId, member]))
  const taskById = new Map(context.tasks.map((task) => [task.id, task]))
  const projectById = new Map((context.projects ?? []).map((project) => [project.id, project]))
  const projectLabel = (project: PlannerProjectRow) =>
    project.code ? `${project.code}「${project.name}」` : `「${project.name}」`
  const destinationById = new Map(
    (context.appDestinations ?? []).map((destination) => [destination.id, destination]),
  )
  const preferenceOptions = context.uiPreferences ?? DEFAULT_UI_PREFERENCE_OPTIONS
  const rawActions = Array.isArray(raw.actions) ? raw.actions : []
  const actions: PlannedColleagueAction[] = []
  const rejected: string[] = []
  const { projectId } = context
  // 任务类动作作用于任务自己的项目；只有项目视图 / 本项目任务列表需要当前项目
  const PROJECT_ONLY = new Set(['navigate', 'list_tasks'])

  const taskLabel = (task: PlannerTaskRow) => `${task.code}「${task.name}」`
  const lookupTask = (value: unknown): PlannerTaskRow | null => {
    const id = toPositiveInt(value)
    if (id === null) return null
    return taskById.get(id) ?? null
  }

  for (const item of rawActions.slice(0, COLLEAGUE_PLANNER_MAX_ACTIONS)) {
    if (!item || typeof item !== 'object') continue
    const action = item as Record<string, unknown>
    const kind = typeof action.action === 'string' ? action.action : ''

    if (PROJECT_ONLY.has(kind) && projectId === null) {
      rejected.push('这一步需要先进入某个项目空间，已忽略')
      continue
    }

    if (kind === 'my_work') {
      const filter = ['open', 'today', 'overdue', 'this_week'].includes(String(action.filter))
        ? String(action.filter)
        : 'open'
      const labels: Record<string, string> = {
        open: '我所有未完成的工作',
        today: '我今天要处理的工作',
        overdue: '我已逾期的工作',
        this_week: '我这周要处理的工作',
      }
      actions.push({
        toolName: 'get_my_work',
        parameters: { filter },
        summary: `列出${labels[filter]}${action.prioritize === true ? '并给出优先级建议' : ''}`,
        ...(action.prioritize === true ? { followUp: 'prioritize' as const } : {}),
      })
      continue
    }

    if (kind === 'open_destination') {
      const destination = destinationById.get(String(action.destinationId ?? ''))
      if (!destination) {
        rejected.push('要打开的页面不在当前界面目录里，已忽略')
        continue
      }
      // 需要项目的页面：模型点名的项目（须在已授权清单里）优先，其次当前项目
      const namedProject =
        action.projectId === undefined || action.projectId === null
          ? null
          : (projectById.get(toPositiveInt(action.projectId) ?? -1) ?? null)
      const targetProjectId = namedProject?.id ?? projectId
      if (destination.path.includes(':id') && targetProjectId === null) {
        rejected.push(`「${destination.title}」需要先选定项目：请告诉我是哪个项目，已忽略`)
        continue
      }
      actions.push({
        toolName: 'open_app_page',
        parameters: {
          destinationId: destination.id,
          title: destination.title,
          path:
            targetProjectId === null
              ? destination.path
              : destination.path.replace(/:id/g, String(targetProjectId)),
        },
        summary: namedProject
          ? `打开${projectLabel(namedProject)}的「${destination.title}」`
          : `打开「${destination.title}」`,
      })
      continue
    }

    if (kind === 'open_project') {
      const project = projectById.get(toPositiveInt(action.projectId) ?? -1)
      if (!project) {
        rejected.push(`项目 #${String(action.projectId ?? '?')} 没有找到或无权查看，已忽略打开`)
        continue
      }
      const lens =
        typeof action.lens === 'string' &&
        (COLLEAGUE_OPEN_PROJECT_LENSES as readonly string[]).includes(action.lens)
          ? action.lens
          : null
      actions.push({
        toolName: 'open_app_page',
        parameters: {
          destinationId: `project:${project.id}`,
          title: project.name,
          path: `/next/projects/${project.id}${lens ? `?lens=${lens}` : ''}`,
        },
        summary: `打开项目 ${projectLabel(project)}`,
      })
      continue
    }

    if (kind === 'create_task') {
      const name = shortText(action.name, 200)
      if (!name) {
        rejected.push('新建任务缺少任务名，已忽略')
        continue
      }
      const named =
        action.projectId === undefined || action.projectId === null
          ? null
          : (projectById.get(toPositiveInt(action.projectId) ?? -1) ?? null)
      if (action.projectId !== undefined && action.projectId !== null && !named) {
        rejected.push(`新建「${name}」指定的项目没有找到或无权操作，已忽略`)
        continue
      }
      const targetProject = named?.id ?? projectId
      if (targetProject === null) {
        rejected.push(`新建「${name}」要先说清建在哪个项目，已忽略`)
        continue
      }
      let assigneeId: number | null = null
      if (typeof action.member === 'string' && action.member.trim()) {
        const userId = MemberDirectoryService.userIdByAlias([...memberById.values()], action.member)
        const member = userId === null ? undefined : memberById.get(userId)
        if (!member || !member.projectIds.includes(targetProject)) {
          rejected.push(`「${name}」要指派的人不是该项目的在职成员，已先不指派`)
        } else {
          assigneeId = member.userId
        }
      }
      const parent =
        action.parentTaskId === undefined || action.parentTaskId === null
          ? null
          : lookupTask(action.parentTaskId)
      if (parent && parent.projectId !== targetProject) {
        rejected.push(`「${name}」的父任务不在同一个项目，已建成普通任务`)
      }
      const startDate = isValidIsoDate(action.startDate) ? action.startDate : null
      const endDate = isValidIsoDate(action.endDate) ? action.endDate : null
      const steps = (Array.isArray(action.steps) ? action.steps : [])
        .map((step) => shortText(step, 200))
        .filter((step): step is string => Boolean(step))
        .slice(0, 30)
      const priority = ['low', 'medium', 'high', 'urgent'].includes(String(action.priority))
        ? String(action.priority)
        : null
      actions.push({
        toolName: 'create_task',
        parameters: {
          projectId: targetProject,
          name,
          ...(shortText(action.description, 4000)
            ? { description: shortText(action.description, 4000) }
            : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate && (!startDate || endDate >= startDate) ? { endDate } : {}),
          ...(priority ? { priority } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(parent && parent.projectId === targetProject ? { parentTaskId: parent.id } : {}),
          ...(steps.length > 0 ? { steps } : {}),
        },
        summary: `新建任务「${name}」${parent && parent.projectId === targetProject ? `（${taskLabel(parent)}的子任务）` : ''}`,
      })
      continue
    }

    if (kind === 'toggle_steps') {
      const task = lookupTask(action.taskId)
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权操作，已忽略勾选`)
        continue
      }
      if (typeof action.done !== 'boolean') {
        rejected.push(`${taskLabel(task)}要打勾还是取消打勾没说清，已忽略`)
        continue
      }
      const all = action.all === true
      const numbers = (Array.isArray(action.steps) ? action.steps : [])
        .map((value) => toPositiveInt(value))
        .filter((value): value is number => value !== null)
      const total = task.steps?.length ?? 0
      const valid = total > 0 ? numbers.filter((n) => n <= total) : numbers
      if (!all && valid.length === 0) {
        rejected.push(`${taskLabel(task)}要勾哪几步没说清（步骤序号从 1 起），已忽略`)
        continue
      }
      const verb = action.done ? '打勾' : '取消打勾'
      actions.push({
        toolName: 'toggle_task_steps',
        parameters: {
          projectId: task.projectId,
          taskId: task.id,
          done: action.done,
          ...(all ? { all: true } : { steps: [...new Set(valid)] }),
        },
        summary: all
          ? `把 ${taskLabel(task)}的全部步骤${verb}`
          : `把 ${taskLabel(task)}的第 ${[...new Set(valid)].join('、')} 步${verb}`,
      })
      continue
    }

    if (kind === 'change_setting') {
      const key = typeof action.key === 'string' ? action.key : ''
      const setting = (context.settings ?? []).find((row) => row.key === key)
      if (!setting) {
        rejected.push(`没有「${key || '?'}」这项可以代改的设置，已忽略；可以说「打开设置」自己改`)
        continue
      }
      if (!setting.writable) {
        rejected.push(
          `「${setting.label}」需要${setting.layer === 'project' ? '项目编辑' : setting.layer === 'organization' ? '组织管理' : '本人'}权限，当前账号不能修改`,
        )
        continue
      }
      if (action.value === undefined) {
        rejected.push(`「${setting.label}」没有给出新值，已忽略`)
        continue
      }
      const named =
        setting.layer === 'project' && action.projectId !== undefined && action.projectId !== null
          ? (projectById.get(toPositiveInt(action.projectId) ?? -1) ?? null)
          : null
      const targetProject = setting.layer === 'project' ? (named?.id ?? context.projectId) : null
      if (setting.layer === 'project' && targetProject === null) {
        rejected.push(`要改哪个项目的「${setting.label}」？请先进入项目或说出项目名`)
        continue
      }
      actions.push({
        toolName: 'update_setting',
        parameters: {
          key: setting.key,
          value: action.value,
          ...(targetProject !== null ? { projectId: targetProject } : {}),
        },
        summary: `修改${setting.layer === 'personal' ? '我的' : setting.layer === 'project' ? '项目的' : '组织的'}「${setting.label}」（确认前会先给你看改前改后）`,
      })
      continue
    }

    if (kind === 'delete_task') {
      const task = lookupTask(action.taskId)
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权操作，已忽略删除`)
        continue
      }
      actions.push({
        toolName: 'delete_task',
        parameters: { projectId: task.projectId, taskId: task.id },
        summary: `删除 ${taskLabel(task)}（移入回收站）`,
      })
      continue
    }

    if (kind === 'project_summary' || kind === 'list_risks') {
      const named =
        action.projectId === undefined || action.projectId === null
          ? null
          : (projectById.get(toPositiveInt(action.projectId) ?? -1) ?? null)
      const target = named?.id ?? projectId
      if (target === null) {
        rejected.push('要看哪个项目？请先说出项目名，已忽略')
        continue
      }
      const label = named ? projectLabel(named) : '当前项目'
      actions.push(
        kind === 'project_summary'
          ? {
              toolName: 'get_project_summary',
              parameters: { projectId: target },
              summary: `查看${label}的概况`,
            }
          : {
              toolName: 'list_project_risks',
              parameters: { projectId: target },
              summary: `查看${label}的风险清单`,
            },
      )
      continue
    }

    if (kind === 'look_at_page') {
      actions.push({ toolName: 'capture_page', parameters: {}, summary: '看一眼当前页面' })
      continue
    }

    if (kind === 'sign_out') {
      actions.push({ toolName: 'sign_out', parameters: {}, summary: '退出登录' })
      continue
    }

    if (kind === 'create_project') {
      const idea = shortText(action.idea, COLLEAGUE_PROJECT_IDEA_MAX)
      if (!idea) {
        rejected.push('没有说清要生成什么项目，已忽略')
        continue
      }
      actions.push({
        toolName: 'start_project_generation',
        parameters: { idea },
        summary: `一键生成项目：${idea.length > 40 ? `${idea.slice(0, 40)}…` : idea}`,
      })
      continue
    }

    if (kind === 'search') {
      const keyword = shortText(action.keyword, 100)
      if (!keyword) {
        rejected.push('搜索缺少关键词，已忽略')
        continue
      }
      const entityType =
        typeof action.entityType === 'string' &&
        (SEARCHABLE_ENTITY_TYPES as readonly string[]).includes(action.entityType)
          ? action.entityType
          : null
      actions.push({
        toolName: 'search_global_entities',
        parameters: {
          keyword,
          ...(entityType ? { entityTypes: [entityType] } : {}),
          ...(action.open === true ? { open: true } : {}),
        },
        summary: `搜索「${keyword}」${action.open === true ? '并前往' : ''}`,
      })
      continue
    }

    if (kind === 'set_preference') {
      const pick = (value: unknown, options: readonly { value: string; label: string }[]) =>
        typeof value === 'string'
          ? (options.find((option) => option.value === value) ?? null)
          : null
      const theme = pick(action.theme, preferenceOptions.themes)
      const density = pick(action.density, preferenceOptions.densities)
      const textVariant = pick(action.textVariant, preferenceOptions.textVariants)
      if (!theme && !density && !textVariant) {
        rejected.push('要切换的界面偏好无法识别，已忽略')
        continue
      }
      actions.push({
        toolName: 'set_ui_preference',
        parameters: {
          ...(theme ? { theme: theme.value } : {}),
          ...(density ? { density: density.value } : {}),
          ...(textVariant ? { textVariant: textVariant.value } : {}),
        },
        summary: `切换为${[theme, density, textVariant]
          .filter((option): option is { value: string; label: string } => option !== null)
          .map((option) => `「${option.label}」`)
          .join('、')}`,
      })
      continue
    }

    if (kind === 'set_status') {
      const task = lookupTask(action.taskId)
      const status = String(action.status ?? '') as TaskStatus
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权操作，已忽略改状态`)
        continue
      }
      if (!(TASK_STATUSES as readonly string[]).includes(status)) {
        rejected.push(`${taskLabel(task)}的目标状态无法识别，已忽略`)
        continue
      }
      actions.push({
        toolName: 'update_task_status',
        parameters: { projectId: task.projectId, taskId: task.id, status },
        summary: `把 ${taskLabel(task)}改为「${TASK_STATUS_LABELS[status]}」`,
      })
      continue
    }

    if (kind === 'reschedule') {
      const task = lookupTask(action.taskId)
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权操作，已忽略改日期`)
        continue
      }
      const startDate = isValidIsoDate(action.startDate) ? action.startDate : task.startDate
      const endDate = isValidIsoDate(action.endDate) ? action.endDate : null
      if (!startDate || !isValidIsoDate(startDate)) {
        rejected.push(`${taskLabel(task)}缺少有效的开始日期，已忽略改日期`)
        continue
      }
      if (endDate && endDate < startDate) {
        rejected.push(`${taskLabel(task)}的结束日期早于开始日期，已忽略改日期`)
        continue
      }
      // 工期不变的整体平移用 move；其余（改截止日 / 改工期）用 resize
      const originalSpan =
        task.startDate && task.endDate
          ? DateTime.fromISO(task.endDate).diff(DateTime.fromISO(task.startDate), 'days').days
          : null
      const newSpan = endDate
        ? DateTime.fromISO(endDate).diff(DateTime.fromISO(startDate), 'days').days
        : null
      const isMove = endDate === null || (originalSpan !== null && newSpan === originalSpan)
      actions.push({
        toolName: 'update_task_schedule',
        parameters: isMove
          ? {
              projectId: task.projectId,
              taskId: task.id,
              operation: 'move',
              startDate,
              autoSchedule: true,
            }
          : {
              projectId: task.projectId,
              taskId: task.id,
              operation: 'resize',
              startDate,
              endDate,
              autoSchedule: true,
            },
        summary: isMove
          ? `把 ${taskLabel(task)}移到 ${startDate} 开始`
          : `把 ${taskLabel(task)}改为 ${startDate} ~ ${endDate}`,
      })
      continue
    }

    if (kind === 'navigate') {
      const lens = String(action.lens ?? '') as (typeof COLLEAGUE_PLANNER_LENSES)[number]
      if (!(COLLEAGUE_PLANNER_LENSES as readonly string[]).includes(lens)) {
        rejected.push('要打开的页面无法识别，已忽略')
        continue
      }
      actions.push({
        toolName: 'navigate_to_space',
        parameters: { lens, depth: 'workbench', projectId },
        summary: `打开${LENS_LABELS[lens]}`,
      })
      continue
    }

    if (kind === 'list_tasks') {
      const status =
        typeof action.status === 'string' &&
        (TASK_STATUSES as readonly string[]).includes(action.status)
          ? (action.status as TaskStatus)
          : null
      const search = shortText(action.search, 100)
      actions.push({
        toolName: 'list_project_tasks',
        parameters: {
          projectId,
          ...(status ? { status } : {}),
          ...(search ? { search } : {}),
        },
        summary: `列出${status ? `「${TASK_STATUS_LABELS[status]}」的` : ''}任务${search ? `（关键词：${search}）` : ''}`,
      })
      continue
    }

    if (kind === 'assign') {
      const task = lookupTask(action.taskId)
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权操作，已忽略指派`)
        continue
      }
      if (action.unassign === true) {
        actions.push({
          toolName: 'update_task_assignee',
          parameters: { projectId: task.projectId, taskId: task.id, assigneeId: null },
          summary: `取消 ${taskLabel(task)}的指派`,
        })
        continue
      }
      const memberUserId = MemberDirectoryService.userIdByAlias(
        [...memberById.values()],
        String(action.member ?? ''),
      )
      const member = memberUserId === null ? undefined : memberById.get(memberUserId)
      if (!member || !member.projectIds.includes(task.projectId)) {
        rejected.push(`${taskLabel(task)}要指派的人不是该项目的在职成员，已忽略`)
        continue
      }
      actions.push({
        toolName: 'update_task_assignee',
        parameters: { projectId: task.projectId, taskId: task.id, assigneeId: member.userId },
        // 摘要只给界面：用真实姓名
        summary: `把 ${taskLabel(task)}指派给 ${member.name}`,
      })
      continue
    }

    if (kind === 'open_task') {
      const task = lookupTask(action.taskId)
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权查看，已忽略打开`)
        continue
      }
      actions.push({
        toolName: 'open_app_page',
        parameters: {
          destinationId: `task:${task.id}`,
          title: `${task.code} ${task.name}`,
          path: `/next/projects/${task.projectId}?focusTask=${task.id}`,
        },
        summary: `打开 ${taskLabel(task)}`,
      })
      continue
    }

    if (kind === 'task_detail') {
      const task = lookupTask(action.taskId)
      if (!task) {
        rejected.push(`任务 #${String(action.taskId ?? '?')} 没有找到或无权操作，已忽略查看详情`)
        continue
      }
      actions.push({
        toolName: 'get_task_detail',
        parameters: { projectId: task.projectId, taskId: task.id },
        summary: `查看 ${taskLabel(task)}的详情`,
      })
      continue
    }
  }

  // 合并重复动作（如「打勾」与「移到完成」都理解成改为已完成）：同一工具 + 同一参数只保留第一条
  const seen = new Set<string>()
  const deduped = actions.filter((item) => {
    const key = `${item.toolName}:${JSON.stringify(item.parameters)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // 模型回复里的成员代号换回姓名（这些文字只给界面）；不认识的代号显示为「某成员」
  const names = new Map([...memberById.values()].map((member) => [member.aliasCode, member.name]))
  const toUi = (value: string | null) =>
    value === null ? null : resolveAliasesToNames(value, names)
  const clarification = toUi(shortText(raw.clarification, 400))
  return {
    // 模型说是操作但一条有效动作都没有、也没追问时，仍按操作处理，把丢弃原因告诉用户
    isAction: raw.isAction === true || deduped.length > 0,
    actions: deduped,
    // 只有本轮还有动作要执行时「继续」才有意义（没有动作就没有新的观察结果）
    continue: raw.continue === true && deduped.length > 0,
    answer: toUi(shortText(raw.answer, 8000)),
    reply: toUi(shortText(raw.reply)),
    clarification,
    clarificationOptions: clarification ? normalizeClarificationOptions(raw.options, toUi) : [],
    rejected,
  }
}

/** 追问候选：去空去重、限长，最多 4 个（界面另加「自己输入」）。 */
export const COLLEAGUE_CLARIFICATION_MAX_OPTIONS = 4

function normalizeClarificationOptions(
  raw: unknown,
  toUi: (value: string | null) => string | null,
): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const options: string[] = []
  for (const item of raw) {
    const text = toUi(shortText(item, 80))
    if (!text || seen.has(text)) continue
    seen.add(text)
    options.push(text)
    if (options.length >= COLLEAGUE_CLARIFICATION_MAX_OPTIONS) break
  }
  return options
}

@inject()
export default class AiColleagueActionPlannerService {
  constructor(
    private policy: AiToolsPolicy,
    private searchPolicy: SearchPolicy,
  ) {}

  /** 测试可覆写。 */
  adapterResolver: typeof resolveAdapter = resolveAdapter

  /** 设置目录（用自然语言改设置）；测试可覆写。读不到时不给模型这一块，不影响其它操作。 */
  settingsLoader = async (
    user: User,
    organizationId: number,
    projectId: number | null,
  ): Promise<PlannerSettingRow[]> => {
    const catalog = await app.container.make(SettingsCatalogService)
    return catalog.listForPlanner({ user, organizationId, projectId, requestId: null })
  }

  private async loadSettings(
    user: User,
    organizationId: number,
    projectId: number | null,
  ): Promise<PlannerSettingRow[]> {
    try {
      return await this.settingsLoader(user, organizationId, projectId)
    } catch {
      return []
    }
  }

  async plan(input: PlanActionsInput): Promise<ColleagueActionPlan> {
    const text = input.text.trim()
    if (!text) throw new ValidationException('请输入要执行的操作')

    // 与只读工具同一道门：ai:trigger（+ 在项目内时的查看任务权限；跨组织/无权 → 统一 404/403）
    await this.policy.authorizeExecute(
      input.user,
      input.organizationId,
      input.projectId === null ? [] : [TASK_VIEW],
      input.projectId ?? undefined,
    )

    const project =
      input.projectId === null
        ? null
        : await Project.query()
            .where('id', input.projectId)
            .where('organization_id', input.organizationId)
            .whereNull('deleted_at')
            .firstOrFail()

    const allowedProjectIds = await this.searchPolicy.getAllowedProjectIds(
      input.user,
      input.organizationId,
    )
    const tasks = await loadPlannerTasks({
      currentProject: project,
      userId: Number(input.user.id),
      organizationId: input.organizationId,
      allowedProjectIds,
      referencedTaskIds: parseEntityCodes(text).taskIds,
      extraTaskIds: [
        ...(input.selectedTaskId ? [input.selectedTaskId] : []),
        ...(input.recentTaskIds ?? []),
      ],
    })

    // 成员：已授权项目里的在职成员；原话里的姓名先换成代号再交给模型
    const members = await new MemberDirectoryService().listMembers(input.organizationId, [
      ...new Set([...allowedProjectIds, ...(project ? [project.id] : [])]),
    ])
    const projects = await loadPlannerProjects(input.organizationId, [
      ...new Set([...allowedProjectIds, ...(project ? [project.id] : [])]),
    ])
    const conversation = (input.conversation ?? [])
      .slice(-COLLEAGUE_PLANNER_MAX_CONVERSATION)
      .map((turn) => ({
        role: turn.role,
        text: pseudonymizeText(shortText(turn.text, CONVERSATION_TEXT_MAX) ?? '', members),
      }))
      .filter((turn) => turn.text !== '')
    // 多步任务可能有几十轮：保留最近 OBSERVATION_KEEP 条，越早的结果截得越短（最近的给完整结果）
    const kept = (input.observations ?? []).slice(-OBSERVATION_KEEP)
    const observations = kept.map((item, index) => ({
      step: shortText(item.step, 200) ?? '',
      tool: shortText(item.tool, 60) ?? '',
      status: shortText(item.status, 40) ?? '',
      result: pseudonymizeText(
        shortText(
          item.result,
          index >= kept.length - OBSERVATION_FULL_RECENT
            ? OBSERVATION_RESULT_MAX
            : OBSERVATION_RESULT_OLDER_MAX,
        ) ?? '',
        members,
      ),
    }))
    const page = input.page
      ? {
          route: shortText(input.page.route, 300),
          title: shortText(input.page.title, 120),
          visibleText: pseudonymizeText(
            shortText(input.page.visibleText, PAGE_TEXT_MAX) ?? '',
            members,
          ),
          visualDescription: pseudonymizeText(
            shortText(input.page.visualDescription, PAGE_TEXT_MAX) ?? '',
            members,
          ),
        }
      : null
    const relevantProjectIds = new Set(tasks.map((task) => task.projectId))
    const promptMembers = members
      .filter((member) => member.projectIds.some((id) => relevantProjectIds.has(id)))
      .slice(0, 200)
      .map((member) => ({
        alias: memberAlias(input.organizationId, member.userId),
        projectIds: member.projectIds.filter((id) => relevantProjectIds.has(id)),
      }))
    const modelText = pseudonymizeText(text, members)

    const selectedTaskId =
      input.selectedTaskId && tasks.some((task) => task.id === input.selectedTaskId)
        ? input.selectedTaskId
        : null
    const appDestinations = input.appDestinations ?? []
    const uiPreferences = input.uiPreferences ?? DEFAULT_UI_PREFERENCE_OPTIONS
    const estimatedTokens =
      2_000 +
      tasks.length * 30 +
      appDestinations.length * 25 +
      projects.length * 20 +
      Math.ceil(JSON.stringify(input.observations ?? []).length / 2)

    const resolved = await this.adapterResolver({
      connectionId: input.modelPreference?.connectionId ?? undefined,
      modelId: input.modelPreference?.modelId ?? undefined,
      organizationId: input.organizationId,
      requiredCapabilities: ['chat'],
      estimatedTokens,
      recordContext: {
        organizationId: input.organizationId,
        projectId: project?.id ?? null,
        userId: input.user.id,
        connectionId: input.modelPreference?.connectionId ?? null,
        modelId: input.modelPreference?.modelId ?? null,
        capability: 'chat',
        surface: 'ai-colleague-action-plan',
        workflowName: 'ai-colleague-action-plan',
        source: 'user',
      },
    })
    // 只剩无 key 联调 Mock 时不理解：Mock 只会返回固定样例，交给用户会像「乱答」
    if (resolved.source === 'mock') {
      throw new ApiException(COLLEAGUE_NO_MODEL_MESSAGE, { status: 503, code: 'AI_SERVICE_ERROR' })
    }
    await resolved.throttle?.(estimatedTokens)

    const settings = await this.loadSettings(input.user, input.organizationId, project?.id ?? null)
    const userPrompt = buildPlannerUserPrompt({
      text: modelText,
      meAlias: memberAlias(input.organizationId, Number(input.user.id)),
      members: promptMembers,
      aliasOf: (userId) => memberAlias(input.organizationId, userId),
      today: DateTime.now().setZone('Asia/Shanghai').toISODate() ?? '',
      project: project ? { id: project.id, name: project.name } : null,
      tasks,
      selectedTaskId,
      appDestinations,
      uiPreferences,
      recentTaskIds: input.recentTaskIds,
      projects,
      conversation,
      observations,
      iteration: input.iteration,
      page,
      detailTaskIds: parseEntityCodes(text).taskIds,
      settings,
    })
    const modelLabel = resolved.model ? `${resolved.provider}/${resolved.model}` : null
    const requestedMode: AiToolCallingMode = resolved.toolCallingMode ?? 'prompt_json'
    const context = {
      projectId: project?.id ?? null,
      tasks,
      appDestinations,
      uiPreferences,
      members,
      projects,
      settings,
    }
    const meta = { model: modelLabel, requestedToolCallingMode: requestedMode }

    // ── 原生工具调用（OpenAI Chat / OpenAI Responses / Claude tool use）──
    const nativeApi = NATIVE_TOOL_API_BY_MODE[requestedMode]
    let fallbackReason: string | null = null
    if (nativeApi) {
      try {
        const result = await resolved.gateway.callTools({
          api: nativeApi,
          systemPrompt: buildNativePlannerSystemPrompt(),
          userPrompt,
          tools: COLLEAGUE_PLANNER_TOOLS.filter(
            (tool) => project !== null || GLOBAL_PLANNER_TOOL_NAMES.has(tool.name),
          ).map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          })),
          temperature: 0,
          promptName: `ai_colleague.action_plan.${requestedMode}`,
        })
        const { raw, unknownCalls } = nativeToolCallsToRawPlan(result)
        const normalized = normalizePlannedActions(raw, context)
        return {
          ...normalized,
          rejected: [
            ...normalized.rejected,
            ...unknownCalls.map((name) => `模型调用了无法识别的工具「${name}」，已忽略`),
          ],
          ...meta,
          toolCallingMode: requestedMode,
          fallbackReason: null,
        }
      } catch (error) {
        // 端点不支持工具 / Responses 端点不存在等：回退到 Prompt + JSON（如实告知）
        fallbackReason = describeNativeFailure(error)
      }
    }

    // ── Prompt + JSON（原方式，也是回退路径）──
    const generated = await resolved.gateway.generate({
      sentence: text,
      promptSet: { systemPrompt: buildPlannerSystemPrompt(), userPrompt },
      strategy: 'prompt',
      temperature: 0,
      promptName: 'ai_colleague.action_plan',
      requestTimeoutMs: 120_000,
    })
    const parsed = extractJsonObject(generated.rawText)
    const fallbackMeta = { ...meta, toolCallingMode: 'prompt_json' as const, fallbackReason }
    if (!parsed) {
      // 模型没给出可解析的计划：当作普通提问，交回前端走问答
      return {
        isAction: false,
        actions: [],
        continue: false,
        answer: null,
        reply: null,
        clarification: null,
        clarificationOptions: [],
        rejected: [],
        ...fallbackMeta,
      }
    }
    return { ...normalizePlannedActions(parsed, context), ...fallbackMeta }
  }
}

/** 原生工具调用失败原因（低敏、给用户看）。 */
export function describeNativeFailure(error: unknown): string {
  const status = (error as { status?: unknown })?.status
  const message = String((error as { message?: unknown })?.message ?? '').slice(0, 160)
  if (typeof status === 'number')
    return `原生工具调用失败（HTTP ${status}${message ? `：${message}` : ''}）`
  return `原生工具调用失败${message ? `（${message}）` : ''}`
}

/** JSON 列（PG 返回对象，SQLite 返回字符串）。 */
function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value as Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 交给模型的项目清单：已授权、组织内、未删除，按项目 ID 顺序（PROJ-1 在前）。 */
export async function loadPlannerProjects(
  organizationId: number,
  allowedProjectIds: readonly number[],
): Promise<PlannerProjectRow[]> {
  if (allowedProjectIds.length === 0) return []
  const rows = (await db
    .from('projects')
    .whereIn('id', [...allowedProjectIds])
    .where('organization_id', organizationId)
    .whereNull('deleted_at')
    .orderBy('id', 'asc')
    .limit(COLLEAGUE_PLANNER_MAX_PROJECTS)
    .select('id', 'code', 'name', 'status')) as Record<string, unknown>[]
  return rows.map((row) => ({
    id: Number(row.id),
    code: typeof row.code === 'string' && row.code !== '' ? row.code : null,
    name: String(row.name ?? ''),
    status: String(row.status ?? ''),
  }))
}

/**
 * 交给模型的任务清单：当前项目任务 + 我负责的其他项目未完成任务 + 提到编号 / 选中 / 上一张清单里的任务。
 * 一律限定在已授权项目（与全域搜索同口径）且组织内、未删除。
 */
export async function loadPlannerTasks(input: {
  currentProject: { id: number } | null
  userId: number
  organizationId: number
  allowedProjectIds: readonly number[]
  referencedTaskIds: readonly number[]
  extraTaskIds: readonly number[]
}): Promise<PlannerTaskRow[]> {
  const allowed = [...new Set(input.allowedProjectIds)]
  if (input.currentProject && !allowed.includes(input.currentProject.id)) {
    allowed.push(input.currentProject.id)
  }
  if (allowed.length === 0) return []
  const base = () =>
    db
      .from('tasks')
      .join('projects', 'projects.id', 'tasks.project_id')
      .whereIn('tasks.project_id', allowed)
      .where('projects.organization_id', input.organizationId)
      .whereNull('tasks.deleted_at')
      .whereNull('projects.deleted_at')
      .select(
        'tasks.id',
        'tasks.name',
        'tasks.status',
        'tasks.start_date',
        'tasks.end_date',
        'tasks.project_id',
        'tasks.assignee_id',
        'tasks.custom_fields',
        'tasks.description',
        'projects.code as project_code',
      )
  const pointed = [...new Set([...input.referencedTaskIds, ...input.extraTaskIds])].slice(0, 30)
  const [current, mine, referenced] = await Promise.all([
    input.currentProject
      ? base()
          .where('tasks.project_id', input.currentProject.id)
          .orderBy('tasks.id', 'asc')
          .limit(COLLEAGUE_PLANNER_MAX_TASKS)
      : Promise.resolve([]),
    base()
      .where('tasks.assignee_id', input.userId)
      .whereIn('tasks.status', ['not_started', 'in_progress', 'blocked', 'on_hold'])
      .orderBy('tasks.end_date', 'asc')
      .limit(COLLEAGUE_PLANNER_MAX_MY_TASKS),
    pointed.length > 0 ? base().whereIn('tasks.id', pointed) : Promise.resolve([]),
  ])
  const byId = new Map<number, PlannerTaskRow>()
  for (const row of [...current, ...mine, ...referenced] as Record<string, unknown>[]) {
    const id = Number(row.id)
    if (byId.has(id)) continue
    const projectId = Number(row.project_id)
    byId.set(id, {
      id,
      name: String(row.name ?? ''),
      status: String(row.status ?? ''),
      startDate: dateOf(row.start_date),
      endDate: dateOf(row.end_date),
      projectId,
      code: formatTaskCode({ id: projectId, code: row.project_code as string | null }, id),
      assigneeId:
        row.assignee_id === null || row.assignee_id === undefined ? null : Number(row.assignee_id),
      steps: numberedSteps({
        customFields: jsonObject(row.custom_fields),
        description: (row.description as string | null) ?? null,
      }),
    })
  }
  return [...byId.values()]
}
