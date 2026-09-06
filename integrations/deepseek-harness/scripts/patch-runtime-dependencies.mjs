/**
 * DSH rc.1 / dsh-im 4.11 clean-install guard.
 *
 * The former rc.8 runtime needed binary edits to a flat Cordis + SDK graph.
 * rc.1 boots the supported Web profile instead: agent tools live in the
 * per-session `standard` preset and dsh-im 4.11 talks to current controllers.
 * Patching those compiled packages would either fail on a clean install or
 * quietly discard upstream capabilities, so this guard deliberately writes
 * nothing.  It proves that the staged closure contains the exact upstream
 * contracts the Crawshrimp profile composes around.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const RUNTIME_GUARD_MARKER = 'crawshrimp-dsh-rc1-native-runtime-guard-v1'

function requireFile(root, relativePath) {
  const target = join(root, relativePath)
  if (!existsSync(target)) {
    throw new Error(`DSH rc.1 runtime closure is missing ${relativePath}`)
  }
  return target
}

function requireText(root, relativePath, expected) {
  const target = requireFile(root, relativePath)
  const source = readFileSync(target, 'utf8')
  if (!source.includes(expected)) {
    throw new Error(`DSH rc.1 runtime contract changed in ${relativePath}: expected ${expected}`)
  }
  return target
}

function packageNameFromLoaderName(name) {
  return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
}

/**
 * Cordis evaluates a profile from the runtime root, not from each bundle's
 * nested node_modules tree. Verify every effective profile row where it will
 * actually be imported. This catches npm topology changes before a staged or
 * packaged runtime reaches the user.
 */
function assertEffectiveProfileRootClosure(root) {
  const productProfile = ['profiles/web/cordis.patch.yml', 'profile/web/cordis.patch.yml']
    .map((relativePath) => join(root, relativePath))
    .find(existsSync)
  if (!productProfile) throw new Error('DSH rc.1 product Web profile is missing from the runtime')
  const patchFiles = [
    'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml',
    'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
    'node_modules/@xmanrui/dsh-im/cordis.patch.yml',
    productProfile.slice(root.length + 1),
  ]
  const packages = new Set()
  for (const relativePath of patchFiles) {
    const source = readFileSync(requireFile(root, relativePath), 'utf8')
    for (const match of source.matchAll(/^\s+name:\s+['"]([^'"]+)['"]\s*$/gmu)) {
      packages.add(packageNameFromLoaderName(match[1]))
    }
  }
  for (const packageName of packages) {
    requireFile(root, `node_modules/${packageName}/package.json`)
  }
  return [...packages].sort()
}

/** Verify a preset composition against the runtime-root package closure. */
function assertStandardPresetRootClosure(root) {
  const standardPath = 'node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml'
  // Source development runtime keeps the profile under `profile/web`; the
  // package staging step copies it to `profiles/web`. Both execute this same
  // guard, so resolve the actual layout before checking the preset closure.
  const crawshrimpPath = [
    'profiles/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
    'profile/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
  ].find((relativePath) => existsSync(join(root, relativePath)))
  if (!crawshrimpPath) {
    throw new Error('DSH rc.1 product Crawshrimp standard preset is missing from the runtime')
  }
  const sources = [
    readFileSync(requireFile(root, standardPath), 'utf8'),
    readFileSync(requireFile(root, crawshrimpPath), 'utf8'),
  ]
  const packages = new Set()
  for (const source of sources) {
    for (const match of source.matchAll(/^\s+name:\s+['"]([^'"]+)['"]\s*$/gmu)) {
      packages.add(packageNameFromLoaderName(match[1]))
    }
  }
  for (const packageName of packages) {
    requireFile(root, `node_modules/${packageName}/package.json`)
  }
  return { packages: [...packages].sort(), standardPath, crawshrimpPath }
}

/**
 * Validate, but never mutate, a freshly installed runtime.
 *
 * @returns source paths used as current-release evidence for staging/tests.
 */
export function patchRuntimeDependencies(runtimeRoot) {
  const root = resolve(runtimeRoot)
  const dshManifest = requireText(root, 'node_modules/@deepseek-ai/dsh/package.json', '"0.1.2-rc.1"')
  const dshBin = requireFile(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  // Cordis resolves Web Host plugins from the product runtime root.  Keep the
  // complete official Web closure hoisted here instead of relying on npm's
  // nested copy below `dsh`, which cannot satisfy that resolver on a clean
  // install.
  const dshWebAppManifest = requireText(root, 'node_modules/@deepseek-ai/dsh-web-app/package.json', '"0.1.2-rc.1"')
  const dshWebAppPatch = requireFile(root, 'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml')
  const dshWorkspaceController = requireText(root, 'node_modules/@deepseek-ai/dsh-api-workspace-controller/package.json', '"0.1.2-rc.1"')
  const dshCordisHostRunner = requireText(root, 'node_modules/@deepseek-ai/dsh-cordis-host-runner/package.json', '"0.1.2-rc.1"')
  // These active rows come from the standard Web profile plus Crawshrimp's
  // official-profile overlay.  They are intentionally direct dependencies:
  // the Cordis loader imports every active row from this runtime root.
  const dshAttachmentLocal = requireText(root, 'node_modules/@deepseek-ai/dsh-attachment-local/package.json', '"0.1.2-rc.1"')
  const dshLlMPiAi = requireText(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json', '"0.1.2-rc.1"')
  const dshTimeContext = requireText(root, 'node_modules/@deepseek-ai/dsh-time-context/package.json', '"0.1.2-rc.1"')
  const dshSchedule = requireText(root, 'node_modules/@deepseek-ai/dsh-schedule/package.json', '"0.1.2-rc.1"')
  const dshImManifest = requireText(root, 'node_modules/@xmanrui/dsh-im/package.json', '"4.11.0"')
  const dshImEntry = requireFile(root, 'node_modules/@xmanrui/dsh-im/lib/index.js')
  const profilePackages = assertEffectiveProfileRootClosure(root)
  const standardPreset = assertStandardPresetRootClosure(root)
  const inboundTtl = requireText(
    root,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/inbound-ttl.mjs',
    'DEFAULT_INBOUND_TTL_HOURS = 168',
  )
  const sessionBinding = requireFile(
    root,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/harness-session-binding.mjs',
  )
  const modelSetting = requireFile(
    root,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/model-setting.mjs',
  )

  return {
    patched: false,
    marker: RUNTIME_GUARD_MARKER,
    dshManifest,
    dshBin,
    dshWebAppManifest,
    dshWebAppPatch,
    dshWorkspaceController,
    dshCordisHostRunner,
    dshAttachmentLocal,
    dshLlMPiAi,
    dshTimeContext,
    dshSchedule,
    dshImManifest,
    dshImEntry,
    profilePackages,
    standardPresetPackages: standardPreset.packages,
    crawshrimpPreset: standardPreset.crawshrimpPath,
    inboundTtl,
    sessionBinding,
    modelSetting,
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const result = patchRuntimeDependencies(resolve(new URL('..', import.meta.url).pathname))
  console.log(`[patch-runtime-dependencies] ${result.marker}: rc.1/4.11 native runtime verified; no binary patch applied`)
}
