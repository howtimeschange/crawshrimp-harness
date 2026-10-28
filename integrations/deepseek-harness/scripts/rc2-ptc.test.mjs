import test from 'node:test';import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import Fs from '@deepseek-ai/dsh-fs-local';import Subprocess from '@deepseek-ai/dsh-subprocess-local';import Sandbox from '@deepseek-ai/dsh-sandbox-local';import Policy from '@deepseek-ai/dsh-sandbox-policy';import Projections from '@deepseek-ai/dsh-session-projection';import Ptc from '@deepseek-ai/dsh-ptc-runtime-node';
test('persistent PTC retains one owner, isolates peers, cancels and releases',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cs-rc2-ptc-')),ctx=new Context(),outside=await mkdtemp(join(process.cwd(),'.rc2-sandbox-test-'));
 try {await ctx.plugin(Projections);await ctx.plugin(Fs);await ctx.plugin(Subprocess);await ctx.plugin(Sandbox);await ctx.plugin(Policy,{mode:'workspace-write',workspaceRoot:dir});await ctx.plugin(Ptc,{executionMode:'persistent-in-memory'});
 const owner={},other={};const run=(program,stateOwner=owner,signal)=>ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({program,stateOwner,bindings:[],cwd:dir,signal,timeoutMs:3000}));
 const first=await run('var remembered = 7319; remembered');assert.equal(first.value,7319,JSON.stringify(first));
 const second=await run('remembered + 1');assert.equal(second.value,7320);
 const isolated=await run('typeof remembered',other);assert.equal(isolated.value,'undefined');
 const c=new AbortController();const pending=run('await new Promise(() => {})',owner,c.signal);setTimeout(()=>c.abort('test cancel'),50);const stopped=await pending;assert.equal(stopped.error?.kind,'abort',JSON.stringify(stopped));
 const denied=await run(`await (await import("node:fs/promises")).writeFile(${JSON.stringify(join(outside,'forbidden'))}, "denied")`,other);assert.ok(denied.error,JSON.stringify(denied));
 await ctx.ptcRuntime.release(owner);assert.equal((await run('typeof remembered')).value,'undefined');
 }finally{await ctx.fiber.dispose();await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
