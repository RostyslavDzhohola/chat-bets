import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetsEngine } from '../src/engine.js';
import { handleEventSubMessage, mockDoubleDown } from '../src/eventsub.js';

test('mock EventSub Double down works before and after a call, persists, and pays doubled stakes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-bets-eventsub-'));
  try {
    const file = join(dir, 'state.json');
    const game = new BetsEngine(file, true);
    game.open('Win?', ['yes', 'no']);
    const config = { channel: 'demo' };
    const before = mockDoubleDown('alice', 'redemption-alice', 'demo');
    assert.match(handleEventSubMessage(before, game, config)!, /armed/);
    assert.match(game.call('alice', 'yes'), /20 play points/);
    assert.match(game.call('bob', 'no'), /10 play points/);
    const after = mockDoubleDown('bob', 'redemption-bob', 'demo');
    assert.match(handleEventSubMessage(after, game, config)!, /doubled/);
    assert.match(handleEventSubMessage(after, game, config)!, /Duplicate/);
    assert.equal(game.snapshot().round?.calls.filter(call => call.doubled).length, 2);
    assert.deepEqual(game.snapshot().totals.map(item => item.points), [20, 20]);
    game.resolve('yes');
    const saved = new BetsEngine(file, false).snapshot();
    assert.deepEqual(saved.leaderboard.map(item => [item.user, item.points]), [['alice', 120], ['bob', 80]]);
    assert.equal(saved.round?.calls[0].doubled, true);
    assert.equal(saved.round?.calls[1].doubled, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ignores other rewards and channels, and does not apply after lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-bets-eventsub-'));
  try {
    const game = new BetsEngine(join(dir, 'state.json'), true);
    game.open('Win?', ['yes', 'no']);
    const config = { channel: 'demo' };
    assert.equal(handleEventSubMessage(mockDoubleDown('alice', 'wrong-channel', 'other'), game, config), null);
    assert.equal(handleEventSubMessage(mockDoubleDown('alice', 'wrong-reward', 'demo'), game, { channel: 'demo', rewardId: 'real-id' }), null);
    const stale = mockDoubleDown('alice', 'stale-redemption', 'demo');
    stale.payload!.event!.redeemed_at = new Date(Date.now() - 60_000).toISOString();
    assert.match(handleEventSubMessage(stale, game, config)!, /only applies during an open round/);
    game.call('alice', 'yes');
    game.lock();
    assert.match(handleEventSubMessage(mockDoubleDown('alice', 'too-late', 'demo'), game, config)!, /only applies during an open round/);
    assert.equal(game.snapshot().round?.calls[0].stake, 10);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
