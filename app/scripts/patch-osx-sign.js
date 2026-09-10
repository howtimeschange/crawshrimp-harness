'use strict'

const fs = require('fs')
const path = require('path')

// osx-sign 1.3.3 scans every resource before applying ignore rules. Its nested
// Promise.all opens thousands of files at once in the bundled Office runtime.
// Keep its binary detection and traversal semantics, but visit children serially.
function patchOsxSign() {
  const utilPath = path.join(path.dirname(require.resolve('@electron/osx-sign')), 'util.js')
  const source = fs.readFileSync(utilPath, 'utf8')
  const marker = '// crawshrimp: serial signing traversal'
  if (source.includes(marker)) return
  const start = source.indexOf('async function walkAsync(dirPath) {')
  const end = source.indexOf('exports.walkAsync = walkAsync;', start)
  if (start < 0 || end < 0) throw new Error('Unsupported osx-sign traversal; review concurrency patch')
  const original = source.slice(start, end)
  const opening = 'return await Promise.all(children.map(async (child) => {'
  const closing = '        }));'
  if (original.split(opening).length !== 2 || original.split(closing).length !== 2) {
    throw new Error('Unsupported osx-sign traversal; review concurrency patch')
  }
  const patched = original
    .replace(opening, `${marker}\n        const results = [];\n        for (const child of children) {\n            results.push(await (async () => {`)
    .replace(closing, '            })());\n        }\n        return results;')
  fs.writeFileSync(utilPath, source.slice(0, start) + patched + source.slice(end))
}

module.exports = { patchOsxSign }
