// v3-ai-tools-orchestration-layer W2 —— 全部 P0 工具 Handler 汇总出口 + 静态装配（RL-14）
//
// 接线契约（W1 registry.ts 文件头注明）：
// - 本文件在模块加载期即把全部在册工具定义（既有 8 个 P0 + v3-triz-contradiction-copilot 的
//   6 个 = 14）注册进 `AiToolsRegistry` 单例并 `seal()`（注册点仅服务端代码可触达）；
// - 生产侧需由 controller / executor 的模块图顶层 side-effect import 本文件
//   （例如 `import '#services/ai_tools/handlers'`），保证请求到达前完成静态装配；
//   未完成该 import 时工具名一律 404（fail-closed，不泄露存在性）。
// - 写工具 `update_task_schedule` 的两阶段在单 handler 内按入参区分：
//   execute（无 previewToken）→ PREVIEW_REQUIRED；confirm（executor 合入
//   previewToken）→ SUCCESS 单事务落库。无需独立 confirm 出口。
// - deps 缺省时 handler 惰性从容器解析（app.container.make）；测试可显式传入。
import {
  AiToolsRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolSideEffect,
} from '../registry.js'
import type GanttBaselineService from '#services/gantt_baseline_service'
import type GanttSchedulingService from '#services/gantt_scheduling_service'
import type ProjectService from '#services/project_service'
import type ProjectSignalPolicy from '#policies/project_signal_policy'
import type ProjectSignalService from '#services/project_signal/project_signal_service'
import type RiskService from '#services/risk_service'
import type SearchPolicy from '#policies/search_policy'
import type SearchService from '#services/search_service'
import type TaskService from '#services/task_service'
import type TrizCopilotAnalysisService from '#services/triz_copilot/triz_copilot_analysis_service'
import type TrizInterventionCommitService from '#services/triz_copilot/triz_intervention_commit_service'
import {
  createAnalyzeProjectContradictionTool,
  ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
} from './analyze_project_contradiction.js'
import {
  createCreateChangeRequestFromInterventionTool,
  CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME,
} from './create_change_request_from_intervention.js'
import {
  createCreateRiskFromInterventionTool,
  CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
} from './create_risk_from_intervention.js'
import {
  createCreateTaskFromInterventionTool,
  CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
} from './create_task_from_intervention.js'
import { createGetGanttSnapshotTool, GET_GANTT_SNAPSHOT_TOOL_NAME } from './get_gantt_snapshot.js'
import { createGetTrizAnalysisTool, GET_TRIZ_ANALYSIS_TOOL_NAME } from './get_triz_analysis.js'
import {
  createGetProjectSummaryTool,
  GET_PROJECT_SUMMARY_TOOL_NAME,
} from './get_project_summary.js'
import { createGetTaskDetailTool, GET_TASK_DETAIL_TOOL_NAME } from './get_task_detail.js'
import {
  createListProjectSignalsTool,
  LIST_PROJECT_SIGNALS_TOOL_NAME,
} from './list_project_signals.js'
import { createListProjectRisksTool, LIST_PROJECT_RISKS_TOOL_NAME } from './list_project_risks.js'
import { createListProjectTasksTool, LIST_PROJECT_TASKS_TOOL_NAME } from './list_project_tasks.js'
import {
  createNavigateToSpaceTool,
  NAVIGATE_TO_SPACE_LENSES,
  NAVIGATE_TO_SPACE_TOOL_NAME,
} from './navigate_to_space.js'
import {
  createSearchProjectsTasksTool,
  SEARCH_PROJECTS_TASKS_TOOL_NAME,
} from './search_projects_tasks.js'
import {
  createUpdateTaskScheduleTool,
  UPDATE_TASK_SCHEDULE_TOOL_NAME,
  type UpdateTaskScheduleParams,
  type UpdateTaskScheduleResult,
} from './update_task_schedule.js'
import { createUpdateTaskStatusTool, UPDATE_TASK_STATUS_TOOL_NAME } from './update_task_status.js'
import { createGetMyWorkTool, GET_MY_WORK_TOOL_NAME } from './get_my_work.js'
import {
  createUpdateTaskAssigneeTool,
  UPDATE_TASK_ASSIGNEE_TOOL_NAME,
} from './update_task_assignee.js'
import { createDeleteTaskTool, DELETE_TASK_TOOL_NAME } from './delete_task.js'
import { createCreateTaskTool, CREATE_TASK_TOOL_NAME } from './create_task.js'
import { createToggleTaskStepsTool, TOGGLE_TASK_STEPS_TOOL_NAME } from './toggle_task_steps.js'
import { createUpdateSettingTool, UPDATE_SETTING_TOOL_NAME } from './update_setting.js'

