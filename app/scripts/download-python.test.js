const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const scriptPath = path.join(__dirname, 'download-python.sh')

test('download-python cache validation requires cryptography', () => {
  const source = fs.readFileSync(scriptPath, 'utf8')
  assert.match(source, /site_packages\}\/cryptography/)
})

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 })
}

function symlinkCommand(binDir, name) {
  const resolved = spawnSync('/bin/sh', ['-lc', `command -v ${name}`], {
    encoding: 'utf8',
  }).stdout.trim()

  if (!resolved) {
    throw new Error(`Unable to find command for test PATH: ${name}`)
  }

  fs.symlinkSync(resolved, path.join(binDir, name))
}

test('download-python retries invalid GitHub asset responses before extracting', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-download-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), 'fastapi==0.0.0\n')

    const curlState = path.join(tmp, 'curl-count')
    writeExecutable(
      path.join(fakeBinDir, 'curl'),
      `#!/usr/bin/env bash
set -e
for arg in "$@"; do
  if [ "$arg" = "-sI" ]; then
    echo "HTTP/2 200"
    exit 0
  fi
done
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      shift
      out="$1"
      ;;
    http*)
      url="$1"
      ;;
  esac
  shift || true
done
if [ -z "$out" ]; then
  echo "missing output path" >&2
  exit 2
fi
if [[ "$url" == *"SHA256SUMS" ]]; then
  printf 'expected-sha  cpython-3.12.13+20260310-aarch64-apple-darwin-install_only_stripped.tar.gz\\n' > "$out"
  exit 0
fi
count=0
if [ -f "\${FAKE_CURL_STATE}" ]; then
  count="$(cat "\${FAKE_CURL_STATE}")"
fi
count=$((count + 1))
echo "$count" > "\${FAKE_CURL_STATE}"
if [ "$count" -eq 1 ]; then
  printf 'temporary upstream error body' > "$out"
else
  printf 'valid archive marker' > "$out"
fi
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'shasum'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-a" ] && [ "$2" = "256" ] && [ "$3" = "-c" ]; then
  input="$(cat)"
  case "$input" in
    expected-sha*) exit 0 ;;
    *) echo "unexpected checksum input: $input" >&2; exit 1 ;;
  esac
fi
echo "unexpected shasum args: $*" >&2
exit 2
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'tar'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-tzf" ]; then
  grep -q 'valid archive marker' "$2"
  exit $?
fi
archive=""
dest=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -xzf)
      shift
      archive="$1"
      ;;
    -C)
      shift
      dest="$1"
      ;;
  esac
  shift || true
done
grep -q 'valid archive marker' "$archive"
mkdir -p "$dest/bin"
cat > "$dest/bin/python3" <<'PY'
#!/usr/bin/env bash
if [ "$1" = "-V" ]; then
  echo "Python 3.12.13"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit 0
fi
exit 0
PY
chmod +x "$dest/bin/python3"
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'mac-arm64',
        FAKE_CURL_STATE: curlState,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(curlState, 'utf8').trim(), '2')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python verifies archive SHA256 before extracting', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-sha256-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), 'fastapi==0.0.0\n')

    const verifiedMarker = path.join(tmp, 'sha256-verified')
    writeExecutable(
      path.join(fakeBinDir, 'curl'),
      `#!/usr/bin/env bash
set -e
for arg in "$@"; do
  if [ "$arg" = "-sI" ]; then
    echo "HTTP/2 200"
    exit 0
  fi
done
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      shift
      out="$1"
      ;;
    http*)
      url="$1"
      ;;
  esac
  shift || true
done
if [[ "$url" == *"SHA256SUMS" ]]; then
  printf 'expected-sha  cpython-3.12.13+20260310-aarch64-apple-darwin-install_only_stripped.tar.gz\\n' > "$out"
else
  printf 'valid archive marker' > "$out"
