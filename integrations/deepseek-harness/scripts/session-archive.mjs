import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MARKER = 'crawshrimp-session-archive-v1'
function replace(source, anchor, value) {
  if (source.split(anchor).length !== 2) throw new Error('Session archive patch anchor changed: ' + anchor)
  return source.replace(anchor, value)
}
export function patchArchiveSource(source, kind) {
  if (source.includes(MARKER)) {
    if (kind === 'ui') {
      // Remove the v1 settings section from already-patched development runtimes.
      source = source.replace(/function CrawshrimpArchivedSessions\([\s\S]*?\nfunction apply\(ctx\) \{/, 'function apply(ctx) {')
      source = source.replace(/ctx\.slots\.inject\("settings\.section", \(\) => ctx\.slots\.register\(\{\n      name: "settings\.section", id: "archived-sessions",[\s\S]*?\}, CrawshrimpArchivedSessions\)\);\n    /, '')
      source = source.replace('你可以在设置中的「已归档会话」找回。', '你可以在抓虾设置 → 存储 → 已归档会话中找回。')
    }
    return source
  }
  if (kind === 'registry') {
    source = replace(source, 'archiveSession(sessionId) {', 'archiveSession(sessionId, archived = true) {')
    source = replace(source, 'if (this.requireState().archivedSessionIds.includes(sessionId)) return;', 'if (this.requireState().archivedSessionIds.includes(sessionId) === archived) return;')
    source = replace(source, 'archivedSessionIds: [...state.archivedSessionIds, sessionId]', 'archivedSessionIds: archived ? [...state.archivedSessionIds, sessionId] : state.archivedSessionIds.filter(id => id !== sessionId)')
  } else if (kind === 'schema') {
    const anchor = "workspace_archiveSession_parameter_0$schema = z.object({"
    source = replace(source, anchor, anchor + "\n  'archived': z.boolean().optional(),")
  } else if (kind === 'browser-schema') {
    source = replace(source,
      'workspace_archiveSession_parameter_0$schema = object({ "sessionId": intersection(string(), unknown()).readonly() });',
      'workspace_archiveSession_parameter_0$schema = object({ "sessionId": intersection(string(), unknown()).readonly(), "archived": boolean().optional() });')
  } else if (kind === 'controller') {
    source = replace(source, 'this.ctx.workspaceRegistry.archiveSession(request.sessionId)', 'this.ctx.workspaceRegistry.archiveSession(request.sessionId, request.archived ?? true)')
  } else if (kind === 'client') {
    if (source.split('async archiveSession(sessionId) {').length !== 3) throw new Error('Archive client signatures changed')
    source = source.replaceAll('async archiveSession(sessionId) {', 'async archiveSession(sessionId, archived = true) {')
    source = replace(source, 'this.remote.archiveSession({ sessionId })', 'this.remote.archiveSession({ sessionId, archived })')
    source = replace(source, 'this.model.archiveSession(sessionId)', 'this.model.archiveSession(sessionId, archived)')
  } else if (kind === 'ui') {
    const start = source.indexOf('const onSessionArchive = (sessionId) => {')
    const end = source.indexOf('const [deleteTarget, setDeleteTarget]', start)
    if (start < 0 || end < 0) throw new Error('Archive UI handler changed')
    source = source.slice(0, start) + `const [archiveTarget, setArchiveTarget] = react.useState(null);
      const [archiving, setArchiving] = react.useState(false);
      const archiveLock = react.useRef(false);
      const [archiveError, setArchiveError] = react.useState(null);
      const onSessionArchive = (sessionId) => { setArchiveError(null); setArchiveTarget(sessionId); };
      const closeArchive = () => { if (!archiveLock.current) setArchiveTarget(null); };
      const confirmArchive = async () => {
        if (!archiveTarget || archiveLock.current) return;
        archiveLock.current = true; setArchiving(true); setArchiveError(null);
        try { await archiveSession(archiveTarget); setArchiveTarget(null); }
        catch (error) { setArchiveError(String(error.message || error)); }
        finally { archiveLock.current = false; setArchiving(false); }
      };
      ` + source.slice(end)
    const modalAnchor = '(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {\n\t\t\t\t\t\topen: renameTarget !== null,'
    source = replace(source, modalAnchor, `react_jsx_runtime.jsxs(_deepseek_ai_dsh_client_ui_primitives.Modal, {
      open: archiveTarget !== null, onClose: closeArchive, closeLabel: "取消", title: "归档会话？",
      footer: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [
        react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", disabled: archiving, onClick: closeArchive, children: "取消" }),
        react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", disabled: archiving, onClick: confirmArchive, children: archiving ? "归档中…" : "确认归档" })
      ] }), children: [react_jsx_runtime.jsx("p", { children: "归档后，会话将从侧边栏隐藏，聊天记录会保留。你可以在抓虾设置 → 存储 → 已归档会话中找回。" }), archiveError && react_jsx_runtime.jsx("p", { role: "alert", children: archiveError })]
    }),\n` + modalAnchor)
  } else throw new Error('Unknown archive patch kind: ' + kind)
  return '/* ' + MARKER + ' */\n' + source
}

export function patchSessionArchive(root) {
  const files = [
    ['dsh-workspace/lib/index.js', 'registry'],
    ['dsh-api-workspace-controller/lib/index.js', 'controller'],
    ['dsh-api-workspace-controller/lib/typert.host.js', 'schema'],
    ['dsh-api-workspace-controller/lib/typert.remote-client.js', 'schema'],
    ['dsh-api-workspace-controller/lib/client.js', 'client'],
    ['dsh-api-remotes/lib/client.js', 'browser-schema'],
    ['dsh-client-ui-workspace/lib/client.js', 'ui'],
  ]
  const edits = files.map(([path, kind]) => {
    const file = join(root, 'node_modules/@deepseek-ai', path)
    return [file, patchArchiveSource(readFileSync(file, 'utf8'), kind)]
  })
  for (const [file, source] of edits) writeFileSync(file, source)
}
