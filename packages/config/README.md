# @aiproj/config

开项 Kaiplan 的共享工程配置，供所有 app / package 复用，保证全仓规范一致。

## 导出

| 子路径                              | 内容                                            |
| ----------------------------------- | ----------------------------------------------- |
| `@aiproj/config/tsconfig.base.json` | TypeScript strict 基础配置（各包 `extends` 它） |
| `@aiproj/config/eslint`             | ESLint 扁平配置（flat config）数组              |
| `@aiproj/config/prettier`           | Prettier 预设                                   |

## 用法

**tsconfig.json**

```json
{ "extends": "@aiproj/config/tsconfig.base.json" }
```

**eslint.config.mjs**

```js
export { default } from '@aiproj/config/eslint'
```

**prettier.config.mjs**

```js
export { default } from '@aiproj/config/prettier'
```
