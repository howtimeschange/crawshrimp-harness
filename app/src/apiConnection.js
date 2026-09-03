'use strict'

function createApiConnection({ synchronize, request }) {
  if (typeof synchronize !== 'function') throw new TypeError('synchronize is required')
  if (typeof request !== 'function') throw new TypeError('request is required')

  let synchronized = false
  let synchronizationPromise = null

  async function ensureSynchronized() {
    if (synchronized) return
    if (!synchronizationPromise) {
      synchronizationPromise = Promise.resolve()
        .then(() => synchronize())
        .then(() => {
          synchronized = true
        })
        .finally(() => {
          synchronizationPromise = null
        })
    }
    await synchronizationPromise
  }

  return {
    ready: ensureSynchronized,
    call: async (...args) => {
      await ensureSynchronized()
      return request(...args)
    },
    markSynchronized: () => {
      synchronized = true
    },
    reset: () => {
      synchronized = false
    },
  }
}

module.exports = { createApiConnection }
