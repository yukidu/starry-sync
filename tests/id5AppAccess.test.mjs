import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const policy=read('worker/centralAppAccess.ts');
const wrapper=read('worker/starrySsoWrapper.ts');
test('Sync validates both incoming tickets and existing admin sessions',()=>{
 assert.match(wrapper,/checkCentralAppEntitlement\(env\.STARRY_ID_DB,String\(row\.userId\),APP_ID\)/);
 assert.match(wrapper,/checkCentralAppEntitlement\(env\.STARRY_ID_DB,String\(member\.id\),APP_ID\)/);
 assert.match(wrapper,/您沒有使用權限/);
 assert.match(wrapper,/url\.pathname\.startsWith\('\/api\/'\)/);
});
test('Sync central D1 explicitly blocks revoked and new unapproved memberships',()=>{
 assert.match(policy,/row\.decision==='deny'/);
 assert.match(policy,/row\.decision==='allow'/);
 assert.match(policy,/STARRY_APP_GRANT_CUTOFF/);
});
