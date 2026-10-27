import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { BetsEngine } from './engine.js';
import { handleEventSubMessage, mockDoubleDown, startEventSub } from './eventsub.js';

const simulate = process.argv.includes('--simulate');
const port = Number(process.env.PORT || 3000);
const channel = (process.env.TWITCH_CHANNEL || '').replace(/^#/, '').toLowerCase();
const streamer = (process.env.TWITCH_STREAMER_USERNAME || channel || 'streamer').toLowerCase();
const dataFile = process.env.DATA_FILE || './data/state.json';
const engine = new BetsEngine(dataFile, simulate);
const overlay = readFileSync(fileURLToPath(new URL('../public/overlay.html', import.meta.url)));

const server = createServer((request, response) => {
  const path = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
  if (path === '/overlay' || path === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    response.end(overlay);
  } else if (path === '/api/state') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(engine.snapshot()));
  } else if (path === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, simulate, channel: simulate ? null : channel }));
  } else if (path === '/favicon.ico') {
    response.writeHead(204); response.end();
  } else {
    response.writeHead(404); response.end('Not found');
  }
});
const wss = new WebSocketServer({ server, path: '/ws' });
engine.subscribe(snapshot => {
  const payload = JSON.stringify({ type: 'state', ...snapshot });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
});
wss.on('connection', socket => socket.send(JSON.stringify({ type: 'state', ...engine.snapshot() })));
setInterval(() => engine.tick(), 250);

function connectTwitch() {
  const user = process.env.TWITCH_BOT_USERNAME?.toLowerCase();
  const token = process.env.TWITCH_BOT_TOKEN;
  if (!channel || !user || !token) {
    console.error('Live mode needs TWITCH_CHANNEL, TWITCH_BOT_USERNAME, and TWITCH_BOT_TOKEN. See .env.example.');
    process.exitCode = 1;
    server.close();
    return;
  }
  let retryMs = 1000;
  const connect = () => {
    const irc = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    irc.on('open', () => {
      retryMs = 1000;
      irc.send(`PASS ${token.startsWith('oauth:') ? token : `oauth:${token}`}\r\nNICK ${user}\r\nJOIN #${channel}\r\nCAP REQ :twitch.tv/tags twitch.tv/commands\r\n`);
      console.log(`Connected to Twitch IRC #${channel}`);
    });
    irc.on('message', chunk => {
      for (const line of chunk.toString().split('\r\n')) {
        if (line.startsWith('PING ')) { irc.send(line.replace('PING', 'PONG')); continue; }
        const match = line.match(/^(?:@[^ ]+ )?:([^! ]+)!.* PRIVMSG #[^ ]+ :(.+)$/);
        if (!match) continue;
        const reply = engine.handleMessage(match[1], match[2], streamer);
        if (reply && irc.readyState === WebSocket.OPEN) irc.send(`PRIVMSG #${channel} :${reply}\r\n`);
      }
    });
    irc.on('error', error => console.warn('Twitch IRC:', error.message));
    irc.on('close', () => {
      console.warn(`Twitch IRC disconnected. Reconnecting in ${retryMs / 1000}s.`);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    });
  };
  connect();
}

function startSimulator() {
  const interrupted = engine.snapshot().round;
  if (interrupted && interrupted.phase !== 'resolved') {
    console.log(`[simulate] Completing interrupted prediction #${interrupted.id}`);
    engine.resolve(interrupted.options[0]);
  }
  const viewers = ['pixelpanda', 'neonfox', 'cozybyte', 'lunaloot', 'glitchwitch', 'mossy', 'starcaptain', 'orbitalsam', 'mellowmint', 'arcadekid', 'peachmode', 'voidwalker'];
  const rounds = [
    { question: 'Will I win this round?', options: ['yes', 'no'], winner: 'yes' },
    { question: 'Will we beat the boss first try?', options: ['clutch', 'wipe'], winner: 'clutch' },
    { question: 'Will the next chest have a legendary?', options: ['drop', 'dud'], winner: 'dud' },
  ];
  let turn = 0;
  const run = () => {
    const round = rounds[turn++ % rounds.length];
    console.log(`[simulate] ${engine.open(round.question, round.options, 40_000)}`);
    const roundId = engine.snapshot().round!.id;
    setTimeout(() => console.log(`[simulate EventSub] ${handleEventSubMessage(mockDoubleDown('lunaloot', `mock-${roundId}-lunaloot`, 'demo'), engine, { channel: 'demo' })}`), 1000);
    setTimeout(() => console.log(`[simulate EventSub] ${handleEventSubMessage(mockDoubleDown('pixelpanda', `mock-${roundId}-pixelpanda`, 'demo'), engine, { channel: 'demo' })}`), 9000);
    viewers.forEach((viewer, index) => {
      setTimeout(() => {
        const choice = round.options[(index * 7 + turn) % round.options.length];
        console.log(`[simulate] ${engine.call(viewer, choice)}`);
      }, 1800 + index * 2600);
    });
    setTimeout(() => console.log(`[simulate] ${engine.resolve(round.winner)}`), 52_000);
  };
  run();
  setInterval(run, 64_000);
}

server.listen(port, () => {
  console.log(`Chat Bets ${simulate ? 'SIMULATE' : 'LIVE'} at http://localhost:${port}/overlay`);
  if (simulate) startSimulator();
  else {
    connectTwitch();
    void startEventSub(engine, {
      channel, clientId: process.env.TWITCH_CLIENT_ID, token: process.env.TWITCH_EVENTSUB_TOKEN,
      rewardId: process.env.TWITCH_DOUBLE_DOWN_REWARD_ID,
    });
  }
});
