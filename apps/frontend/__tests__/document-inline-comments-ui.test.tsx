/**
 * 文档内联批注 UI 组件测试（v3-document-inline-comments §7.8）。
 */
import { describe, it } from 'vitest'

describe('DocumentInlineCommentsReview', () => {
  it('渲染文档内容和现有高亮')
  it('选中文本后显示创建工具栏')
  it('点击创建按钮提交内联批注')
  it('点击高亮打开侧面板')
  it('侧面板显示回复列表')
  it('resolve 按钮可用并触发')
  it('reopen 按钮可用并触发')
  it('删除按钮可用并触发确认')
  it('stale anchor 显示警告标识')
  it('重锚按钮触发 reanchor flow')
  it('只读用户无法创建/回复/resolve')
  it('只读用户仍可查看高亮和线程')
  it('移动端使用抽屉而非侧面板')
  it('键盘导航在锚点间切换')
  it('无锚点时显示空状态')
})

describe('DocumentSelectionToolbar', () => {
  it('选中文本时显示浮动工具栏')
  it('无选中文本时不显示')
  it('点击创建调用 onSelect 回调')
})

describe('InlineHighlightLayer', () => {
  it('渲染 fresh/stale/active/resolved 高亮')
  it('stale 高亮有特殊样式')
})

describe('StaleAnchorWarning', () => {
  it('显示保存的引文和当前不匹配原因')
  it('提供重锚操作入口')
  it('不暗示系统自动移动锚点')
})
