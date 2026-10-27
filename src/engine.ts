import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Phase = 'open' | 'locked' | 'resolved';
export type Call = { user: string; option: string; stake: number; at: number; doubled?: boolean };
export type Round = {
  id: number; question: string; options: string[]; phase: Phase;
  openedAt: number; closesAt: number; winner?: string; calls: Call[];
  armedDoubles?: string[]; doubleDownUsers?: string[];
};
type Stored = { balances: Record<string, number>; round: Round | null; nextId: number; processedRedemptions?: string[] };
export type Snapshot = {
  round: Round | null; leaderboard: { user: string; points: number }[];
  totals: { option: string; calls: number; points: number; percent: number }[];
  lastCalls: Call[]; event: string; serverNow: number; simulate: boolean;
};

const STARTING_POINTS = 100;
const BASE_STAKE = 10;
const OPEN_MS = 45_000;
const login = (value: string) => value.toLowerCase().replace(/^#/, '').trim();

export class BetsEngine {
  private data: Stored = { balances: {}, round: null, nextId: 1 };
  private event = 'Waiting for the next prediction';
  private listeners = new Set<(snapshot: Snapshot) => void>();

  constructor(private file: string, readonly simulate: boolean) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Stored;
      if (saved && typeof saved.nextId === 'number' && saved.balances && typeof saved.balances === 'object') this.data = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not load saved state:', error);
    }
  }

  subscribe(listener: (snapshot: Snapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); }

  snapshot(): Snapshot {
    const round = this.data.round;
    const totals = (round?.options ?? []).map(option => ({
      option, calls: round!.calls.filter(call => call.option === option).length,
      points: round!.calls.filter(call => call.option === option).reduce((n, call) => n + call.stake, 0),
      percent: 0,
    }));
    const sum = totals.reduce((n, item) => n + item.points, 0);
    for (const item of totals) item.percent = sum ? Math.round(item.points / sum * 100) : Math.round(100 / Math.max(1, totals.length));
    return {
      round, totals, lastCalls: [...(round?.calls ?? [])].sort((a, b) => b.at - a.at).slice(0, 5),
      leaderboard: Object.entries(this.data.balances).map(([user, points]) => ({ user, points })).sort((a, b) => b.points - a.points || a.user.localeCompare(b.user)).slice(0, 5),
      event: this.event, serverNow: Date.now(), simulate: this.simulate,
    };
  }

  private publish(message: string) {
    this.event = message;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2));
    renameSync(temp, this.file);
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  tick() {
    const round = this.data.round;
    if (round?.phase === 'open' && Date.now() >= round.closesAt) this.lock();
  }

  open(question: string, options: string[], durationMs = OPEN_MS): string {
    question = question.trim().slice(0, 140);
    options = options.map(option => login(option).slice(0, 24));
    if (!question || options.length < 2 || options.length > 4 || options.some(option => !/^[a-z0-9_-]+$/.test(option)) || new Set(options).size !== options.length)
      return 'Usage: !open "Question?" option1 option2 [option3 option4]';
    if (this.data.round?.phase === 'open' || this.data.round?.phase === 'locked') return 'Resolve the current prediction first.';
    const now = Date.now();
    this.data.round = { id: this.data.nextId++, question, options, phase: 'open', openedAt: now, closesAt: now + durationMs, calls: [], armedDoubles: [], doubleDownUsers: [] };
    this.publish(`Prediction open · !call ${options[0]}`);
    return `Prediction #${this.data.round.id} open: ${question} (${options.join(' / ')})`;
  }

  call(userName: string, optionName: string): string {
    this.tick();
    const round = this.data.round;
    const user = login(userName), option = login(optionName);
    if (!round || round.phase !== 'open') return 'No prediction is accepting calls.';
    if (!round.options.includes(option)) return `Choose: ${round.options.join(' / ')}`;
    if (round.calls.some(call => call.user === user)) return 'One call per viewer per prediction.';
    const doubled = round.armedDoubles?.includes(user) ?? false;
    const stake = BASE_STAKE * (doubled ? 2 : 1);
    const balance = this.data.balances[user] ?? STARTING_POINTS;
    if (balance < stake) return `You need ${stake} play points to call.`;
    this.data.balances[user] = balance - stake;
    if (doubled) round.armedDoubles = round.armedDoubles?.filter(name => name !== user);
    round.calls.push({ user, option, stake, at: Date.now(), doubled });
    this.publish(doubled ? `⚡ ${user} doubled down on ${option.toUpperCase()} · ${stake} play points` : `${user} called ${option}`);
    return `${user} called ${option} for ${stake} play points.`;
  }

  doubleDown(userName: string, redemptionId: string, redeemedAt = Date.now()): string {
    this.tick();
    const user = login(userName);
    if (!user || !redemptionId) return 'Invalid Double down redemption.';
    this.data.processedRedemptions ??= [];
    if (this.data.processedRedemptions.includes(redemptionId)) return 'Duplicate Double down redemption ignored.';
    this.data.processedRedemptions.push(redemptionId);
    this.data.processedRedemptions = this.data.processedRedemptions.slice(-500);
    const round = this.data.round;
    if (!round || round.phase !== 'open' || redeemedAt < round.openedAt || redeemedAt >= round.closesAt) {
      this.publish(`Double down from ${user} arrived outside an open round`);
      return 'Double down only applies during an open round.';
    }
    round.doubleDownUsers ??= [];
    round.armedDoubles ??= [];
    if (round.doubleDownUsers.includes(user)) {
      this.publish(`${user} already used Double down this round`);
      return 'One Double down per viewer per round.';
    }
    round.doubleDownUsers.push(user);
    const call = round.calls.find(item => item.user === user);
    const balance = this.data.balances[user] ?? STARTING_POINTS;
    const required = call ? BASE_STAKE : BASE_STAKE * 2;
    if (balance < required) {
      this.publish(`${user} needs ${required} play points for Double down`);
      return `Not enough play points to Double down (${required} needed).`;
    }
    if (call) {
      this.data.balances[user] = balance - BASE_STAKE;
      call.stake += BASE_STAKE;
      call.doubled = true;
      call.at = Date.now();
      this.publish(`⚡ ${user} doubled down on ${call.option.toUpperCase()} · ${call.stake} play points`);
      return `${user} doubled ${call.option} to ${call.stake} play points.`;
    }
    round.armedDoubles.push(user);
    this.publish(`⚡ ${user} armed Double down · next call costs 20 play points`);
    return `${user} armed Double down for their next call this round.`;
  }

  lock(): string {
    const round = this.data.round;
    if (!round || round.phase !== 'open') return 'No open prediction to lock.';
    round.phase = 'locked';
    round.closesAt = Date.now();
    this.publish('Calls locked · awaiting result');
    return `Prediction #${round.id} locked.`;
  }

  resolve(optionName: string): string {
    const round = this.data.round;
    const option = login(optionName);
    if (!round || round.phase === 'resolved') return 'No active prediction to resolve.';
    if (!round.options.includes(option)) return `Choose: ${round.options.join(' / ')}`;
    if (round.phase === 'open') this.lock();
    round.phase = 'resolved';
    round.winner = option;
    for (const call of round.calls) if (call.option === option) this.data.balances[call.user] += call.stake * 2;
    this.publish(`${option.toUpperCase()} wins · points paid out`);
    return `Prediction #${round.id} resolved: ${option}.`;
  }

  handleMessage(user: string, message: string, streamer: string): string | null {
    const line = message.trim();
    if (!line.startsWith('!')) return null;
    const isStreamer = login(user) === login(streamer);
    if (/^!open\b/i.test(line)) {
      if (!isStreamer) return 'Only the streamer can open predictions.';
      const match = line.match(/^!open\s+"([^"]+)"\s+(.+)$/i);
      return match ? this.open(match[1], match[2].trim().split(/\s+/)) : 'Usage: !open "Question?" yes no';
    }
    if (/^!lock\s*$/i.test(line)) return isStreamer ? this.lock() : 'Only the streamer can lock predictions.';
    const resolve = line.match(/^!resolve\s+(\S+)\s*$/i);
    if (resolve) return isStreamer ? this.resolve(resolve[1]) : 'Only the streamer can resolve predictions.';
    const call = line.match(/^!call\s+(\S+)\s*$/i);
    if (call) return this.call(user, call[1]);
    if (/^!points\s*$/i.test(line)) return `${login(user)} has ${this.data.balances[login(user)] ?? STARTING_POINTS} play points.`;
    return null;
  }
}
