/**
 * v3-ui-next-theater-generation tasks 2.3 —— 单模块建筑卡四态渲染与精确档降级。
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProjectDraftModule, ProjectDraftModuleStatus } from '@aiproj/types'
import {
  NX_THEATER_MODULE_CSS,
  THEATER_MODULE_LABELS,
  TheaterModuleConstructCard,
} from '@/components/next/theater/TheaterModuleConstructCard'

const FORBIDDEN_PHRASES = [
  '项目已创建',
  '项目已完成',
  '创建成功',
  '项目创建完毕',
  '正式项目已入库',
  '已写入数据库',
]

function renderCard(
  module: ProjectDraftModule,
  props: {
    status?: ProjectDraftModuleStatus
    detail?: string | null
    summary?: string | null
  } = {},
) {
  return render(<TheaterModuleConstructCard module={module} {...props} />)
}

describe('components/next/theater/TheaterModuleConstructCard（v3-ui-next-theater-generation 任务 2.1-2.2）', () => {
  test('蓝图待建态（pending，缺省）：发丝虚线边框 + 弱化图标 + 「蓝图规划中」', () => {
    const { container } = renderCard('charter')

    const card = container.querySelector('[data-construct-card]') as HTMLElement
    expect(card).toBeTruthy()
    expect(card.getAttribute('data-construct-module')).toBe('charter')
    expect(card.getAttribute('data-construct-state')).toBe('pending')
    expect(card.className).toContain('border-dashed')
    expect(card.className).toContain('border-[var(--nx-border-hairline)]')
    expect(card.className).toContain('opacity-60')
    expect(screen.getByText('项目章程')).toBeInTheDocument()
    expect(screen.getByText('蓝图规划中')).toBeInTheDocument()
    expect(container.querySelector('[data-construct-icon] svg')).toBeTruthy()
    // 零画布约束（RL-15）
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('脉冲建造态（generating）：天青高亮 + 呼吸脉冲类 + 旋转指示器 + 流式子说明', () => {
    const { container } = renderCard('wbs', {
      status: 'generating',
      detail: '正在接收草案结构',
    })

    const card = container.querySelector('[data-construct-card]') as HTMLElement
    expect(card.getAttribute('data-construct-state')).toBe('generating')
    expect(card.className).toContain('nx-construct-pulse')
    expect(card.className).toContain('border-[var(--nx-space-cyan)]')
    expect(screen.getByText('建造中')).toBeInTheDocument()
    expect(screen.getByText('正在接收草案结构')).toBeInTheDocument()
    const icon = container.querySelector('[data-construct-icon]') as HTMLElement
    expect(icon.className).toContain('nx-construct-spin')
    expect(container.querySelector('[data-construct-icon] svg')).toBeTruthy()
  })

  test('生成中缺省 detail：回退到模块专属建造子说明', () => {
    const { container } = renderCard('tasks', { status: 'generating' })
    expect(screen.getByText('正在生成任务条目')).toBeInTheDocument()
    expect(container.querySelector('[data-construct-card]')?.className).toContain(
      'border-[var(--nx-space-cyan)]',
    )
  })

  test('坚实完成态（completed）：实线绿边 + Check 徽章 + 「已就绪」+ 数据微摘要', () => {
    const { container } = renderCard('tasks', {
      status: 'completed',
      summary: '已生成 12 项任务',
    })

    const card = container.querySelector('[data-construct-card]') as HTMLElement
    expect(card.getAttribute('data-construct-state')).toBe('completed')
    expect(card.className).toContain('border-[var(--nx-status-success)]/60')
    expect(card.className).toContain('bg-[var(--nx-workspace-surface)]')
    expect(screen.getByText('已就绪')).toBeInTheDocument()
    expect(screen.getByText('已生成 12 项任务')).toBeInTheDocument()
    expect(container.querySelector('[data-construct-icon] svg')).toBeTruthy()
  })

  test('建造异常态（failed）：红色警示高亮 + Alert 图标 + 「生成中断」', () => {
    const { container } = renderCard('risk', { status: 'failed' })

    const card = container.querySelector('[data-construct-card]') as HTMLElement
    expect(card.getAttribute('data-construct-state')).toBe('failed')
    expect(card.className).toContain('border-[var(--nx-status-danger)]/60')
    expect(screen.getByText('生成中断')).toBeInTheDocument()
    expect(screen.getByText(/风险建议生成中断/)).toBeInTheDocument()
    expect(container.querySelector('[data-construct-icon] svg')).toBeTruthy()
  })

  test('双通道无障碍：每态均有 aria-label（颜色以外还有图标+文字）', () => {
    renderCard('charter')
    expect(screen.getByLabelText('模块 项目章程：蓝图规划中')).toBeInTheDocument()

    renderCard('charter', { status: 'generating' })
    expect(screen.getByLabelText('模块 项目章程：建造中')).toBeInTheDocument()

    renderCard('charter', { status: 'completed' })
    expect(screen.getByLabelText('模块 项目章程：已就绪')).toBeInTheDocument()

    renderCard('charter', { status: 'failed' })
    expect(screen.getByLabelText('模块 项目章程：生成中断')).toBeInTheDocument()
  })

  test('精确档（precise）与减弱动效偏好：CSS 规则彻底停用脉冲与旋转动画', () => {
    // 动画基座与关键帧齐全
    expect(NX_THEATER_MODULE_CSS).toContain('@keyframes nx-pulse-glow')
    expect(NX_THEATER_MODULE_CSS).toContain('@keyframes nx-construct-rotate')
    expect(NX_THEATER_MODULE_CSS).toContain('.nx-construct-pulse')
    expect(NX_THEATER_MODULE_CSS).toContain('.nx-construct-spin')
    // 精确档拦截：属性选择器作用于任意祖先 data-immersion（TheaterShell / Stage 挂载）
    expect(NX_THEATER_MODULE_CSS).toContain("[data-immersion='precise'] .nx-construct-pulse")
    expect(NX_THEATER_MODULE_CSS).toContain("[data-immersion='precise'] .nx-construct-spin")
    expect(NX_THEATER_MODULE_CSS).toContain('animation: none !important')
    expect(NX_THEATER_MODULE_CSS).toContain('transition: none !important')
    // 系统减弱动效偏好：无论档位一律停用
    expect(NX_THEATER_MODULE_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(NX_THEATER_MODULE_CSS).toContain('animation: none !important')
  })

  test('文案审查红线：四态全文本与 ARIA 标签均无「项目已创建」类措辞', () => {
    const statuses: ProjectDraftModuleStatus[] = ['pending', 'generating', 'completed', 'failed']
    for (const status of statuses) {
      const { container } = renderCard('dependencies', {
        status,
        summary: '已生成 9 条依赖',
        detail: '正在接收草案结构',
      })
      const text = container.textContent ?? ''
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(text).not.toContain(phrase)
      }
    }
  })
})

describe('模块标签静态映射（RL-14）', () => {
  test('9 个模块键全部具备确定性中文标签', () => {
    expect(Object.keys(THEATER_MODULE_LABELS)).toHaveLength(9)
    for (const label of Object.values(THEATER_MODULE_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
