import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import NextTasksAssimilationPage from '@/app/(next)/next/tasks/page'
import NextRecommendationsAssimilationPage from '@/app/(next)/next/recommendations/page'
import NextOkrAlignmentAssimilationPage from '@/app/(next)/next/okr-alignment/page'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}))

describe('W4 路由同化页面测试 (/next/tasks, /next/recommendations, /next/okr-alignment)', () => {
  beforeEach(() => {
    replaceMock.mockClear()
  })

  test('1. /next/tasks 访问时自动调用 router.replace 并携带 focus=tasks-hud', () => {
    render(<NextTasksAssimilationPage />)

    expect(replaceMock).toHaveBeenCalledWith('/next?focus=tasks-hud')
    expect(screen.getByText('正在唤起跨项目任务 HUD 镜头…')).toBeInTheDocument()
  })

  test('2. /next/recommendations 访问时自动平滑重定向至角色首页建议卡槽', () => {
    render(<NextRecommendationsAssimilationPage />)

    expect(replaceMock).toHaveBeenCalledWith('/next')
    expect(screen.getByText('正在导航至建议卡槽…')).toBeInTheDocument()
  })

  test('3. /next/okr-alignment 访问时永久重定向至新轨组织级 OKR 工作台', () => {
    render(<NextOkrAlignmentAssimilationPage />)

    expect(replaceMock).toHaveBeenCalledWith('/next/organization/okrs')
    expect(screen.getByText('正在重定向至组织级 OKR 工作台…')).toBeInTheDocument()
  })
})
