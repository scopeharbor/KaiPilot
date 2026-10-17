const assert = require('node:assert/strict')
const { test } = require('node:test')

const pnpmfile = require('../.pnpmfile.cjs')

const TS6_ALIAS = 'npm:@typescript/typescript6@6.0.2'

function applyReadPackage(pkg) {
  return pnpmfile.hooks.readPackage(structuredClone(pkg))
}

test('TypeScript API consumers are redirected to the official TS6 compatibility package', () => {
  for (const name of ['typescript-eslint', 'ts-api-utils', '@typescript-eslint/parser']) {
    const result = applyReadPackage({
      name,
      peerDependencies: { typescript: '>=5', eslint: '^9 || ^10' },
      peerDependenciesMeta: { typescript: { optional: true } },
    })

    assert.equal(result.dependencies.typescript, TS6_ALIAS)
    assert.equal(result.peerDependencies.typescript, undefined)
    assert.equal(result.peerDependencies.eslint, '^9 || ^10')
    assert.equal(result.peerDependenciesMeta.typescript, undefined)
  }
})

test('packages that do not consume the classic compiler API are unchanged', () => {
  const input = {
    name: 'unrelated-package',
    peerDependencies: { typescript: '>=5' },
    dependencies: { react: '19.0.0' },
  }

  assert.deepEqual(applyReadPackage(input), input)
})

test('target packages without a TypeScript dependency are unchanged', () => {
  const input = { name: '@typescript-eslint/utils', dependencies: { eslint: '^9' } }
  assert.deepEqual(applyReadPackage(input), input)
})
