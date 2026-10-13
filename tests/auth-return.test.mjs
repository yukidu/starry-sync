import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnTo, readLoginContext} from '../worker/authReturn.ts';
import {socialRoute} from '../worker/social.ts';

test('OAuth return destination only permits known app pages',()=>{
  assert.equal(safeReturnTo('/?page=short'),'/?page=short');
  for(const input of ['https://evil.example','//evil.example','/\\evil.example','/?page=short&next=https://evil.example','/api/auth/meta/start',null])assert.equal(safeReturnTo(input),'/');
  assert.deepEqual(readLoginContext(null),{returnTo:'/',origin:undefined});
  assert.equal(readLoginContext('{broken').returnTo,'/');
  assert.deepEqual(readLoginContext('{"returnTo":"/?page=short","origin":"https://sync.starry.phd"}'),{returnTo:'/?page=short',origin:'https://sync.starry.phd'});
});
test('Meta and Threads start redirect logged-out users without starting OAuth',async()=>{
  for(const provider of ['meta','threads']){
    const r=await socialRoute(new Request(`https://sync.starry.phd/api/auth/${provider}/start`),{DB:{prepare(){throw Error('must not create OAuth state')}}});
    assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/?page=short&login_required=1');
  }
});
test('Expired admin sessions receive the same login redirect',async()=>{
  const env={ADMIN_EMAIL:'admin@example.test',DB:{prepare(){return {bind(){return this},first:async()=>({email:'admin@example.test',expires_at:1})}}}};
  const r=await socialRoute(new Request('https://sync.starry.phd/api/auth/meta/start',{headers:{Cookie:'svs_session=expired'}}),env);
  assert.equal(r.headers.get('location'),'/?page=short&login_required=1');
});
test('Protected APIs keep returning 401 instead of bypassing authentication',async()=>{
  await assert.rejects(()=>socialRoute(new Request('https://sync.starry.phd/api/meta/pages'),{}),e=>e instanceof Response&&e.status===401);
});
