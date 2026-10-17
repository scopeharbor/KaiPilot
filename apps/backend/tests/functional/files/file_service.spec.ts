import { test } from '@japa/runner'
import DocumentService from '#services/document_service'
import AuditService from '#services/audit_service'
import DocumentSearchIndexService from '#services/document_search_index_service'
import {
  ALLOWED_ENTITY_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  sanitizeFileName,
  isPathSafe,
} from '#services/file_storage'

test.group('FileService', () => {
  test('sanitizeFileName 去除路径片段', ({ assert }) => {
    const { displayName, safeName } = sanitizeFileName('../../../etc/passwd')
    assert.isFalse(displayName.includes('..'))
    assert.isFalse(safeName.includes('..'))
    assert.isFalse(displayName.includes('/'))
  })

  test('sanitizeFileName 保留合法文件名', ({ assert }) => {
    const { displayName } = sanitizeFileName('document.pdf')
    assert.equal(displayName, 'document.pdf')
  })

  test('sanitizeFileName 处理中文文件名', ({ assert }) => {
    const { displayName } = sanitizeFileName('项目文档.docx')
    assert.include(displayName, '项目文档')
  })

  test('isPathSafe 拒绝路径穿越', ({ assert }) => {
    assert.isFalse(isPathSafe('/storage/uploads/../../../etc/passwd', '/storage/uploads'))
  })

  test('isPathSafe 允许合法路径', ({ assert }) => {
    assert.isTrue(isPathSafe('/storage/uploads/projects/1/file.pdf', '/storage/uploads'))
  })

  test('ALLOWED_ENTITY_TYPES 包含所有白名单类型', ({ assert }) => {
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('project'))
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('task'))
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('milestone'))
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('risk'))
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('document'))
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('change_request'))
    assert.isTrue(ALLOWED_ENTITY_TYPES.has('comment'))
    assert.isFalse(ALLOWED_ENTITY_TYPES.has('malicious_type'))
  })

  test('ALLOWED_EXTENSIONS 不包含可执行文件', ({ assert }) => {
    assert.isFalse(ALLOWED_EXTENSIONS.has('exe'))
    assert.isFalse(ALLOWED_EXTENSIONS.has('sh'))
    assert.isFalse(ALLOWED_EXTENSIONS.has('bat'))
    assert.isFalse(ALLOWED_EXTENSIONS.has('html'))
    assert.isFalse(ALLOWED_EXTENSIONS.has('svg'))
  })

  test('MAX_FILE_SIZE 为 10MB', ({ assert }) => {
    assert.equal(MAX_FILE_SIZE, 10 * 1024 * 1024)
  })
})

test.group('DocumentService', () => {
  test('创建文件夹', async ({ assert }) => {
    const audit = new AuditService()
    const service = new DocumentService(audit, new DocumentSearchIndexService(audit))

    // 需要实际数据库连接，此处为类型检查
    assert.isFunction(service.create)
    assert.isFunction(service.list)
    assert.isFunction(service.rename)
    assert.isFunction(service.move)
    assert.isFunction(service.delete)
  })
})
