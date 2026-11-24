import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { buildHostInstruction, isAllowedUpgrade } from './live.ts';

test('the host instruction carries the theme and the controller protocol', () => {
  const instruction = buildHostInstruction('The 90s');
  assert.match(instruction, /The 90s Name That Tune party game/);
  assert.match(instruction, /\[SAY\]/);
  assert.match(instruction, /\[IMPROV\]/);
  assert.match(instruction, /never judge answers/);
  assert.match(buildHostInstruction(undefined), /Name That Tune party game/);
});

test('only same-origin upgrades are allowed', () => {
  const request = (headers: Record<string, string>) => ({ headers } as unknown as IncomingMessage);
  assert.equal(isAllowedUpgrade(request({ host: 'localhost:3000', origin: 'http://localhost:3000' })), true);
  assert.equal(isAllowedUpgrade(request({ host: 'localhost:3000', origin: 'https://evil.example' })), false);
  assert.equal(isAllowedUpgrade(request({ host: 'localhost:3000' })), false);
  assert.equal(isAllowedUpgrade(request({ host: 'localhost:3000', origin: 'not a url' })), false);
});
