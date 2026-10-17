import { test } from '@japa/runner'
import {
  escapeLikeWildcards,
  buildLikePattern,
  extractSearchTokens,
  fieldMatchesKeyword,
  getFieldMatchScore,
  filterAllowedFields,
} from '#services/search/search_matching'

test.group('search matching - escapeLikeWildcards', () => {
  test('escapes % character', ({ assert }) => {
    assert.equal(escapeLikeWildcards('100%'), '100\\%')
  })

  test('escapes _ character', ({ assert }) => {
    assert.equal(escapeLikeWildcards('test_1'), 'test\\_1')
  })

  test('escapes both % and _', ({ assert }) => {
    assert.equal(escapeLikeWildcards('100%_complete'), '100\\%\\_complete')
  })

  test('escapes backslash first', ({ assert }) => {
    assert.equal(escapeLikeWildcards('\\'), '\\\\')
  })

  test('passes through normal text', ({ assert }) => {
    assert.equal(escapeLikeWildcards('hello world'), 'hello world')
  })
})

test.group('search matching - buildLikePattern', () => {
  test('wraps keyword in %%', ({ assert }) => {
    assert.equal(buildLikePattern('test'), '%test%')
  })

  test('escapes wildcards in pattern', ({ assert }) => {
    assert.equal(buildLikePattern('100%'), '%100\\%%')
  })
})

test.group('search matching - extractSearchTokens', () => {
  test('extracts English words', ({ assert }) => {
    const tokens = extractSearchTokens('hello world')
    assert.equal(tokens.length, 2)
    assert.include(tokens, 'hello')
    assert.include(tokens, 'world')
  })

  test('extracts Chinese characters', ({ assert }) => {
    const tokens = extractSearchTokens('项目管理')
    assert.include(tokens, '项')
    assert.include(tokens, '目')
    assert.include(tokens, '管')
    assert.include(tokens, '理')
  })

  test('returns empty for empty string', ({ assert }) => {
    assert.equal(extractSearchTokens('').length, 0)
  })

  test('deduplicates tokens', ({ assert }) => {
    const tokens = extractSearchTokens('test test')
    assert.equal(tokens.length, 1)
  })
})

test.group('search matching - fieldMatchesKeyword', () => {
  test('matches case insensitive', ({ assert }) => {
    assert.isTrue(fieldMatchesKeyword('Hello World', 'hello'))
  })

  test('returns false for null value', ({ assert }) => {
    assert.isFalse(fieldMatchesKeyword(null, 'test'))
  })

  test('returns false for empty keyword', ({ assert }) => {
    assert.isFalse(fieldMatchesKeyword('test', ''))
  })
})

test.group('search matching - getFieldMatchScore', () => {
  test('exact match returns 1.0', ({ assert }) => {
    assert.equal(getFieldMatchScore('hello', 'hello'), 1.0)
  })

  test('prefix match returns 0.8', ({ assert }) => {
    assert.equal(getFieldMatchScore('hello world', 'hello'), 0.8)
  })

  test('substring match returns 0.5', ({ assert }) => {
    assert.equal(getFieldMatchScore('my hello world', 'hello'), 0.5)
  })

  test('no match returns 0', ({ assert }) => {
    assert.equal(getFieldMatchScore('hello', 'xyz'), 0)
  })
})

test.group('search matching - filterAllowedFields', () => {
  test('filters to only allowed fields', ({ assert }) => {
    const result = filterAllowedFields(['name', 'description', 'secret'], ['name', 'description'])
    assert.deepEqual(result, ['name', 'description'])
  })

  test('returns empty for no overlap', ({ assert }) => {
    const result = filterAllowedFields(['secret'], ['name'])
    assert.deepEqual(result, [])
  })
})
