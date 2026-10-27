import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetsEngine } from '../src/engine.js';

test('streamer authority, one call per viewer, settlement, and saved balances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-bets-'));
  try {
    const file = join(dir, 'state.json');
    const game = new BetsEngine(file, true);
    assert.match(game.handleMessage('viewer', '!open "Win?" yes no', 'streamer')!, /Only the streamer/);
    assert.match(game.handleMessage('streamer', '!open "Win?" yes no', 'streamer')!, /open/);
    assert.match(game.handleMessage('alice', '!call yes', 'streamer')!, /10 play points/);
    assert.match(game.handleMessage('alice', '!call no', 'streamer')!, /One call/);
    assert.match(game.handleMessage('bob', '!call no', 'streamer')!, /10 play points/);
    assert.match(game.handleMessage('viewer', '!resolve yes', 'streamer')!, /Only the streamer/);
    assert.match(game.handleMessage('streamer', '!lock', 'streamer')!, /locked/);
    assert.match(game.handleMessage('cara', '!call yes', 'streamer')!, /No prediction/);
    assert.match(game.handleMessage('streamer', '!resolve yes', 'streamer')!, /resolved/);
    const reloaded = new BetsEngine(file, false).snapshot();
    assert.equal(reloaded.round?.phase, 'resolved');
    assert.equal(reloaded.round?.winner, 'yes');
    assert.deepEqual(reloaded.leaderboard.map(x => [x.user, x.points]), [['alice', 110], ['bob', 90]]);
    assert.equal(reloaded.totals.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