export {
  GET_GANTT_SNAPSHOT_TOOL_NAME,
  GET_PROJECT_SUMMARY_TOOL_NAME,
  GET_TASK_DETAIL_TOOL_NAME,
  LIST_PROJECT_RISKS_TOOL_NAME,
  LIST_PROJECT_TASKS_TOOL_NAME,
  NAVIGATE_TO_SPACE_LENSES,
  NAVIGATE_TO_SPACE_TOOL_NAME,
  SEARCH_PROJECTS_TASKS_TOOL_NAME,
  UPDATE_TASK_SCHEDULE_TOOL_NAME,
  UPDATE_TASK_STATUS_TOOL_NAME,
  GET_MY_WORK_TOOL_NAME,
  UPDATE_TASK_ASSIGNEE_TOOL_NAME,
  DELETE_TASK_TOOL_NAME,
  CREATE_TASK_TOOL_NAME,
  TOGGLE_TASK_STEPS_TOOL_NAME,
  UPDATE_SETTING_TOOL_NAME,
  // v3-triz-contradiction-copilot 任务 2.4（W2b 5 个 + W4 补 `list_project_signals` = 6 个）
  ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
  GET_TRIZ_ANALYSIS_TOOL_NAME,
  CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME,
  LIST_PROJECT_SIGNALS_TOOL_NAME,
}
export { createGetGanttSnapshotTool, createGetProjectSummaryTool, createGetTaskDetailTool }
export { createListProjectRisksTool, createListProjectTasksTool, createNavigateToSpaceTool }
export {
  createSearchProjectsTasksTool,
  createUpdateTaskScheduleTool,
  createUpdateTaskStatusTool,
  createGetMyWorkTool,
  createUpdateTaskAssigneeTool,
  createDeleteTaskTool,
  createCreateTaskTool,
  createToggleTaskStepsTool,
  createUpdateSettingTool,
}
export {
  createAnalyzeProjectContradictionTool,
  createGetTrizAnalysisTool,
  createCreateTaskFromInterventionTool,
  createCreateRiskFromInterventionTool,
  createCreateChangeRequestFromInterventionTool,
  createListProjectSignalsTool,
}
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolSideEffect,
  UpdateTaskScheduleParams,
  UpdateTaskScheduleResult,
}

/** 全部 handler 所需的领域服务依赖（W3/测试可显式注入；缺省惰性容器解析）。 */
export interface AiToolsHandlerDeps {
  readonly projectService: ProjectService
  readonly taskService: TaskService
  readonly riskService: RiskService
  readonly ganttBaselineService: GanttBaselineService
  readonly searchService: SearchService
  readonly searchPolicy: SearchPolicy
  readonly ganttSchedulingService: GanttSchedulingService
  /** v3-triz-contradiction-copilot：TRIZ 分析服务与干预落库确认服务（可选，缺省容器解析）。 */
  readonly trizCopilotAnalysisService?: TrizCopilotAnalysisService
  readonly trizInterventionCommitService?: TrizInterventionCommitService
  /** 被动雷达（W3）信号读取服务与领域权限策略（可选，缺省容器解析）。 */
  readonly projectSignalService?: ProjectSignalService
  readonly projectSignalPolicy?: ProjectSignalPolicy
}

/** 在册工具名白名单（供编排层校验未知工具名 → 404，RL-14）。 */
export const AI_TOOLS_NAMES = [
  NAVIGATE_TO_SPACE_TOOL_NAME,
  GET_PROJECT_SUMMARY_TOOL_NAME,
  LIST_PROJECT_TASKS_TOOL_NAME,
  GET_TASK_DETAIL_TOOL_NAME,
  LIST_PROJECT_RISKS_TOOL_NAME,
  GET_GANTT_SNAPSHOT_TOOL_NAME,
  SEARCH_PROJECTS_TASKS_TOOL_NAME,
  UPDATE_TASK_SCHEDULE_TOOL_NAME,
  // v3-triz-contradiction-copilot（W2b 5 个 + W4 补 1 个）：只读 3 + 写 3。
  ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
  GET_TRIZ_ANALYSIS_TOOL_NAME,
  CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME,
  LIST_PROJECT_SIGNALS_TOOL_NAME,
  // AI 同事自然语言操作：勾选完成 / 移到进行中等任务状态修改（写，预览拦截）
  UPDATE_TASK_STATUS_TOOL_NAME,
  // AI 同事「我的工作」：跨项目未完成任务汇总（只读）
  GET_MY_WORK_TOOL_NAME,
  // AI 同事：改任务负责人（写，预览拦截）
  UPDATE_TASK_ASSIGNEE_TOOL_NAME,
  // AI 同事：删除任务（移入回收站，写，预览拦截）
  DELETE_TASK_TOOL_NAME,
  // AI 同事：新建任务、勾选 / 取消执行步骤（写，预览拦截）
  CREATE_TASK_TOOL_NAME,
  TOGGLE_TASK_STEPS_TOOL_NAME,
  // AI 同事：用自然语言改设置（个人 / 项目 / 组织；写，预览拦截）
  UPDATE_SETTING_TOOL_NAME,
] as const

