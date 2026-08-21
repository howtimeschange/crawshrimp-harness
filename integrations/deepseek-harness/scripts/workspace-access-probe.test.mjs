import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WorkspaceRegistry } from '../node_modules/@deepseek-ai/dsh-workspace/lib/index.js'

function probeOnlyRegistry() {
  const registry = Object.create(WorkspaceRegistry.prototype)
  registry.enqueueOperation = async () => 'probe-complete'
  return registry
}

test('patched workspace create performs a real atomic write probe and leaves no residue', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'crawshrimp-workspace-probe-'))
  const old = new Date(1_000)
  try {
    await utimes(workspace, old, old)
    const before = await stat(workspace)

    const result = await probeOnlyRegistry().create(workspace, 'Probe')

    const after = await stat(workspace)
    assert.equal(result, 'probe-complete')
    assert.ok(after.mtimeMs > before.mtimeMs, 'the create path must mutate the directory during its write probe')
    assert.deepEqual(await readdir(workspace), [])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('patched workspace create rejects a directory that exists but is not writable', async (t) => {
  if (process.platform === 'win32') {
    t.skip('chmod does not model a Windows DACL; Windows behavior is covered by the real write probe above')
    return
  }
  const workspace = await mkdtemp(join(tmpdir(), 'crawshrimp-workspace-readonly-'))
  try {
    await chmod(workspace, 0o500)
    await assert.rejects(
      probeOnlyRegistry().create(workspace, 'Read only'),
      (error) => ['EACCES', 'EPERM'].includes(error?.code),
    )
    assert.deepEqual(await readdir(workspace), [])
  } finally {
    await chmod(workspace, 0o700)
    await rm(workspace, { recursive: true, force: true })
  }
})
