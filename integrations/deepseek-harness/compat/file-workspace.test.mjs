import test from 'node:test'
import assert from 'node:assert/strict'
import { fileWorkspace, FILE_WORKSPACE_ANCHOR } from './backports/file-workspace.mjs'
test('native link callback uses resolved path and session; standalone and directory fall back', () => {
  const output = fileWorkspace(FILE_WORKSPACE_ANCHOR)
  assert.equal(fileWorkspace(output), output)
  assert.match(output, /path !== "\."/)
  assert.match(output, /resolveWorkspacePath\(cwd, path\), sessionId/)
  assert.ok(output.includes(FILE_WORKSPACE_ANCHOR))
  assert.throws(() => fileWorkspace(output.replace('window.__crawshrimpOpenResource(resolveWorkspacePath(cwd, path), sessionId);', '')), /incomplete/)
  assert.throws(() => fileWorkspace('no anchor'))
  assert.throws(() => fileWorkspace(FILE_WORKSPACE_ANCHOR.repeat(2)))
})

test('patched native opener routes files to the same panel and keeps directory/standalone fallback', async () => {
  const invoke = new Function('window', 'ctx', 'resolveWorkspacePath', 'cwd', 'path', 'sessionId', `return (async () => { ${fileWorkspace(FILE_WORKSPACE_ANCHOR)}; return result; })()`)
  const calls = [], ctx = { remote: { session: { openWorkspacePath: async value => { calls.push(['native', value.path]); return 'opened' } } } }
  const resolve = (cwd, file) => `${cwd}/${file}`
  const window = { __crawshrimpOpenResource: (file, session) => calls.push(['panel', file, session]) }
  await invoke(window, ctx, resolve, '/workspace', '中文摘要.md', 'session-a')
  assert.deepEqual(calls, [['panel', '/workspace/中文摘要.md', 'session-a']])
  assert.equal(await invoke(window, ctx, resolve, '/workspace', '.', 'session-a'), 'opened')
  assert.deepEqual(calls.at(-1), ['native', '/workspace/.'])
  assert.equal(await invoke({}, ctx, resolve, '/workspace', 'standalone.md', 'session-a'), 'opened')
  assert.deepEqual(calls.at(-1), ['native', '/workspace/standalone.md'])
})
