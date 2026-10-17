/**
 * 生成剧场 3D 场景状态机与数据转换映射纯函数
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §2 (State-Driven Scene)
 * - design.md Decision 2, Decision 3, §2.3
 * - RL-14: 纯函数确定性映射，零非确定性抖动
 */

import type {
  ProjectDraftModule,
  ProjectDraftModuleStatus,
  ProjectDraftSessionStatus,
  ProjectDraftFailureDetail,
} from '@aiproj/types'
import type { AiProjectDraftStatus } from '@/stores/ai-project-draft-store'

export type TheaterSceneMode =
  'idle' | 'clarifying' | 'ready' | 'generating' | 'review' | 'settled' | 'disrupted'

/**
 * 9 模块三维空间坐标拓扑定义（设计系统确定性坐标分布）
 * 遵循 design.md Decision 3
 */
export const MODULE_POSITIONS: Record<ProjectDraftModule, [number, number, number]> = {
  charter: [0, 3, 0],
  wbs: [-2.5, 1.8, 0],
  tasks: [2.5, 1.8, 0],
  dependencies: [-3.2, -0.4, 0],
  acceptance: [3.2, -0.4, 0],
  resource: [-2.5, -2.4, 0],
  risk: [2.5, -2.4, 0],
  milestone: [-1.2, -3.8, 0],
  ganttPreview: [1.2, -3.8, 0],
}

/**
 * 9 模块三维材质色彩语义映射
 * 严格取自设计系统令牌（冷青/天青/战术冷蓝/警戒琥珀）
 */
export const MODULE_COLORS: Record<ProjectDraftModule, string> = {
  charter: '#38bdf8', // --nx-space-cyan 立方基石
  wbs: '#00f0ff', // --nx-space-ai 分形拓扑
  tasks: '#60a5fa', // --nx-accent 六边形阵列
  dependencies: '#00f0ff', // --nx-space-ai 拓扑导轨
  acceptance: '#38bdf8', // --nx-space-cyan 双层锁止圆环
  resource: '#818cf8', // tactical indigo 多面棱柱
  risk: '#f59e0b', // --nx-status-warning 警戒菱面
  milestone: '#38bdf8', // --nx-space-cyan 星标立柱
  ganttPreview: '#00f0ff', // --nx-space-ai 时空轨道
}

export const MODULE_LABELS: Record<ProjectDraftModule, string> = {
  charter: '项目章程',
  wbs: '工作分解',
  tasks: '任务清单',
  dependencies: '依赖关系',
  acceptance: '验收标准',
  resource: '资源分工',
  risk: '风险建议',
  milestone: '里程碑',
  ganttPreview: '甘特沙盘',
}

export interface ModuleConstructVisualState {
  module: ProjectDraftModule
  status: ProjectDraftModuleStatus
  position: [number, number, number]
  color: string
  wireframe: boolean
  opacity: number
  scale: number
  glowIntensity: number
  label: string
}

/**
 * 将业务 store 状态单向纯映射为 3D 场景模式
 * 严格对齐 design.md Decision 2 映射表
 */
export function mapDraftStateToSceneMode(
  status: AiProjectDraftStatus,
  draftStatus: ProjectDraftSessionStatus | null,
  failure: ProjectDraftFailureDetail | null,
): TheaterSceneMode {
  if (failure || status === 'error' || draftStatus === 'error') {
    return 'disrupted'
  }
  if (draftStatus === 'confirmed') {
    return 'settled'
  }
  if (draftStatus === 'reviewing' || draftStatus === 'editing') {
    return 'review'
  }
  if (draftStatus === 'drafting') {
    return 'generating'
  }
  if (status === 'clarifying') {
    return 'clarifying'
  }
  if (status === 'ready') {
    return 'ready'
  }
  return 'idle'
}

/**
 * 获取特定模块在当前建造状态下的视觉渲染属性（纯函数）
 * 严格对齐 design.md Decision 3 四态视觉表现
 */
export function getModuleConstructVisualState(
  module: ProjectDraftModule,
  moduleStatus?: ProjectDraftModuleStatus,
  sceneMode: TheaterSceneMode = 'idle',
): ModuleConstructVisualState {
  const status: ProjectDraftModuleStatus = moduleStatus ?? 'pending'
  const position = MODULE_POSITIONS[module] || [0, 0, 0]
  const baseColor = MODULE_COLORS[module] || '#38bdf8'
  const label = MODULE_LABELS[module] || module

  if (sceneMode === 'disrupted' && status === 'failed') {
    return {
      module,
      status: 'failed',
      position,
      color: '#ef4444',
      wireframe: true,
      opacity: 0.6,
      scale: 0.9,
      glowIntensity: 0.2,
      label,
    }
  }

  switch (status) {
    case 'generating':
      return {
        module,
        status: 'generating',
        position,
        color: baseColor,
        wireframe: false,
        opacity: 0.85,
        scale: 1.05,
        glowIntensity: 0.8,
        label,
      }
    case 'completed':
      return {
        module,
        status: 'completed',
        position,
        color: baseColor,
        wireframe: false,
        opacity: 1.0,
        scale: 1.0,
        glowIntensity: 0.4,
        label,
      }
    case 'failed':
      return {
        module,
        status: 'failed',
        position,
        color: '#ef4444',
        wireframe: true,
        opacity: 0.6,
        scale: 0.9,
        glowIntensity: 0.2,
        label,
      }
    case 'pending':
    default:
      return {
        module,
        status: 'pending',
        position,
        color: baseColor,
        wireframe: true,
        opacity: 0.25,
        scale: 0.95,
        glowIntensity: 0.1,
        label,
      }
  }
}
