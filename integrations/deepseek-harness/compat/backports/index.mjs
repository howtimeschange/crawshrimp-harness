function replaceOnce(source, before, after, id) {
  if (source.split(before).length !== 2) throw new Error(`${id}: expected exactly one anchor`)
  return source.replace(before, after)
}
export function mcpPagination(source) {
  const marker = '// crawshrimp-compat:C01'
  const guard = 'if (seenCursors.has(cursor)) throw new Error(`mcp-client(${opts.serverName}): server repeated a tools/list continuation cursor — invalid tool list`);'
  if (source.includes(marker)) {
    if (!source.includes(guard) || !source.includes('seenCursors.add(cursor);')) throw new Error('C01: incomplete patch')
    return source
  }
  source = replaceOnce(source, 'async function syncTools(client, ctx, opts, previous) {', `async function syncTools(client, ctx, opts, previous) {\n\t${marker}\n\tconst seenCursors = new Set();`, 'C01')
  return replaceOnce(source, '\t\tcursor = response.nextCursor;\n\t} while (cursor);', `\t\tcursor = response.nextCursor;\n\t\tif (cursor) {\n\t\t\t${guard}\n\t\t\tseenCursors.add(cursor);\n\t\t}\n\t} while (cursor);`, 'C01')
}
export function composerSubmit(source) {
  const marker = '// crawshrimp-compat:C02'
  const submit = 'if (!empty && !disabled && !machineBusy) keyboard.submit(primarySubmitMode);'
  if (source.includes(marker)) {
    if (!source.includes(submit) || !source.includes('resolveSubmitMode(running, "enter", subagent === null)')) throw new Error('C02: incomplete patch')
    return source
  }
  source = replaceOnce(source, 'const primaryLabel = primaryStops ? t("input.stop") : t("input.send");', `${marker}\n\t\t\tconst primarySubmitMode = resolveSubmitMode(running, "enter", subagent === null);\n\t\t\tconst plainMessageDraft = !empty && input?.phase === "plain" && !draft.trimStart().startsWith("/");\n\t\t\tconst primaryLabel = primaryStops ? t("input.stop") : running && subagent === null && !disabled && !machineBusy && plainMessageDraft ? (primarySubmitMode === "steer" ? "立即引导" : "加入队列") : t("input.send");`, 'C02')
  return replaceOnce(source, 'if (inputActions === void 0) return;\n\t\t\t\t/* v8 ignore next -- defensive: the primary button is disabled while empty||disabled, so a click cannot reach the false arm. */\n\t\t\t\tif (!empty && !disabled && !machineBusy) inputActions.submit();', `if (keyboard === void 0) return;\n\t\t\t\t${submit}`, 'C02')
}
