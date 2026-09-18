import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? (entry.name === 'vendor' ? [] : files(join(directory, entry.name))) : [join(directory, entry.name)])
}

function imports(source: string, astro = false): string[] {
  const scripts = astro
    ? [source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '',
      ...[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1])]
    : [source]
  return scripts.flatMap(script => ts.preProcessFile(script, true, true).importedFiles.map(item => item.fileName))
}

function checkDependencies(graph: Map<string, string[]>): void {
  for (const [local, dependencies] of graph) {
    if (local.startsWith('lib/')) for (const dependency of dependencies) {
      assert.ok(!/^(scripts|pages|components|layouts)\//.test(dependency), `${local} depends on page composition: ${dependency}`)
    }
    if (local.startsWith('lib/ui/')) for (const dependency of dependencies) {
      assert.ok(dependency.startsWith('lib/ui/'), 'UI primitive depends on an editor feature')
    }
  }
  const complete = new Set<string>()
  function visit(file: string, path: string[]): void {
    assert.ok(!path.includes(file), `Circular dependency: ${[...path, file].join(' -> ')}`)
    if (complete.has(file)) return
    for (const dependency of graph.get(file) ?? []) visit(dependency, [...path, file])
    complete.add(file)
  }
  graph.forEach((_, file) => visit(file, []))
}

function checkColors(css: string, label: string): void {
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/i, label)
  assert.doesNotMatch(css, /var\(\s*--palette-/i, `${label}: use semantic tokens`)
}

test('first-party modules have no circular or upward page dependencies', () => {
  const sources = files(root).filter(file => /\.(ts|tsx|astro)$/.test(file) && !file.endsWith('.test.ts'))
  const local = (file: string): string => relative(root, file).replaceAll('\\', '/')
  const graph = new Map<string, string[]>()
  for (const file of sources) {
    const dependencies = imports(readFileSync(file, 'utf8'), file.endsWith('.astro'))
      .filter(path => path.startsWith('.')).flatMap(path => {
        const target = resolve(dirname(file), path)
        const resolved = [target, ...['.ts', '.tsx', '.astro', '/index.ts', '/index.tsx', '/index.astro'].map(extension => target + extension)].find(existsSync)
        assert.ok(resolved, `Unresolved local dependency: ${local(file)} -> ${path}`)
        return [local(resolved)]
      })
    graph.set(local(file), dependencies)
  }
  checkDependencies(graph)
})

test('dependency scanner includes bare imports, re-exports, dynamic imports and Astro scripts', () => {
  assert.deepEqual(imports(`// import './ignored'\nimport './side-effect'; export { x } from './other'; import('./lazy')`), ['./side-effect', './other', './lazy'])
  assert.deepEqual(imports(`---\nimport Card from './Card.astro'\n---\n<Card /><script>import './client'</script>`, true), ['./Card.astro', './client'])
  assert.throws(() => checkDependencies(new Map([['lib/editor/foo.ts', ['components/editor/Foo.astro']]])), /page composition/)
  assert.throws(() => checkDependencies(new Map([['components/A.astro', ['components/B.astro']], ['components/B.astro', ['components/A.astro']]])), /Circular dependency/)
})

test('first-party UI colors are defined in tokens, not component styles', () => {
  for (const file of files(root).filter(file => /\.(css|scss|astro)$/.test(file) && !file.endsWith('tokens.css'))) {
    const source = readFileSync(file, 'utf8')
    const css = file.endsWith('.astro')
      ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')
      : source
    checkColors(css, relative(root, file))
    if (file.endsWith('.astro')) assert.doesNotMatch(source, /var\(\s*--palette-/i, relative(root, file))
  }
})

test('color guard rejects raw colors and palette bypasses while accepting semantic colors', () => {
  for (const css of ['color: #fff', 'color: rgb(0, 0, 0)', 'color: var(--palette-purple-500)']) {
    assert.throws(() => checkColors(css, 'fixture'))
  }
  assert.doesNotThrow(() => checkColors('color: var(--text-primary)', 'fixture'))
})
