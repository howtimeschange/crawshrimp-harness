import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIGURED_MODEL_CATALOG_MARKER = 'crawshrimp-configured-model-catalog-v1'

export function patchConfiguredModelCatalogSource(source) {
  if (source.includes(CONFIGURED_MODEL_CATALOG_MARKER)) return source
  const before = '\tlistModels(provider) {\n\t\treturn Promise.resolve().then(() => {\n\t\t\tconst snapshot = this.current();\n\t\t\tthis.profileOf(snapshot, provider);'
  const after = `\tlistModels(provider) {
\t\treturn Promise.resolve().then(async () => {
\t\t\tconst snapshot = this.current();
\t\t\tconst profile = this.profileOf(snapshot, provider);
\t\t\t// ${CONFIGURED_MODEL_CATALOG_MARKER}: resolve this route's live key, never another provider's.
\t\t\t// Keep profiles registered for settings; empty groups disappear from model pickers.
\t\t\ttry {
\t\t\t\tconst key = await this.config.resolveApiKey(provider, profile);
\t\t\t\tif (typeof key !== "string" || !key.trim()) return [];
\t\t\t} catch (error) {
\t\t\t\tif (error?.code === "MISSING_CREDENTIAL" || error?.code === "INVALID_CREDENTIAL") return [];
\t\t\t\tthrow error;
\t\t\t}`
  if (!source.includes(before)) throw new Error('llm-pi-ai configured model catalog anchor changed')
  return source.replace(before, after)
}

export function patchConfiguredModelCatalog(root) {
  const entry = join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const before = readFileSync(entry, 'utf8')
  const after = patchConfiguredModelCatalogSource(before)
  if (after !== before) writeFileSync(entry, after)
  return { entry, marker: CONFIGURED_MODEL_CATALOG_MARKER }
}
