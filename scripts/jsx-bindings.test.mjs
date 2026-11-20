import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default
const sourceRoot = path.resolve('src')

function findUnboundComponents(source, filename) {
  const ast = parse(source, { sourceType: 'module', sourceFilename: filename, plugins: ['jsx'] })
  const missing = []

  traverse(ast, {
    JSXOpeningElement(opening) {
      let name = opening.node.name
      while (name.type === 'JSXMemberExpression') name = name.object
      if (name.type !== 'JSXIdentifier' || !/^[A-Z]/.test(name.name)) return
      if (!opening.scope.hasBinding(name.name)) {
        missing.push({ name: name.name, line: opening.node.loc.start.line })
      }
    },
  })

  return missing
}

function jsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return jsxFiles(file)
    return file.endsWith('.jsx') ? [file] : []
  })
}

test('reports JSX component names without an import or lexical binding', () => {
  const source = 'const Known = {}; function Example({ Child }) { return <><Known.Panel /><Child /><MissingCard /></> }'
  assert.deepEqual(findUnboundComponents(source, 'fixture.jsx'), [{ name: 'MissingCard', line: 1 }])
})

test('all renderer JSX components have an import or lexical binding', () => {
  const missing = jsxFiles(sourceRoot).flatMap(file =>
    findUnboundComponents(fs.readFileSync(file, 'utf8'), file).map(entry => ({
      file: path.relative(process.cwd(), file),
      ...entry,
    })),
  )
  assert.deepEqual(missing, [])
})
