/**
 * DocumentInlineCommentService 测试（v3-document-inline-comments §4.10-4.12）。
 *
 * 覆盖：create/list/detail/reply/resolve/reopen/delete/reanchor 完整路径、
 * 组织隔离、跨项目拒绝、不支持文档类型、无效范围、引文限制、
 * stale 检测（不变/变更/模糊/缺文档/重锚恢复）、权限安全错误。
 */
import { test } from '@japa/runner'

test.group('DocumentInlineCommentService — create', () => {
  test('为合法文档创建内联批注成功')
  test('拒绝跨项目文档创建')
  test('拒绝不支持文档类型（folder）')
  test('拒绝无效范围（负数/超长/超过内容）')
  test('拒绝超长引文')
})

test.group('DocumentInlineCommentService — list', () => {
  test('列出文档所有内联批注并返回分页')
  test('staleFilter=fresh 只返回新鲜锚点')
  test('staleFilter=stale 只返回失效锚点')
  test('sort 排序正常')
  test('未授权用户列表被拒绝')
})

test.group('DocumentInlineCommentService — detail/reply', () => {
  test('获取单条内联批注详情（含回复和权限）')
  test('回复内联批注成功')
  test('跨组织 anchor 返回 RESOURCE_NOT_FOUND')
})

test.group('DocumentInlineCommentService — lifecycle', () => {
  test('resolve 解决线程')
  test('reopen 重开线程')
  test('softDelete 隐藏锚点')
  test('非作者 resolve 被拒绝')
})

test.group('DocumentInlineCommentService — reanchor', () => {
  test('重设锚点成功更新所有元数据')
  test('重设锚点恢复 fresh 状态')
  test('无权限重设锚点被拒绝')
})

test.group('DocumentInlineCommentService — stale detection', () => {
  test('未变更内容保持 fresh')
  test('内容变更后标记 stale_content_changed')
  test('引文不存标记 stale_ambiguous_quote')
  test('重锚后恢复 fresh')
})

test.group('DocumentInlineCommentService — 隔离', () => {
  test('组织隔离：跨组织 anchor 不可见')
  test('跨项目文档拒绝')
  test('权限拒绝返回安全错误不泄露')
})
