import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === 'vendor' ? [] : files(join(directory, entry.name))) : [join(directory, entry.name)])
}

test('first-party modules have no circular or upward page dependencies', () => {
  const sources = files(root).filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith('.test.ts'))
  const graph = new Map<string, string[]>()
  for (const file of sources) {
    const imports = [...readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])
    const dependencies = imports.filter(path => path.startsWith('.')).flatMap(path => {
      const target = resolve(dirname(file), path)
      const resolved = [target, target + '.ts', target + '.tsx', join(target, 'index.ts')].find(existsSync)
      return resolved ? [resolved] : []
    })
    const local = relative(root, file).replaceAll('\\', '/')
    if (local.startsWith('lib/')) for (const dependency of dependencies) {
      assert.ok(!/^(scripts|pages|components|layouts)\//.test(relative(root, dependency).replaceAll('\\', '/')), `${local} depends on page composition`)
    }
    if (local.startsWith('lib/ui/')) for (const dependency of dependencies) {
      assert.ok(relative(root, dependency).replaceAll('\\', '/').startsWith('lib/ui/'), 'UI primitive depends on an editor feature')
    }
    graph.set(file, dependencies)
  }
  const complete = new Set<string>()
  function visit(file: string, path: string[]): void {
    assert.ok(!path.includes(file), `Circular dependency: ${[...path, file].map(file => relative(root, file)).join(' -> ')}`)
    if (complete.has(file)) return
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...path, file])
    complete.add(file)
  }
  sources.forEach(file => visit(file, []))
})

test('first-party UI colors are defined in tokens, not component styles', () => {
  for (const file of files(root).filter(file => /\.(css|scss)$/.test(file) && !file.endsWith('tokens.css'))) {
    const css = readFileSync(file, 'utf8')
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/i, relative(root, file))
  }
})
