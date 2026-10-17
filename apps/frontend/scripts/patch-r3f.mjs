import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(
  __dirname,
  '../node_modules/@react-three/fiber/dist/declarations/src/three-types.d.ts',
)

if (fs.existsSync(target)) {
  const content = fs.readFileSync(target, 'utf8')
  const needle =
    '[K in keyof T & string as Uncapitalize<K>]: T[K] extends ConstructorRepresentation ? ThreeElement<T[K]> : never;'
  const replacement =
    '[K in keyof T & string as T[K] extends ConstructorRepresentation ? Uncapitalize<K> : never]: ThreeElement<T[K]>;'
  if (content.includes(needle)) {
    fs.writeFileSync(target, content.replace(needle, replacement), 'utf8')
  }
}
