// Bundle-local compatibility fixes; upstream CLI submodules remain pinned.
export function patchBmallHelpExit(source) {
  if (source.includes("error?.code === 'commander.helpDisplayed'")) return source
  const anchor = "    catch (error) {\n        logger.debug({ error }, 'command failed');"
  if (!source.includes(anchor)) throw new Error('bmall help-exit patch anchor missing')
  // Commander exitOverride throws even for successful --help/--version. Keep
  // actual command/validation errors on the CLI's existing failure path.
  return source.replace(anchor, "    catch (error) {\n        if (error?.code === 'commander.helpDisplayed' || error?.code === 'commander.version') return;\n        logger.debug({ error }, 'command failed');")
}
