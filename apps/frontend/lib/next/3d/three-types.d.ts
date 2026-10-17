/**
 * Three.js / React Three Fiber JSX 类型与兼容垫片
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 8 & Decision 9
 * 补全 @react-three/fiber 对 react/jsx-runtime 与 react/jsx-dev-runtime 模块扩充时缺失的 JSX 命名空间导出，
 * 并将 React.JSX 的完整契约（LibraryManagedAttributes、IntrinsicElements 等）镜像回 jsx-runtime，
 * 避免通用 React.ElementType 与组件 props 坍缩。
 */

import * as React from 'react'

declare module '@react-three/fiber' {
  interface ReactProps<_P> {
    className?: string
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    type ElementType = React.JSX.ElementType
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    type ElementType = React.JSX.ElementType
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}
