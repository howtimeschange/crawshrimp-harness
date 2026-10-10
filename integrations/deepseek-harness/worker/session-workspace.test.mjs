import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  findWorkspaceCwdForSession,
  resolveRunSessionCwd,
} from './session-workspace.mjs'

test('findWorkspaceCwdForSession returns the persisted cwd for an existing DSH session', () => {
  const state = {
    tables: {
      workspaces: {
        one: { path: '/tmp/other', sessionIds: ['session-other'] },
        two: { path: '/Users/example/Product Workspace', sessionIds: ['session-existing'] },
      },
    },
  }

  assert.equal(findWorkspaceCwdForSession('session-existing', state), '/Users/example/Product Workspace')
})

test('resolveRunSessionCwd preserves explicit cwd and otherwise adopts existing DSH session cwd', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'crawshrimp-session-workspace-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dshHome = join(root, 'dsh-home')
  mkdirSync(join(dshHome, 'storages'), { recursive: true })
  writeFileSync(join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
    tables: {
      workspaces: {
        product: {
          path: '/Users/example/抓虾 harness 工作区',
          sessionIds: ['session-product'],
        },
      },
    },
  }))

  assert.equal(
    resolveRunSessionCwd({ sessionId: 'session-product', dshHome, dataRoot: join(root, 'data') }),
    '/Users/example/抓虾 harness 工作区',
  )
  assert.equal(
    resolveRunSessionCwd({ sessionId: 'session-product', explicitCwd: '/tmp/explicit', dshHome, dataRoot: join(root, 'data') }),
    '/tmp/explicit',
  )
})

test('resolveRunSessionCwd falls back to agent workspace for new sessions', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'crawshrimp-session-workspace-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  assert.equal(
    resolveRunSessionCwd({ sessionId: 'session-new', dshHome: join(root, 'missing-home'), dataRoot: join(root, 'data') }),
    join(root, 'data', 'agent', 'workspace'),
  )
})
