import test from 'node:test'
import assert from 'node:assert/strict'
import {usageView} from './managedUsage.mjs'
test('quota conversion uses server units and exchange rate, not raw token counts',()=>{const view=usageView({data:{total_available:400000,total_used:100000,total_granted:500000},billing:{quotaPerUnit:500000,exchangeRate:7.3}});assert.equal(view.percent,80);assert.equal(view.remaining,'¥5.84');assert.equal(view.used,'¥1.46')})
test('missing, unlimited and exhausted usage remain distinct',()=>{assert.equal(usageView(null).percent,null);assert.equal(usageView(null).remaining,'—');assert.equal(usageView({data:{unlimited_quota:true,total_granted:5,total_available:5}}).percent,null);assert.equal(usageView({data:{total_granted:10,total_available:0}}).percent,0);assert.equal(usageView({data:{total_granted:0,total_available:0}}).percent,null)})
