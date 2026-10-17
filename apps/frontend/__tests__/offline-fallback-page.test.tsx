import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import OfflineFallbackPage from '@/app/offline/page'

/**
 * 离线 Fallback 页面测试（v2-5-pwa-static-offline-fallback / 2.2）。
 *
 * 验证：
 * - 离线页面渲染静态只读内容
 * - 不包含创建/更新/应用/同步/上传控件
 * - 无后端 API 调用
 * - 可访问性：标题、说明、重试连接
 */
describe('OfflineFallbackPage', () => {
  test('渲染离线提示标题', () => {
    render(<OfflineFallbackPage />)
    expect(screen.getByText('当前处于离线状态')).toBeInTheDocument()
  })

  test('渲染离线说明文字', () => {
    render(<OfflineFallbackPage />)
    expect(screen.getByText(/网络连接已断开/)).toBeInTheDocument()
  })

  test('渲染重试连接按钮', () => {
    render(<OfflineFallbackPage />)
    const link = screen.getByText('重试连接')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/dashboard')
  })

  test('渲染离线模式标识', () => {
    render(<OfflineFallbackPage />)
    expect(screen.getByText('开项 OpenXiang — 离线模式')).toBeInTheDocument()
  })

  test('不包含任何可编辑业务控件', () => {
    // 无创建/更新/应用/同步/上传相关文本
    render(<OfflineFallbackPage />)
    const forbiddenPatterns = [
      '创建',
      '编辑',
      '保存',
      '提交',
      '删除',
      '应用',
      '同步',
      '上传',
      '新建任务',
      '新建项目',
    ]
    for (const pattern of forbiddenPatterns) {
      expect(screen.queryByText(pattern)).toBeNull()
    }
  })

  test('不包含表单控件', () => {
    render(<OfflineFallbackPage />)
    // 离线页面不应包含 input/textarea/select/button[type=submit]
    expect(document.querySelector('input')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('select')).toBeNull()
    const submitButtons = document.querySelectorAll('button[type="submit"]')
    expect(submitButtons.length).toBe(0)
  })

  test('不调用后端 API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<OfflineFallbackPage />)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  test('渲染离线图标', () => {
    render(<OfflineFallbackPage />)
    const svg = document.querySelector('svg.lucide-wifi-off')
    expect(svg).toBeInTheDocument()
  })
})
