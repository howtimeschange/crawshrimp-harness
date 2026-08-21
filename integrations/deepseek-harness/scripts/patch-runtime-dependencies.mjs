import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ACCESS_PROBE_MARKER = 'crawshrimp-workspace-access-probe-v1'
const WELCOME_NOTICE_PATCH_MARKER = 'crawshrimp-disable-dsh-welcome-notice-v1'
const LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER = 'crawshrimp-llm-pi-ai-provider-order-v1'

export function patchRuntimeDependencies(runtimeRoot) {
  const workspaceResult = patchWorkspaceAccessProbe(runtimeRoot)
  const welcomeNoticeResult = patchWelcomeNotice(runtimeRoot)
  const piAiProviderOrderResult = patchPiAiProviderOrder(runtimeRoot)
  return {
    patched: workspaceResult.patched || welcomeNoticeResult.patched || piAiProviderOrderResult.patched,
    workspaceEntry: workspaceResult.workspaceEntry,
    welcomeNoticeEntry: welcomeNoticeResult.welcomeNoticeEntry,
    piAiProviderOrderEntry: piAiProviderOrderResult.piAiProviderOrderEntry,
    workspacePatched: workspaceResult.patched,
    welcomeNoticePatched: welcomeNoticeResult.patched,
    piAiProviderOrderPatched: piAiProviderOrderResult.patched,
  }
}

function patchWorkspaceAccessProbe(runtimeRoot) {
  const workspaceEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-workspace',
    'lib',
    'index.js',
  )
  let source = readFileSync(workspaceEntry, 'utf8')
  if (source.includes(WORKSPACE_ACCESS_PROBE_MARKER)) return { patched: false, workspaceEntry }

  source = replaceExact(
    source,
    'import { realpath, stat } from "node:fs/promises";',
    'import { open, readdir, realpath, rename, stat, unlink } from "node:fs/promises";',
    'workspace fs imports',
  )
  source = replaceExact(
    source,
    'import { basename } from "node:path";',
    'import { basename, join } from "node:path";',
    'workspace path imports',
  )
  source = replaceExact(
    source,
    'async function realpathNormalize(path) {\n\treturn await realpath(path);\n}',
    `async function realpathNormalize(path) {
\treturn await realpath(path);
}
// ${WORKSPACE_ACCESS_PROBE_MARKER}
async function probeWorkspaceDirectoryAccess(directory) {
\tawait readdir(directory);
\tconst temporary = join(directory, \`.dsh-workspace-probe-\${process.pid}-\${randomUUID()}\`);
\tconst renamed = \`\${temporary}.renamed\`;
\tlet handle;
\ttry {
\t\thandle = await open(temporary, "wx", 384);
\t\tawait handle.writeFile("workspace-probe", "utf8");
\t\tawait handle.sync();
\t\tawait handle.close();
\t\thandle = void 0;
\t\tawait rename(temporary, renamed);
\t\tif (!(await stat(renamed)).isFile()) throw new Error("workspace probe target is not a file");
\t\tawait unlink(renamed);
\t} finally {
\t\tif (handle) await handle.close().catch(() => {});
\t\tawait unlink(temporary).catch(() => {});
\t\tawait unlink(renamed).catch(() => {});
\t}
}`,
    'workspace access probe helper',
  )
  source = replaceExact(
    source,
    '\tasync status() {\n\t\ttry {\n\t\t\treturn (await stat(this.record.path)).isDirectory() ? "ok" : "missing-dir";\n\t\t} catch {\n\t\t\treturn "missing-dir";\n\t\t}\n\t}',
    '\tasync status() {\n\t\ttry {\n\t\t\tif (!(await stat(this.record.path)).isDirectory()) return "missing-dir";\n\t\t\tawait probeWorkspaceDirectoryAccess(this.record.path);\n\t\t\treturn "ok";\n\t\t} catch {\n\t\t\treturn "missing-dir";\n\t\t}\n\t}',
    'workspace status access probe',
  )
  source = replaceExact(
    source,
    '\tasync create(path, title) {\n\t\tconst canonical = await realpathNormalize(path);\n\t\tif (!(await stat(canonical)).isDirectory()) throw new Error(`cannot create a workspace at \'${canonical}\': path is not a directory`);\n\t\treturn await this.enqueueOperation(() => this.createCanonical(canonical, title));\n\t}',
    '\tasync create(path, title) {\n\t\tconst canonical = await realpathNormalize(path);\n\t\tif (!(await stat(canonical)).isDirectory()) throw new Error(`cannot create a workspace at \'${canonical}\': path is not a directory`);\n\t\tawait probeWorkspaceDirectoryAccess(canonical);\n\t\treturn await this.enqueueOperation(() => this.createCanonical(canonical, title));\n\t}',
    'workspace create access probe',
  )
  writeFileSync(workspaceEntry, source, 'utf8')
  return { patched: true, workspaceEntry }
}

function patchWelcomeNotice(runtimeRoot) {
  const welcomeNoticeEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-client-ui-settings-models',
    'lib',
    'client.js',
  )
  let source = readFileSync(welcomeNoticeEntry, 'utf8')
  if (source.includes(WELCOME_NOTICE_PATCH_MARKER)) return { patched: false, welcomeNoticeEntry }

  source = replaceExact(
    source,
    '\t\t\tctx.slots.inject("settings.onboarding", () => ctx.slots.register({\n\t\t\t\tname: "settings.onboarding",\n\t\t\t\tid: "welcome-notice",\n\t\t\t\torder: -100,\n\t\t\t\tinject: welcomeInjected\n\t\t\t}, WelcomeNotice));',
    `\t\t\t/* ${WELCOME_NOTICE_PATCH_MARKER}: Crawshrimp removes the upstream internal testing notice. */`,
    'welcome notice onboarding registration',
  )
  writeFileSync(welcomeNoticeEntry, source, 'utf8')
  return { patched: true, welcomeNoticeEntry }
}

function patchPiAiProviderOrder(runtimeRoot) {
  const piAiProviderOrderEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-llm-pi-ai',
    'lib',
    'index.js',
  )
  let source = readFileSync(piAiProviderOrderEntry, 'utf8')
  if (source.includes(LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER)) {
    return { patched: false, piAiProviderOrderEntry }
  }

  source = replaceExact(
    source,
    '\t\tconst routes = [...profiles().keys()];',
    `\t\tconst routes = [...profiles().keys()].map((provider, index) => ({ provider, index })).sort((left, right) => {
\t\t\t/* ${LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER}: Crawshrimp keeps the official DeepSeek route first when multiple keys are configured. */
\t\t\tconst rank = (provider) => provider === "crawshrimp-deepseek-official" ? 0 : 1;
\t\t\treturn rank(left.provider) - rank(right.provider) || left.index - right.index;
\t\t}).map(({ provider }) => provider);`,
    'llm-pi-ai provider registration order',
  )
  writeFileSync(piAiProviderOrderEntry, source, 'utf8')
  return { patched: true, piAiProviderOrderEntry }
}

function replaceExact(source, needle, replacement, label) {
  const first = source.indexOf(needle)
  if (first < 0) throw new Error(`cannot patch ${label}: expected source not found`)
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`cannot patch ${label}: expected source is ambiguous`)
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = patchRuntimeDependencies(process.argv[2] || defaultRoot)
  console.log(`[patch-runtime-dependencies] workspace access probe ${result.workspacePatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] welcome notice removal ${result.welcomeNoticePatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] pi-ai provider order ${result.piAiProviderOrderPatched ? 'applied' : 'already present'}`)
}
