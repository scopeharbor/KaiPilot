/**
 * diagram-spec-fixtures.test —— DiagramSpec 测试夹具单元测试（§4.2 P1）。
 */
import { describe, expect, it } from 'vitest'
import {
  CURRENT_WBS_TREE_SPEC,
  CURRENT_GANTT_SPEC,
  CURRENT_DEPENDENCY_GRAPH_SPEC,
  CURRENT_CRITICAL_PATH_SPEC,
  OLD_WBS_TREE_SPEC,
  UNKNOWN_FIELD_WBS_TREE_SPEC,
  UNSUPPORTED_MAJOR_WBS_SPEC,
  ALL_DIAGRAM_CURRENT_FIXTURES,
  DIAGRAM_FIXTURE_CURRENT_VERSION,
} from './diagram-spec-fixtures.js'

describe('current version fixtures', () => {
  it('all current fixtures have version "1.0"', () => {
    for (const spec of ALL_DIAGRAM_CURRENT_FIXTURES) {
      expect(spec.version).toBe(DIAGRAM_FIXTURE_CURRENT_VERSION)
    }
  })

  it('current fixtures have valid types', () => {
    const types = ALL_DIAGRAM_CURRENT_FIXTURES.map((s) => s.type)
    expect(types).toContain('wbs_tree')
    expect(types).toContain('gantt')
    expect(types).toContain('dependency_graph')
    expect(types).toContain('critical_path')
  })

  it('each current fixture has required fields', () => {
    for (const spec of ALL_DIAGRAM_CURRENT_FIXTURES) {
      expect(spec.title).toBeTruthy()
      expect(spec.data).toBeTruthy()
      expect(spec.metadata).toBeTruthy()
      expect(spec.exports).toBeTruthy()
    }
  })
})

describe('old version fixture', () => {
  it('has version 0.9', () => {
    expect(OLD_WBS_TREE_SPEC.version).toBe('0.9')
  })

  it('lacks exports field (old format)', () => {
    expect(OLD_WBS_TREE_SPEC.exports).toBeUndefined()
  })
})

describe('unknown field fixture', () => {
  it('has extra fields that should be safely ignored', () => {
    expect(UNKNOWN_FIELD_WBS_TREE_SPEC.customTheme).toBe('dark')
    expect(UNKNOWN_FIELD_WBS_TREE_SPEC.tags).toEqual(['v1', 'test'])
  })
})

describe('unsupported major fixture', () => {
  it('has version 2.0 (future major)', () => {
    expect(UNSUPPORTED_MAJOR_WBS_SPEC.version).toBe('2.0')
  })
})
