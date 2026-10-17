// TypeScript 7（原生 tsc）的 `typescript` 包只导出版本号，不再提供经典 JS 编译器 API。
// 各工作区的 `tsc` 用 7.x；下列仍 `require('typescript')` 取 API 的工具改为依赖官方
// 过渡包 @typescript/typescript6（与 TS 7 同语义）。pnpm 的 overrides 不作用于 peer，
// 所以在这里把 peer 改写成别名依赖。typescript-eslint 正式支持 TS 7 后删除本文件。
const TS6 = 'npm:@typescript/typescript6@6.0.2'

function needsTs6Api(name) {
  return (
    name === 'typescript-eslint' ||
    name === 'ts-api-utils' ||
    name.startsWith('@typescript-eslint/')
  )
}

function readPackage(pkg) {
  if (needsTs6Api(pkg.name) && (pkg.peerDependencies?.typescript || pkg.dependencies?.typescript)) {
    if (pkg.peerDependencies) delete pkg.peerDependencies.typescript
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript
    pkg.dependencies = { ...pkg.dependencies, typescript: TS6 }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
