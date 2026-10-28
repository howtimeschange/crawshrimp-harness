import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {SessionStateStore} from './session-state.js';
test('plugin Session state restores independently, isolates scopes and rejects stale writers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cs-session-state-')),path=join(dir,'state.sqlite');
 try {const store=new SessionStateStore(path),a=store.scope('w','a','memory'),peer=store.scope('w','b','memory');
 const input={recallIds:['a']};assert.equal(a.set(input),1);input.recallIds.push('mutated');assert.deepEqual(new SessionStateStore(path).scope('w','a','memory').get(),{revision:1,value:{recallIds:['a']}});assert.equal(peer.get(),undefined);assert.equal(store.scope('other','a','memory').get(),undefined);assert.equal(store.scope('w','a','tools').get(),undefined);
 assert.throws(()=>a.set({}),/conflict/);assert.equal(a.set({recallIds:[]},{expectedRevision:1}),2);assert.equal(a.get(2),undefined);assert.throws(()=>a.set({},{version:2,expectedRevision:2}),/conflict/);assert.equal(a.get().revision,2);assert.equal(a.delete(1),false);assert.equal(a.delete(2),true);assert.equal(a.get(),undefined);
 for(const invalid of [undefined,BigInt(1),{x:NaN}])assert.throws(()=>a.set(invalid));assert.throws(()=>a.set('x'.repeat(65537)),/64 KiB/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
