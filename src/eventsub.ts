import { WebSocket } from 'ws';
import { BetsEngine } from './engine.js';

export const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';
type EventSubMessage = {
  metadata?: { message_type?: string; subscription_type?: string };
  payload?: {
    session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string };
    subscription?: { type?: string; status?: string };
    event?: {
      id?: string; broadcaster_user_login?: string; user_login?: string; redeemed_at?: string;
      reward?: { id?: string; title?: string };
    };
  };
};
export type EventSubConfig = { channel: string; rewardId?: string; clientId?: string; token?: string };

// Simulation sends this same notification shape through this same parser.
export function handleEventSubMessage(message: EventSubMessage, engine: BetsEngine, config: Pick<EventSubConfig, 'channel' | 'rewardId'>): string | null {
  if (message.metadata?.message_type !== 'notification' || message.metadata.subscription_type !== REDEMPTION_TYPE || message.payload?.subscription?.type !== REDEMPTION_TYPE) return null;
  const event = message.payload.event;
  if (!event?.id || !event.user_login || !event.reward?.id || !event.reward.title || !event.redeemed_at) return null;
  if (event.broadcaster_user_login?.toLowerCase() !== config.channel.toLowerCase()) return null;
  if (config.rewardId ? event.reward.id !== config.rewardId : event.reward.title.trim().toLowerCase() !== 'double down') return null;
  const redeemedAt = Date.parse(event.redeemed_at);
  if (!Number.isFinite(redeemedAt)) return null;
  return engine.doubleDown(event.user_login, event.id, redeemedAt);
}

export function mockDoubleDown(user: string, redemptionId: string, channel: string): EventSubMessage {
  return {
    metadata: { message_type: 'notification', subscription_type: REDEMPTION_TYPE },
    payload: {
      subscription: { type: REDEMPTION_TYPE },
      event: { id: redemptionId, broadcaster_user_login: channel, user_login: user, redeemed_at: new Date().toISOString(), reward: { id: 'mock-double-down', title: 'Double down' } },
    },
  };
}

async function validateToken(token: string, clientId: string, channel: string): Promise<string> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Twitch token validation returned HTTP ${response.status}`);
  const info = await response.json() as { client_id?: string; login?: string; user_id?: string; scopes?: string[] };
  if (info.client_id !== clientId) throw new Error('EventSub token does not belong to TWITCH_CLIENT_ID');
  if (info.login?.toLowerCase() !== channel.toLowerCase() || !info.user_id) throw new Error('EventSub token must belong to the broadcaster channel');
  if (!info.scopes?.some(scope => scope === 'channel:read:redemptions' || scope === 'channel:manage:redemptions')) throw new Error('EventSub token needs channel:read:redemptions or channel:manage:redemptions');
  return info.user_id;
}

export async function startEventSub(engine: BetsEngine, config: EventSubConfig): Promise<void> {
  const { channel, clientId, token, rewardId } = config;
  if (!clientId || !token) {
    if (clientId || token) console.warn('EventSub disabled: set both TWITCH_CLIENT_ID and TWITCH_EVENTSUB_TOKEN.');
    else console.log('EventSub disabled; set TWITCH_CLIENT_ID and TWITCH_EVENTSUB_TOKEN to enable Double down.');
    return;
  }
  const cleanToken = token.replace(/^oauth:/i, '');
  let broadcasterId: string;
  try { broadcasterId = await validateToken(cleanToken, clientId, channel); }
  catch (error) { console.error('EventSub disabled:', (error as Error).message); return; }

  let active: WebSocket | null = null;
  let transfer: WebSocket | null = null;
  let retryMs = 1000;
  let retryTimer: NodeJS.Timeout | null = null;
  let enabled = true;

  const subscribe = async (sessionId: string) => {
    const condition: { broadcaster_user_id: string; reward_id?: string } = { broadcaster_user_id: broadcasterId };
    if (rewardId) condition.reward_id = rewardId;
    const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cleanToken}`, 'Client-Id': clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: REDEMPTION_TYPE, version: '1', condition, transport: { method: 'websocket', session_id: sessionId } }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 202) throw new Error(`EventSub subscription returned HTTP ${response.status}`);
    console.log('EventSub Double down subscription active.');
  };

  const scheduleReconnect = () => {
    if (!enabled || retryTimer) return;
    console.warn(`EventSub disconnected. Reconnecting in ${retryMs / 1000}s.`);
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      try { await validateToken(cleanToken, clientId, channel); connect('wss://eventsub.wss.twitch.tv/ws'); }
      catch (error) { console.warn('EventSub reconnect:', (error as Error).message); scheduleReconnect(); }
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  };

  const connect = (url: string, prior?: WebSocket) => {
    const socket = new WebSocket(url);
    if (prior) transfer = socket;
    else active = socket;
    let silenceTimer: NodeJS.Timeout | null = null;
    let keepaliveSeconds = 30;
    const armTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => { console.warn('EventSub keepalive timed out.'); socket.close(); }, (keepaliveSeconds + 5) * 1000);
    };
    socket.on('message', raw => {
      let message: EventSubMessage;
      try { message = JSON.parse(raw.toString()) as EventSubMessage; }
      catch { console.warn('Ignored malformed EventSub message.'); return; }
      if (typeof message.payload?.session?.keepalive_timeout_seconds === 'number') keepaliveSeconds = message.payload.session.keepalive_timeout_seconds;
      armTimer();
      const type = message.metadata?.message_type;
      if (type === 'session_welcome') {
        const sessionId = message.payload?.session?.id;
        if (!sessionId) { socket.close(); return; }
        retryMs = 1000;
        if (prior) { active = socket; transfer = null; prior.close(); console.log('EventSub reconnected with subscription retained.'); }
        else void subscribe(sessionId).catch(error => { console.warn((error as Error).message); socket.close(); });
      } else if (type === 'session_reconnect') {
        const reconnectUrl = message.payload?.session?.reconnect_url;
        if (reconnectUrl && socket === active && !transfer) connect(reconnectUrl, socket);
      } else if (type === 'notification') {
        const result = handleEventSubMessage(message, engine, { channel, rewardId });
        if (result) console.log(`[eventsub] ${result}`);
      } else if (type === 'revocation') {
        console.warn('EventSub subscription revoked:', message.payload?.subscription?.status || 'unknown reason');
      }
    });
    socket.on('error', error => console.warn('EventSub WebSocket:', error.message));
    socket.on('close', () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (socket === transfer) { transfer = null; if (active?.readyState === WebSocket.OPEN) active.close(); }
      else if (socket === active) { active = null; if (!transfer) scheduleReconnect(); }
    });
  };

  connect('wss://eventsub.wss.twitch.tv/ws');
  setInterval(async () => {
    if (!enabled) return;
    try { await validateToken(cleanToken, clientId, channel); }
    catch (error) {
      enabled = false;
      if (retryTimer) clearTimeout(retryTimer);
      active?.close(); transfer?.close();
      console.error('EventSub disabled after token validation failed:', (error as Error).message);
    }
  }, 60 * 60 * 1000);
}