fi
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'shasum'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-a" ] && [ "$2" = "256" ] && [ "$3" = "-c" ]; then
  input="$(cat)"
  case "$input" in
    expected-sha*) echo verified > "\${FAKE_SHA256_MARKER}"; exit 0 ;;
    *) echo "unexpected checksum input: $input" >&2; exit 1 ;;
  esac
fi
echo "unexpected shasum args: $*" >&2
exit 2
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'tar'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-tzf" ]; then
  grep -q 'valid archive marker' "$2"
  exit $?
fi
archive=""
dest=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -xzf)
      shift
      archive="$1"
      ;;
    -C)
      shift
      dest="$1"
      ;;
  esac
  shift || true
done
grep -q 'valid archive marker' "$archive"
mkdir -p "$dest/bin"
cat > "$dest/bin/python3" <<'PY'
#!/usr/bin/env bash
if [ "$1" = "-V" ]; then
  echo "Python 3.12.13"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit 0
fi
exit 0
PY
chmod +x "$dest/bin/python3"
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'mac-arm64',
        FAKE_SHA256_MARKER: verifiedMarker,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(verifiedMarker, 'utf8').trim(), 'verified')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python falls back to sha256sum when shasum is unavailable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-sha256sum-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), 'fastapi==0.0.0\n')

    for (const name of ['bash', 'dirname', 'mktemp', 'rm', 'mkdir', 'grep', 'awk', 'cat', 'sleep', 'chmod', 'seq', 'cp']) {
      symlinkCommand(fakeBinDir, name)
    }

    const verifiedMarker = path.join(tmp, 'sha256sum-verified')
    writeExecutable(
      path.join(fakeBinDir, 'curl'),
      `#!/usr/bin/env bash
set -e
for arg in "$@"; do
  if [ "$arg" = "-sI" ]; then
    echo "HTTP/2 200"
    exit 0
  fi
done
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      shift
      out="$1"
      ;;
    http*)
      url="$1"
      ;;
  esac
  shift || true
done
if [[ "$url" == *"SHA256SUMS" ]]; then
  printf 'expected-sha  cpython-3.12.13+20260310-aarch64-apple-darwin-install_only_stripped.tar.gz\\n' > "$out"
else
  printf 'valid archive marker' > "$out"
fi
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'sha256sum'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-c" ]; then
  input="$(cat)"
  case "$input" in
    expected-sha*) echo verified > "\${FAKE_SHA256SUM_MARKER}"; exit 0 ;;
    *) echo "unexpected checksum input: $input" >&2; exit 1 ;;
  esac
fi
echo "unexpected sha256sum args: $*" >&2
exit 2
`
    )

    writeExecutable(
      path.join(fakeBinDir, 'tar'),
      `#!/usr/bin/env bash
set -e
if [ "$1" = "-tzf" ]; then
  grep -q 'valid archive marker' "$2"
  exit $?
fi
archive=""
dest=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -xzf)
      shift
      archive="$1"
      ;;
    -C)
      shift
      dest="$1"
      ;;
  esac
  shift || true
done
grep -q 'valid archive marker' "$archive"
mkdir -p "$dest/bin"
cat > "$dest/bin/python3" <<'PY'
#!/usr/bin/env bash
if [ "$1" = "-V" ]; then
  echo "Python 3.12.13"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit 0
fi
exit 0
PY
chmod +x "$dest/bin/python3"
`
    )

    const result = spawnSync('/bin/bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: fakeBinDir,
        PYTHON_TARGETS: 'mac-arm64',
        FAKE_SHA256SUM_MARKER: verifiedMarker,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(verifiedMarker, 'utf8').trim(), 'verified')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python reinstalls cached bundle when xlrd is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-cache-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    const bundleDir = path.join(appDir, 'python-dist', 'win-x64')
    const sitePackages = path.join(bundleDir, 'Lib', 'site-packages')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.mkdirSync(sitePackages, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))

    const requirements = [
      'fastapi==0.0.0',
      'uvicorn==0.0.0',
      'websockets==0.0.0',
      'pyyaml==0.0.0',
      'apscheduler==0.0.0',
      'openpyxl==0.0.0',
      'xlrd==0.0.0',
      'pydantic==0.0.0',
      'aiofiles==0.0.0',
      'jsonschema==0.0.0',
      'tzdata==0.0.0',
      'Pillow==0.0.0',
      'PyMuPDF==0.0.0',
    ].join('\n') + '\n'
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), requirements)
    fs.writeFileSync(path.join(coreDir, 'requirements-win.txt'), 'pywin32>=311\n')
    fs.writeFileSync(path.join(bundleDir, '.crawshrimp-requirements.txt'), requirements)
    fs.writeFileSync(path.join(bundleDir, 'python.exe'), '')

    for (const name of [
      'fastapi',
      'uvicorn',
      'websockets',
      'yaml',
      'apscheduler',
      'openpyxl',
      'pydantic',
      'aiofiles',
      'jsonschema',
      'tzdata',
      'PIL',
      'fitz',
      'cryptography',
      'mcp',
      'colorama',
    ]) {
      fs.mkdirSync(path.join(sitePackages, name), { recursive: true })
    }

    writeExecutable(
      path.join(fakeBinDir, 'python3'),
      `#!/usr/bin/env bash
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  if [ "$3" = "--version" ]; then
    echo "pip 0.0.0"
    exit 0
  fi
  shift 2
  target=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --target)
        shift
        target="$1"
        ;;
    esac
    shift || true
  done
  if [ -z "$target" ]; then
    echo "missing --target" >&2
    exit 2
  fi
  mkdir -p "$target/xlrd"
  echo installed > "$target/xlrd/MARKER"
  exit 0
fi
exit 0
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'win-x64',
        PYTHON: path.join(fakeBinDir, 'python3'),
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Cross-installing backend requirements into win-x64/)
    assert.ok(fs.existsSync(path.join(sitePackages, 'xlrd', 'MARKER')))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python repairs a cached Windows bundle missing pywintypes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-win-deps-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    const bundleDir = path.join(appDir, 'python-dist', 'win-x64')
    const sitePackages = path.join(bundleDir, 'Lib', 'site-packages')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.mkdirSync(sitePackages, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))

    const requirements = 'mcp==2.0.0\n'
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), requirements)
    fs.writeFileSync(path.join(coreDir, 'requirements-win.txt'), 'pywin32>=311\n')
    fs.writeFileSync(path.join(bundleDir, '.crawshrimp-requirements.txt'), requirements)
    fs.writeFileSync(path.join(bundleDir, 'python.exe'), '')

    for (const name of [
      'fastapi',
      'uvicorn',
      'websockets',
      'yaml',
      'apscheduler',
      'openpyxl',
      'xlrd',
      'pydantic',
      'aiofiles',
      'jsonschema',
      'tzdata',
      'PIL',
      'fitz',
      'cryptography',
      'mcp',
      'colorama',
    ]) {
      fs.mkdirSync(path.join(sitePackages, name), { recursive: true })
    }

    writeExecutable(
      path.join(fakeBinDir, 'python3'),
      `#!/usr/bin/env bash
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  if [ "$3" = "--version" ]; then
    echo "pip 0.0.0"
    exit 0
  fi
  shift 2
  target=""
  windows_requirements=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --target)
        shift
        target="$1"
        ;;
      -r)
        shift
        case "$1" in
          *requirements-win.txt) windows_requirements="$1" ;;
        esac
        ;;
    esac
    shift || true
  done
  if [ -z "$target" ] || [ -z "$windows_requirements" ]; then
    echo "Windows requirements were not installed" >&2
    exit 2
  fi
  mkdir -p "$target/win32/lib" "$target/pywin32_system32"
  echo installed > "$target/win32/lib/pywintypes.py"
  echo installed > "$target/win32/lib/win32con.py"
  echo installed > "$target/win32/lib/ntsecuritycon.py"
  echo installed > "$target/win32/win32api.pyd"
  echo installed > "$target/win32/win32security.pyd"
  echo installed > "$target/pywin32_system32/pywintypes312.dll"
  echo installed > "$target/pywin32.pth"
  exit 0
