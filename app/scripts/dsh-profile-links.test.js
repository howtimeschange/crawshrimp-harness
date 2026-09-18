const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

test('Electron preserves bundled packages across Web profile restarts and stale junction upgrades', () => {
  const workerUrl = pathToFileURL(path.resolve(__dirname, '../../integrations/deepseek-harness/worker/web-rpc-client.mjs')).href
  // Plain Node's rm implementation does not reproduce Electron's Windows
  // junction traversal. Exercise the same Electron-as-Node runtime we ship.
  const script = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, dirname } from 'node:path';
    import { ensureWebProfile } from ${JSON.stringify(workerUrl)};
    const root = mkdtempSync(join(tmpdir(), 'harness profile restart '));
    const runtimeRoot = join(root, 'installed runtime');
    const dshHome = join(root, 'user home');
    const source = join(runtimeRoot, 'profiles/web');
    const packages = ['@xmanrui/dsh-im', 'crawshrimp-product-bridge', 'crawshrimp-slots'];
    const links = [];
    try {
      mkdirSync(join(source, 'agent-presets/crawshrimp-standard'), { recursive: true });
      for (const file of ['cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'agent-presets/crawshrimp-standard/agent.cordis.yml', 'agent-presets/crawshrimp-standard/preset.yml']) writeFileSync(join(source, file), 'fixture');
      writeFileSync(join(source, 'package.json'), JSON.stringify({dependencies: {'@xmanrui/dsh-im': '4.11.0'}}));
      const profile = join(dshHome, 'profiles/web');
      mkdirSync(profile, {recursive: true});
      writeFileSync(join(profile, 'package.json'), JSON.stringify({dependencies: {'user-plugin': '1.0.0'}}));
      writeFileSync(join(dshHome, 'sessions-sentinel'), 'keep sessions');
      for (const [index, name] of packages.entries()) {
        const target = join(runtimeRoot, 'node_modules', name);
        mkdirSync(target, {recursive: true});
        writeFileSync(join(target, 'package.json'), JSON.stringify({name}));
        writeFileSync(join(target, 'entry.js'), 'keep runtime');
        const link = join(profile, 'node_modules', name);
        mkdirSync(dirname(link), {recursive: true});
        links.push(link);
        // Cover an existing target, a dangling upgrade junction, and a real
        // profile-local copy that must be replaced with the current bundle.
        if (index === 0) symlinkSync(target, link, 'junction');
        else if (index === 1) symlinkSync(join(root, 'removed installation'), link, 'junction');
        else { mkdirSync(link); writeFileSync(join(link, 'package.json'), '{}'); }
      }
      for (let boot = 0; boot < 3; boot++) {
        ensureWebProfile({runtimeRoot, dshHome});
        for (const name of packages) {
          for (const base of [runtimeRoot, profile]) {
            assert.equal(JSON.parse(readFileSync(join(base, 'node_modules', name, 'package.json'))).name, name);
            assert.equal(readFileSync(join(base, 'node_modules', name, 'entry.js'), 'utf8'), 'keep runtime');
          }
        }
        assert.equal(JSON.parse(readFileSync(join(profile, 'package.json'))).dependencies['user-plugin'], '1.0.0');
        assert.equal(readFileSync(join(dshHome, 'sessions-sentinel'), 'utf8'), 'keep sessions');
      }
      console.log('PASS: Electron profile restart and upgrade junctions');
    } finally {
      for (const link of links) { try { unlinkSync(link); } catch {} }
      rmSync(root, {recursive: true, force: true});
    }
  `
  const result = spawnSync(require('electron'), ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  assert.equal(result.status, 0, result.error?.stack || result.stderr || result.stdout)
  assert.match(result.stdout, /PASS: Electron profile restart/)
})