/**
 * 装配全部在册工具定义（既有 8 个 P0 工具 + TRIZ 矛盾求解 5 个 + 被动雷达 1 个 = 14）。
 * 传 deps 供测试直连；缺省时各 handler 惰性从容器解析服务。
 */
export function buildAllAiToolDefinitions(deps?: AiToolsHandlerDeps): ToolDefinition[] {
  // 工具定义是「强类型泛型契约」的实例；注册表以非泛型 ToolDefinition 收口，
  // 此处做有界收窄（handler 签名在运行时以 ctx + 原始入参调用，类型仅编译期）。
  const definitions: ToolDefinition[] = [
    createNavigateToSpaceTool(deps) as unknown as ToolDefinition,
    createGetProjectSummaryTool(deps) as unknown as ToolDefinition,
    createListProjectTasksTool(deps) as unknown as ToolDefinition,
    createGetTaskDetailTool(deps) as unknown as ToolDefinition,
    createListProjectRisksTool(deps) as unknown as ToolDefinition,
    createGetGanttSnapshotTool(deps) as unknown as ToolDefinition,
    createSearchProjectsTasksTool(deps) as unknown as ToolDefinition,
    createUpdateTaskScheduleTool(deps) as unknown as ToolDefinition,
    // v3-triz-contradiction-copilot（W2b）—— 只读 2 + 写 3（写工具 execute 一律预览拦截）。
    createAnalyzeProjectContradictionTool(
      deps?.trizCopilotAnalysisService
        ? { analysisService: deps.trizCopilotAnalysisService }
        : undefined,
    ) as unknown as ToolDefinition,
    createGetTrizAnalysisTool(
      deps?.trizCopilotAnalysisService
        ? { analysisService: deps.trizCopilotAnalysisService }
        : undefined,
    ) as unknown as ToolDefinition,
    createCreateTaskFromInterventionTool(
      deps?.trizInterventionCommitService
        ? { interventionService: deps.trizInterventionCommitService }
        : undefined,
    ) as unknown as ToolDefinition,
    createCreateRiskFromInterventionTool(
      deps?.trizInterventionCommitService
        ? { interventionService: deps.trizInterventionCommitService }
        : undefined,
    ) as unknown as ToolDefinition,
    createCreateChangeRequestFromInterventionTool(
      deps?.trizInterventionCommitService
        ? { interventionService: deps.trizInterventionCommitService }
        : undefined,
    ) as unknown as ToolDefinition,
    // v3-triz-contradiction-copilot（W4 补 2.4 的第 6 个工具）—— 被动雷达只读信号列表。
    createListProjectSignalsTool(
      deps?.projectSignalService || deps?.projectSignalPolicy
        ? {
            signalService: deps.projectSignalService,
            policy: deps.projectSignalPolicy,
          }
        : undefined,
    ) as unknown as ToolDefinition,
    // AI 同事自然语言操作：任务状态修改（写工具，execute 一律预览拦截）。
    createUpdateTaskStatusTool(
      deps?.taskService ? { taskService: deps.taskService } : undefined,
    ) as unknown as ToolDefinition,
    // AI 同事「我的工作」（只读）。
    createGetMyWorkTool(
      deps?.searchPolicy ? { searchPolicy: deps.searchPolicy } : undefined,
    ) as unknown as ToolDefinition,
    // AI 同事：改任务负责人（写工具，execute 一律预览拦截）。
    createUpdateTaskAssigneeTool(
      deps?.taskService ? { taskService: deps.taskService } : undefined,
    ) as unknown as ToolDefinition,
    // AI 同事：删除任务（移入回收站；写工具，execute 一律预览拦截）。
    createDeleteTaskTool(
      deps?.taskService ? { taskService: deps.taskService } : undefined,
    ) as unknown as ToolDefinition,
    // AI 同事：新建任务、勾选 / 取消执行步骤（写工具，execute 一律预览拦截）。
    createCreateTaskTool(
      deps?.taskService ? { taskService: deps.taskService } : undefined,
    ) as unknown as ToolDefinition,
    createToggleTaskStepsTool(
      deps?.taskService ? { taskService: deps.taskService } : undefined,
    ) as unknown as ToolDefinition,
    // AI 同事：用自然语言改设置（写工具，execute 一律预览拦截）。
    createUpdateSettingTool() as unknown as ToolDefinition,
  ]
  return definitions
}

// ---- RL-14 静态装配：模块加载即注册并 seal（注册点仅服务端代码触达；无运行时动态注入） ----
const registry = AiToolsRegistry.getInstance()
registry.register(buildAllAiToolDefinitions())
registry.seal()
