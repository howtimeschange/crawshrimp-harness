import { existsSync, readFileSync } from 'node:fs'

function normalizePath(value) {
  const text = String(value || '').trim()
  return text || ''
}

function normalizeSessionIds(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  if (value && typeof value === 'object') return Object.keys(value).map((item) => String(item || '').trim()).filter(Boolean)
  return []
}

function workspaceRecords(workspaces) {
  if (Array.isArray(workspaces)) return workspaces
  if (workspaces && typeof workspaces === 'object') return Object.values(workspaces)
  return []
}

export function findWorkspaceCwdForSession(sessionId, workspaceState) {
  const target = String(sessionId || '').trim()
  if (!target || !workspaceState || typeof workspaceState !== 'object') return ''
  const workspaces = workspaceRecords(workspaceState?.tables?.workspaces)
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace !== 'object') continue
    if (!normalizeSessionIds(workspace.sessionIds).includes(target)) continue
    return normalizePath(workspace.path)
  }
  return ''
}

export function readWorkspaceState(dshHome) {
  const root = normalizePath(dshHome)
  if (!root) return null
  const path = `${root}/storages/workspace.json`
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function resolveRunSessionCwd({ sessionId, explicitCwd, dshHome, dataRoot }) {
  const explicit = normalizePath(explicitCwd)
  if (explicit) return explicit
  const existing = findWorkspaceCwdForSession(sessionId, readWorkspaceState(dshHome))
  if (existing) return existing
  const root = normalizePath(dataRoot)
  return root ? `${root}/agent/workspace` : ''
}
