'use strict'

const fs = require('node:fs')
const { atomicWriteJsonSync } = require('./atomicFile')

// This belongs to the installation, not the account or the renderer origin.
// Capture legacy evidence before startup creates desktop-config.json/data files.
function createDesktopOnboarding({ file, existingInstallation = false, write = atomicWriteJsonSync }) {
  let completed = Boolean(existingInstallation)
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (state.version === 1 && typeof state.completed === 'boolean') completed = state.completed
  } catch { /* migrate existing installs, retain first run on a clean install */ }
  function persist(next) {
    write(file, { version: 1, completed: next })
    completed = next
  }
  // Persist the initial decision before the first startup finishes. A pending
  // first run remains pending across restarts even after config files exist.
  persist(completed)
  return {
    required: () => !completed,
    complete() { if (!completed) persist(true) },
  }
}

module.exports = { createDesktopOnboarding }
