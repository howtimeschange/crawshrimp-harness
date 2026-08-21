'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SYSTEM_SID = 'S-1-5-18'
const ADMINISTRATORS_SID = 'S-1-5-32-544'
const BROAD_ACCESS_SIDS = [
  'S-1-1-0',       // Everyone
  'S-1-5-7',       // Anonymous
  'S-1-5-11',      // Authenticated Users
  'S-1-5-32-545',  // Builtin Users
  'S-1-5-32-546',  // Builtin Guests
]
const SID_PATTERN = /^S-\d+(?:-\d+)+$/
const sidCache = new WeakMap()
const SET_EXACT_DACL_SCRIPT = String.raw`& {
  param([string]$Target, [string]$Kind, [string]$UserSid)
  $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $none = [System.Security.AccessControl.PropagationFlags]::None
  if ($Kind -eq 'directory') {
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    $security = New-Object System.Security.AccessControl.FileSecurity
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  }
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sidValue in @($UserSid, 'S-1-5-18', 'S-1-5-32-544')) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $rights, $inheritance, $none, $allow)
    [void]$security.AddAccessRule($rule)
  }
  if ($Kind -eq 'directory') {
    [System.IO.Directory]::SetAccessControl($Target, $security)
  } else {
    [System.IO.File]::SetAccessControl($Target, $security)
  }
}`

function normalizeWindowsIdentity(value, pathApi = path) {
  return pathApi.normalize(pathApi.resolve(String(value || ''))).toLowerCase()
}

function assertSafeWindowsDataRootSync(targetPath, {
  platform = process.platform,
  pathApi = path,
  homeDir = '',
  env = process.env,
} = {}) {
  const target = pathApi.resolve(String(targetPath || ''))
  if (platform !== 'win32') return target
  const broadRoots = [
    pathApi.parse(target).root,
    homeDir,
    homeDir ? pathApi.dirname(homeDir) : '',
    env?.USERPROFILE,
    env?.LOCALAPPDATA,
    env?.APPDATA,
    env?.SystemRoot,
    env?.WINDIR,
    env?.ProgramFiles,
    env?.['ProgramFiles(x86)'],
    env?.ProgramData,
    env?.ALLUSERSPROFILE,
    env?.PUBLIC,
    env?.USERPROFILE ? pathApi.dirname(env.USERPROFILE) : '',
  ].filter(Boolean)
  const targetIdentity = normalizeWindowsIdentity(target, pathApi)
  if (broadRoots.some(candidate => normalizeWindowsIdentity(candidate, pathApi) === targetIdentity)) {
    throw new Error(`CRAWSHRIMP_DATA must be a dedicated child directory: ${target}`)
  }
  return target
}

function windowsExecOptions() {
  return {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
}

function currentWindowsUserSidSync(execFileSyncApi = execFileSync) {
  const cached = sidCache.get(execFileSyncApi)
  if (cached) return cached
  const output = execFileSyncApi('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ], windowsExecOptions())
  const sid = String(output || '').trim()
  if (!SID_PATTERN.test(sid)) {
    throw new Error('Unable to resolve the current Windows user SID')
  }
  sidCache.set(execFileSyncApi, sid)
  return sid
}

function hardenWindowsPathSync(targetPath, {
  platform = process.platform,
  fsApi = fs,
  execFileSyncApi = execFileSync,
} = {}) {
  if (platform !== 'win32') return false
  const target = path.resolve(String(targetPath || ''))
  const targetStat = fsApi.lstatSync(target)
  if (targetStat.isSymbolicLink()) {
    throw new Error(`Refusing to apply a Windows ACL through a symbolic link: ${target}`)
  }
  if (!targetStat.isDirectory() && !targetStat.isFile()) {
    throw new Error(`Windows ACL target must be a regular file or directory: ${target}`)
  }

  const currentUserSid = currentWindowsUserSidSync(execFileSyncApi)
  const inheritance = targetStat.isDirectory() ? '(OI)(CI)' : ''
  const permissions = (sid) => `*${sid}:${inheritance}F`
  const options = windowsExecOptions()

  // Grant the caller first so removing inherited entries can never lock the
  // running desktop process out between icacls operations.
  execFileSyncApi('icacls.exe', [
    target,
    '/grant:r',
    permissions(currentUserSid),
    permissions(SYSTEM_SID),
    permissions(ADMINISTRATORS_SID),
    '/Q',
  ], options)
  execFileSyncApi('icacls.exe', [target, '/inheritance:r', '/Q'], options)
  execFileSyncApi('icacls.exe', [
    target,
    '/remove',
    ...BROAD_ACCESS_SIDS.map((sid) => `*${sid}`),
    '/Q',
  ], options)
  // icacls /remove only handles principals we can name in advance.  Finish
  // with one exact protected DACL so an existing shared/custom data directory
  // cannot retain an explicit ACE for an unrelated local account.
  execFileSyncApi('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    SET_EXACT_DACL_SCRIPT,
    target,
    targetStat.isDirectory() ? 'directory' : 'file',
    currentUserSid,
  ], options)
  return true
}

module.exports = {
  assertSafeWindowsDataRootSync,
  hardenWindowsPathSync,
}
