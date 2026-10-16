import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('繁星同步使用 Starry ID 中央狀態與一次性票證，不共用敏感 Cookie', async () => {
  const frontend = await read('src/starrySso.ts');
  const worker = await read('worker/starrySso.ts');
  assert.match(frontend, /https:\/\/id\.starry\.phd\/api\/ecosystem\/session/);
  assert.match(frontend, /\/api\/apps\/starry-sync\/ticket/);
  assert.match(frontend, /appId: 'starry-sync'/);
  assert.match(worker, /\/api\/apps\/starry-sync\/exchange/);
  assert.match(worker, /STARRY_ECOSYSTEM/);
  assert.doesNotMatch(frontend + worker, /Domain=\.starry\.phd/i);
});

test('繁星同步登出只清除繁星 Session，不刪除影音平台 token', async () => {
  const worker = await read('worker/starrySso.ts');
  const frontend = await read('src/starrySso.ts');
  assert.match(worker, /DELETE FROM admin_sessions/);
  assert.doesNotMatch(worker, /DELETE FROM platform_tokens/);
  assert.match(frontend, /Promise\.allSettled\(\[localLogout\(\), centralLogout\(\)\]\)/);
});

test('Cloudflare Worker 先經繁星 SSO 外層並使用 service binding', async () => {
  const wrangler = await read('wrangler.toml');
  const entry = await read('worker/starrySsoEntry.ts');
  assert.match(wrangler, /main = "worker\/starrySsoEntry\.ts"/);
  assert.match(wrangler, /binding = "STARRY_ECOSYSTEM"/);
  assert.match(wrangler, /service = "echostars"/);
  assert.match(entry, /handleStarrySyncSso/);
  assert.match(entry, /\.\/aiRouter/);
});

test('YouTube 平台授權仍保留，但未登入繁星帳號時先回到繁星登入', async () => {
  const worker = await read('worker/starrySso.ts');
  assert.match(worker, /\/api\/auth\/youtube\/start/);
  assert.match(worker, /\?starry=required/);
});
