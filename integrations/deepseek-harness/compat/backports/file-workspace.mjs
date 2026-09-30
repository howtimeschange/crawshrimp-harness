export const FILE_WORKSPACE_MARKER = 'crawshrimp-file-workspace-v1'
export const FILE_WORKSPACE_ANCHOR = 'const result = await ctx.remote.session.openWorkspacePath({ path: resolveWorkspacePath(cwd, path) });'
export function fileWorkspace(source) {
  if (source.includes(FILE_WORKSPACE_MARKER)) {
    if (!source.includes('window.__crawshrimpOpenResource(resolveWorkspacePath(cwd, path), sessionId);') || !source.includes(FILE_WORKSPACE_ANCHOR)) throw new Error('C03: incomplete file workspace patch')
    return source
  }
  if (source.split(FILE_WORKSPACE_ANCHOR).length !== 2) throw new Error('C03: native file opener anchor is not unique')
  return source.replace(FILE_WORKSPACE_ANCHOR, `/* ${FILE_WORKSPACE_MARKER} */
                if (path !== "." && typeof window.__crawshrimpOpenResource === "function") {
                  window.__crawshrimpOpenResource(resolveWorkspacePath(cwd, path), sessionId);
                  return;
                }
                ${FILE_WORKSPACE_ANCHOR}`)
}