fi
exit 0
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'win-x64',
        PYTHON: path.join(fakeBinDir, 'python3'),
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Cross-installing backend requirements into win-x64/)
    assert.ok(fs.existsSync(path.join(sitePackages, 'win32', 'lib', 'pywintypes.py')))
    assert.ok(fs.existsSync(path.join(sitePackages, 'win32', 'lib', 'win32con.py')))
    assert.ok(fs.existsSync(path.join(sitePackages, 'win32', 'lib', 'ntsecuritycon.py')))
    assert.ok(fs.existsSync(path.join(sitePackages, 'win32', 'win32api.pyd')))
    assert.ok(fs.existsSync(path.join(sitePackages, 'win32', 'win32security.pyd')))
    assert.ok(fs.existsSync(path.join(sitePackages, 'pywin32_system32', 'pywintypes312.dll')))
    assert.ok(fs.existsSync(path.join(sitePackages, 'pywin32.pth')))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python refreshes Windows dependencies when their requirements change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-win-cache-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const fakeBinDir = path.join(tmp, 'bin')
    const bundleDir = path.join(appDir, 'python-dist', 'win-x64')
    const sitePackages = path.join(bundleDir, 'Lib', 'site-packages')
    const installCount = path.join(tmp, 'install-count')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(fakeBinDir, { recursive: true })
    fs.mkdirSync(sitePackages, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))

    const requirements = 'mcp==2.0.0\n'
    const windowsRequirements = path.join(coreDir, 'requirements-win.txt')
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), requirements)
    fs.writeFileSync(windowsRequirements, 'pywin32>=311\n')
    fs.writeFileSync(path.join(bundleDir, '.crawshrimp-requirements.txt'), requirements)
    fs.writeFileSync(path.join(bundleDir, 'python.exe'), '')

    for (const name of [
      'fastapi',
      'uvicorn',
      'websockets',
      'yaml',
      'apscheduler',
      'openpyxl',
      'xlrd',
      'pydantic',
      'aiofiles',
      'jsonschema',
      'tzdata',
      'PIL',
      'fitz',
      'cryptography',
      'mcp',
      'colorama',
      'win32/lib',
      'pywin32_system32',
    ]) {
      fs.mkdirSync(path.join(sitePackages, name), { recursive: true })
    }
    fs.writeFileSync(path.join(sitePackages, 'win32', 'lib', 'pywintypes.py'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'lib', 'win32con.py'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'lib', 'ntsecuritycon.py'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'win32api.pyd'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'win32security.pyd'), '')
    fs.writeFileSync(path.join(sitePackages, 'pywin32_system32', 'pywintypes312.dll'), '')
    fs.writeFileSync(path.join(sitePackages, 'pywin32.pth'), '')

    writeExecutable(
      path.join(fakeBinDir, 'python3'),
      `#!/usr/bin/env bash
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  if [ "$3" = "--version" ]; then
    echo "pip 0.0.0"
    exit 0
  fi
  count=0
  if [ -f "\${FAKE_INSTALL_COUNT}" ]; then
    count="$(cat "\${FAKE_INSTALL_COUNT}")"
  fi
  echo $((count + 1)) > "\${FAKE_INSTALL_COUNT}"
  exit 0
fi
exit 0
`
    )

    const runDownload = () => spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        PYTHON_TARGETS: 'win-x64',
        PYTHON: path.join(fakeBinDir, 'python3'),
        FAKE_INSTALL_COUNT: installCount,
      },
      encoding: 'utf8',
    })

    const first = runDownload()
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const firstCount = Number(fs.readFileSync(installCount, 'utf8').trim())

    fs.writeFileSync(windowsRequirements, 'pywin32>=311,<400\n')
    const second = runDownload()
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    const secondCount = Number(fs.readFileSync(installCount, 'utf8').trim())

    assert.equal(secondCount, firstCount + 1)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('download-python smoke-tests the backend and dependency closure with a runnable Windows interpreter', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-python-win-import-'))

  try {
    const appDir = path.join(tmp, 'app')
    const scriptsDir = path.join(appDir, 'scripts')
    const coreDir = path.join(tmp, 'core')
    const bundleDir = path.join(appDir, 'python-dist', 'win-x64')
    const sitePackages = path.join(bundleDir, 'Lib', 'site-packages')
    const importMarker = path.join(tmp, 'windows-import-verified')
    const pipCheckMarker = path.join(tmp, 'windows-pip-check-verified')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.mkdirSync(coreDir, { recursive: true })
    fs.mkdirSync(sitePackages, { recursive: true })
    fs.copyFileSync(scriptPath, path.join(scriptsDir, 'download-python.sh'))

    const requirements = 'mcp==2.0.0\n'
    const windowsRequirements = 'pywin32>=311\n'
    fs.writeFileSync(path.join(coreDir, 'requirements.txt'), requirements)
    fs.writeFileSync(path.join(coreDir, 'requirements-win.txt'), windowsRequirements)
    fs.writeFileSync(path.join(bundleDir, '.crawshrimp-requirements.txt'), requirements)
    fs.writeFileSync(path.join(bundleDir, '.crawshrimp-requirements-win.txt'), windowsRequirements)

    for (const name of [
      'fastapi',
      'uvicorn',
      'websockets',
      'yaml',
      'apscheduler',
      'openpyxl',
      'xlrd',
      'pydantic',
      'aiofiles',
      'jsonschema',
      'tzdata',
      'PIL',
      'fitz',
      'cryptography',
      'mcp',
      'colorama',
      'win32/lib',
      'pywin32_system32',
    ]) {
      fs.mkdirSync(path.join(sitePackages, name), { recursive: true })
    }
    fs.writeFileSync(path.join(sitePackages, 'win32', 'lib', 'pywintypes.py'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'lib', 'win32con.py'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'lib', 'ntsecuritycon.py'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'win32api.pyd'), '')
    fs.writeFileSync(path.join(sitePackages, 'win32', 'win32security.pyd'), '')
    fs.writeFileSync(path.join(sitePackages, 'pywin32_system32', 'pywintypes312.dll'), '')
    fs.writeFileSync(path.join(sitePackages, 'pywin32.pth'), '')

    writeExecutable(
      path.join(bundleDir, 'python.exe'),
      `#!/usr/bin/env bash
if [ "$1" = "-V" ]; then
  echo "Python 3.12.13"
  exit 0
fi
if [ "$1" = "-c" ]; then
  if [ "$PWD" != "\${FAKE_REPO_ROOT}" ]; then
    echo "backend import probe must run from repo root: $PWD" >&2
    exit 3
  fi
  case "$2" in
    *"import ntsecuritycon, pywintypes, win32api, win32con, win32security"*"from mcp.server.mcpserver import MCPServer"*"import core.api_server"*)
      echo verified > "\${FAKE_IMPORT_MARKER}"
      exit 0
      ;;
  esac
  echo "unexpected import probe: $2" >&2
  exit 2
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  if [ "$3" = "--version" ]; then
    echo "pip 0.0.0"
    exit 0
  fi
  if [ "$3" = "check" ]; then
    echo checked > "\${FAKE_PIP_CHECK_MARKER}"
    exit 0
  fi
fi
echo "unexpected Python args: $*" >&2
exit 2
`
    )

    const result = spawnSync('bash', [path.join(scriptsDir, 'download-python.sh')], {
      cwd: appDir,
      env: {
        ...process.env,
        PYTHON_TARGETS: 'win-x64',
        FAKE_IMPORT_MARKER: importMarker,
        FAKE_PIP_CHECK_MARKER: pipCheckMarker,
        FAKE_REPO_ROOT: tmp,
      },
      encoding: 'utf8',
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(importMarker, 'utf8').trim(), 'verified')
    assert.equal(fs.readFileSync(pipCheckMarker, 'utf8').trim(), 'checked')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
