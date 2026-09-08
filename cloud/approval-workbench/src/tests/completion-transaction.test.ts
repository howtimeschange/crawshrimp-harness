import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { completeJob } from '../worker/machine-routes'
import type { Env } from '../worker/env'
import { sha256Hex } from '../worker/security/tokens'
import { createD1MigrationTestDatabase, executeD1SqlScript, type D1MigrationTestDatabase } from './migration-test-helper'

describe('completion receipts against real local D1', () => {
  let db: D1MigrationTestDatabase
  let env: Env
  const output = { generated_asset_uids: ['asset'], count: 1 }
  const request = (result: unknown = output, lease = 'lease') => new Request('https://test/api/jobs/job/complete', {
    method: 'POST', headers: { authorization: 'Bearer fake-review-token', 'content-type': 'application/json' },
    body: JSON.stringify({ lease_id: lease, result }),
  })
  const row = (table: string) => db.prepare(`SELECT * FROM ${table} LIMIT 1`).first<Record<string, unknown>>()

  beforeEach(async () => {
    db = await createD1MigrationTestDatabase()
    env = { DB: db, ASSETS: {}, SESSION_TTL_SECONDS: '604800' } as unknown as Env
    for (const file of ['0001_init.sql', '0003_generation_jobs.sql', '0006_dispatch_job_cancel_requested.sql']) {
      await executeD1SqlScript(db, fs.readFileSync(`migrations/${file}`, 'utf8'))
    }
    await db.prepare(`INSERT INTO task_machines (machine_id, machine_name, fingerprint_hash, auth_status, health, current_job_id, registered_at, updated_at)
      VALUES ('machine','test','fingerprint','active','online_busy','job','2026','2026')`).run()
    await db.prepare(`INSERT INTO machine_tokens (machine_id, token_hash, issued_at) VALUES ('machine',?,'2026')`)
      .bind(await sha256Hex('fake-review-token')).run()
    await db.prepare(`INSERT INTO dispatch_jobs (job_uid,batch_uid,job_type,status,assigned_machine_id,idempotency_key,lease_id,lease_expires_at,created_at,updated_at)
      VALUES ('job','batch','generate_ai_image','running','machine','key','lease','2999-01-01T00:00:00Z','2026','2026')`).run()
    await db.prepare(`INSERT INTO ai_generation_requests (request_uid,batch_uid,style_id,prompt_text,dispatch_job_uid,created_at,updated_at)
      VALUES ('request','batch',1,'prompt','job','2026','2026')`).run()
  })

  afterEach(async () => { await db?.dispose() })

  it.each([
    ['generation', "BEFORE UPDATE ON ai_generation_requests"],
    ['event', "BEFORE INSERT ON dispatch_job_events"],
    ['terminal', "BEFORE UPDATE ON dispatch_jobs WHEN NEW.status = 'succeeded'"],
  ])('rolls back every projection on %s failure, then accepts retry exactly once', async (_name, trigger) => {
    await db.prepare(`CREATE TRIGGER fail_receipt ${trigger} BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`).run()
    await expect(completeJob(request(), env)).rejects.toThrow()
    expect((await row('dispatch_jobs'))?.status).toBe('running')
    expect((await row('ai_generation_requests'))?.status).toBe('queued')
    expect((await row('task_machines'))?.current_job_id).toBe('job')
    expect(await row('dispatch_job_events')).toBeNull()
    await db.prepare('DROP TRIGGER fail_receipt').run()
    expect((await completeJob(request(), env)).status).toBe(200)
    // JSON key order is irrelevant to an identical receipt.
    expect((await completeJob(request({ count: 1, generated_asset_uids: ['asset'] }), env)).status).toBe(200)
    expect((await row('dispatch_jobs'))?.status).toBe('succeeded')
    expect((await row('ai_generation_requests'))?.status).toBe('completed')
    expect((await row('task_machines'))?.current_job_id).toBeNull()
    const events = await db.prepare('SELECT * FROM dispatch_job_events').all()
    expect(events.results).toHaveLength(1)
  })

  it('repairs a historical partial receipt without clearing a newer reservation', async () => {
    await db.prepare("UPDATE dispatch_jobs SET status='succeeded', result_json=?, lease_expires_at='2000'").bind(JSON.stringify(output)).run()
    await db.prepare("UPDATE task_machines SET current_job_id='new-job', health='online_busy'").run()
    expect((await completeJob(request(), env)).status).toBe(200)
    expect((await row('ai_generation_requests'))?.status).toBe('completed')
    expect((await row('task_machines'))?.current_job_id).toBe('new-job')
    expect((await row('task_machines'))?.health).toBe('online_busy')
    expect((await completeJob(request({ changed: true }), env)).status).toBe(403)
    expect((await completeJob(request(output, 'wrong-lease'), env)).status).toBe(403)
    expect((await row('dispatch_jobs'))?.result_json).toBe(JSON.stringify(output))
    await db.prepare("UPDATE task_machines SET current_job_id=NULL, health='needs_login'").run()
    expect((await completeJob(request(), env)).status).toBe(200)
    expect((await row('task_machines'))?.health).toBe('needs_login')
  })

  it('accepts a concurrent identical completion that wins after the initial read', async () => {
    let once = true
    env.DB = { ...db, batch: async (statements: D1PreparedStatement[]) => {
      if (once) {
        once = false
        await db.prepare("UPDATE dispatch_jobs SET status='succeeded', result_json=?").bind(JSON.stringify(output)).run()
      }
      return db.batch(statements)
    } } as unknown as D1Database
    expect((await completeJob(request(), env)).status).toBe(200)
    expect((await row('ai_generation_requests'))?.status).toBe('completed')
    expect((await db.prepare('SELECT COUNT(*) AS count FROM dispatch_job_events').first<{count:number}>())?.count).toBe(1)
  })

  it.each(['cancel', 'replace-lease', 'expire'])('does not project a completion when %s wins before the batch', async (race) => {
    env.DB = { ...db, batch: async (statements: D1PreparedStatement[]) => {
      const mutation = race === 'cancel' ? "cancel_requested=1, status='cancel_requested'"
        : race === 'replace-lease' ? "lease_id='new-lease'" : "lease_expires_at='2000'"
      await db.prepare(`UPDATE dispatch_jobs SET ${mutation}`).run()
      return db.batch(statements)
    } } as unknown as D1Database
    expect((await completeJob(request(), env)).status).toBe(403)
    expect((await row('ai_generation_requests'))?.status).toBe('queued')
    expect((await row('task_machines'))?.current_job_id).toBe('job')
    expect(await row('dispatch_job_events')).toBeNull()
  })

  it('commits a large submitted asset set, styles and batch atomically with the job', async () => {
    const assets = Array.from({ length: 120 }, (_, i) => ({ asset_uid: `asset-${i}`, style_id: 1, kind: 'ai' }))
    await db.prepare("UPDATE dispatch_jobs SET job_type='submit_tmall_material_test', payload_json=?")
      .bind(JSON.stringify({ submit_plan: { batch_uid: 'batch', assets } })).run()
    await db.prepare("INSERT INTO ai_image_batches (batch_uid,title,status,created_at,updated_at) VALUES ('batch','test','ready','2026','2026')").run()
    await db.prepare("INSERT INTO ai_image_styles (id,batch_uid,style_code,status) VALUES (1,'batch','style','approved')").run()
    await db.batch(assets.map(asset => db.prepare(`INSERT INTO ai_image_assets (asset_uid,batch_uid,style_id,kind,status,object_key,filename,created_at,updated_at)
      VALUES (?,'batch',1,'ai','approved','key','a.png','2026','2026')`).bind(asset.asset_uid)))
    await db.prepare("CREATE TRIGGER fail_receipt BEFORE UPDATE ON dispatch_jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'injected'); END").run()
    await expect(completeJob(request(), env)).rejects.toThrow()
    expect((await row('ai_image_batches'))?.status).toBe('ready')
    expect((await row('ai_image_styles'))?.status).toBe('approved')
    expect((await row('ai_image_assets'))?.status).toBe('approved')
    await db.prepare('DROP TRIGGER fail_receipt').run()
    expect((await completeJob(request(), env)).status).toBe(200)
    for (const table of ['ai_image_batches', 'ai_image_styles', 'ai_image_assets']) expect((await row(table))?.status).toBe('submitted')
    expect((await db.prepare("SELECT COUNT(*) AS count FROM ai_image_assets WHERE status='submitted'").first<{count: number}>())?.count).toBe(120)
    expect((await completeJob(request(), env)).status).toBe(200)
    expect((await row('dispatch_jobs'))?.status).toBe('succeeded')
  })

  it('rechecks approved assets inside the completion transaction', async () => {
    await db.prepare("UPDATE dispatch_jobs SET job_type='submit_tmall_material_test', payload_json=?")
      .bind(JSON.stringify({ submit_plan: { batch_uid: 'batch', assets: [{ asset_uid: 'asset', style_id: 1, kind: 'ai' }] } })).run()
    await db.prepare("INSERT INTO ai_image_batches (batch_uid,title,status,created_at,updated_at) VALUES ('batch','test','ready','2026','2026')").run()
    await db.prepare("INSERT INTO ai_image_styles (id,batch_uid,style_code,status) VALUES (1,'batch','style','approved')").run()
    await db.prepare(`INSERT INTO ai_image_assets (asset_uid,batch_uid,style_id,kind,status,object_key,filename,created_at,updated_at)
      VALUES ('asset','batch',1,'ai','approved','key','a.png','2026','2026')`).run()
    env.DB = { ...db, batch: async (statements: D1PreparedStatement[]) => {
      await db.prepare("UPDATE ai_image_assets SET status='rejected'").run()
      return db.batch(statements)
    } } as unknown as D1Database
    expect((await completeJob(request(), env)).status).toBe(200)
    expect((await row('dispatch_jobs'))?.status).toBe('succeeded')
    expect((await row('ai_image_batches'))?.status).toBe('ready')
    expect((await row('ai_image_assets'))?.status).toBe('rejected')
    expect((await row('ai_image_styles'))?.status).toBe('approved')
  })
})
