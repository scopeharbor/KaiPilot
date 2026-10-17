/**
 * useDocumentInlineComments hooks 测试（v3-document-inline-comments §6.3）。
 */
import { describe, it } from 'vitest'

describe('useDocumentInlineComments', () => {
  it('成功获取内联批注列表')
  it('staleFilter 参数传递正确')
  it('列表为空时返回空数组')
})

describe('useDocumentInlineComment', () => {
  it('成功获取单条详情')
  it('anchor 不存在时处理错误')
})

describe('useCreateDocumentInlineComment', () => {
  it('成功创建后 invalidate 列表')
  it('权限错误时返回错误')
})

describe('useReplyDocumentInlineComment', () => {
  it('成功回复后 invalidate 详情')
})

describe('useResolveDocumentInlineComment', () => {
  it('成功 resolve 后更新状态')
})

describe('useReopenDocumentInlineComment', () => {
  it('成功 reopen 后更新状态')
})

describe('useDeleteDocumentInlineComment', () => {
  it('成功删除后 invalidate 列表')
})

describe('useReanchorDocumentInlineComment', () => {
  it('成功重锚后更新详情')
  it('stale 阻断时返回错误')
})
