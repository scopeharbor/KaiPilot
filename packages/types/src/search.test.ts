import { describe, expect, test } from 'vitest'
import {
  SEARCH_ENTITY_TYPES,
  SEARCH_SORT_FIELDS,
  SEARCH_SORT_DIRECTIONS,
  SEARCH_SCOPES,
  SEARCH_MAX_PER_PAGE,
  SEARCH_KEYWORD_MIN_LENGTH,
  SEARCH_KEYWORD_MAX_LENGTH,
  getEntityTypeLabel,
  getEntityTypePriority,
  isValidEntityType,
  isValidSortField,
} from './search.js'

describe('V2 advanced search types', () => {
  test('SEARCH_ENTITY_TYPES covers all expected entity types', () => {
    expect(SEARCH_ENTITY_TYPES).toEqual([
      'project',
      'task',
      'file',
      'risk',
      'change_request',
      'report',
      'comment',
      'activity',
      'milestone',
      'document',
    ])
  })

  test('SEARCH_SORT_FIELDS covers expected sort fields', () => {
    expect(SEARCH_SORT_FIELDS).toContain('updated_at')
    expect(SEARCH_SORT_FIELDS).toContain('created_at')
    expect(SEARCH_SORT_FIELDS).toContain('name')
    expect(SEARCH_SORT_FIELDS).toContain('status')
  })

  test('SEARCH_SORT_DIRECTIONS has asc and desc', () => {
    expect(SEARCH_SORT_DIRECTIONS).toEqual(['asc', 'desc'])
  })

  test('SEARCH_SCOPES has organization and project', () => {
    expect(SEARCH_SCOPES).toEqual(['organization', 'project'])
  })

  test('SEARCH_MAX_PER_PAGE is 50', () => {
    expect(SEARCH_MAX_PER_PAGE).toBe(50)
  })

  test('SEARCH_KEYWORD_MIN_LENGTH is 1', () => {
    expect(SEARCH_KEYWORD_MIN_LENGTH).toBe(1)
  })

  test('SEARCH_KEYWORD_MAX_LENGTH is 200', () => {
    expect(SEARCH_KEYWORD_MAX_LENGTH).toBe(200)
  })

  test('isValidEntityType returns true for valid types', () => {
    expect(isValidEntityType('project')).toBe(true)
    expect(isValidEntityType('task')).toBe(true)
    expect(isValidEntityType('file')).toBe(true)
  })

  test('isValidEntityType returns false for invalid types', () => {
    expect(isValidEntityType('user')).toBe(false)
    expect(isValidEntityType('')).toBe(false)
    expect(isValidEntityType('invalid')).toBe(false)
  })

  test('isValidSortField returns true for valid fields', () => {
    expect(isValidSortField('updated_at')).toBe(true)
    expect(isValidSortField('name')).toBe(true)
  })

  test('isValidSortField returns false for invalid fields', () => {
    expect(isValidSortField('invalid')).toBe(false)
    expect(isValidSortField('')).toBe(false)
  })

  test('getEntityTypeLabel returns Chinese labels', () => {
    expect(getEntityTypeLabel('project')).toBe('项目')
    expect(getEntityTypeLabel('task')).toBe('任务')
    expect(getEntityTypeLabel('file')).toBe('文件')
    expect(getEntityTypeLabel('risk')).toBe('风险')
    expect(getEntityTypeLabel('change_request')).toBe('变更请求')
  })

  test('getEntityTypePriority assigns project highest priority (lowest number)', () => {
    expect(getEntityTypePriority('project')).toBe(1)
    expect(getEntityTypePriority('task')).toBe(2)
    expect(getEntityTypePriority('milestone')).toBe(3)
    expect(getEntityTypePriority('activity')).toBe(10)
  })
})
