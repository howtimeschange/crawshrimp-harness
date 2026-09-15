import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskLogCursor } from './taskLogCursor.js'
test('incremental logs, epoch reset, legacy response and bounds', () => {
 const cursor=createTaskLogCursor()
 assert.deepEqual(cursor.query(),{epoch:''})
 assert.deepEqual(cursor.apply({logs:['a'],cursor:1,epoch:'one',reset:true}),['a'])
 assert.deepEqual(cursor.apply({logs:['b'],cursor:2,epoch:'one'}),['a','b'])
 assert.deepEqual(cursor.apply({logs:[],cursor:2,epoch:'one'}),['a','b'])
 assert.deepEqual(cursor.apply({logs:['c'],cursor:1,epoch:'two',reset:true}),['c'])
 assert.equal(cursor.apply({logs:Array(5000).fill('x')}).length,2000)
 cursor.reset(); assert.deepEqual(cursor.query(),{epoch:''})
})
