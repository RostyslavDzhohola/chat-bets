# Chat Bets

A Twitch chat prediction game with **play points only**. The streamer opens a question, viewers call an outcome, and an OBS browser source shows live odds, a countdown, recent calls, and a top-five leaderboard. No real money, Twitch Channel Points, purchase, or account linking is needed for the core game.

## Quick demo

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run simulate
```

Open **http://localhost:3000/overlay**. The simulator opens a new prediction every 64 seconds, posts calls from fake viewers, locks at 42 seconds, and resolves at 52 seconds. It also feeds two fake EventSub Double down redemptions into each round: one before a viewer calls and one after. The overlay marks boosted calls with `×2`. It cycles through three questions. Set `PORT=4317` (or another port) before the command to change the address. Simulation data persists in `./data/state.json`; delete that file for a fresh leaderboard.

## OBS setup

1. Start the service on the machine running OBS.
2. In OBS, add a **Browser Source** with URL `http://localhost:3000/overlay`.
3. Set width **1920** and height **1080**. The overlay has a transparent page background and sits in the upper left. Resize or move the source in OBS as needed.
4. Enable **Shutdown source when not visible** only if you prefer OBS to reconnect the overlay when shown. The page reconnects automatically if its websocket drops.

## Live Twitch chat

Obtain a bot user OAuth token with `chat:read` and `chat:edit` scopes for the bot account, as described in the [official Twitch IRC guide](https://dev.twitch.tv/docs/chat/irc/). Keep it private. `.env.example` lists all environment variables for reference; export the live-mode values in your shell (this app intentionally does not auto-load `.env`):

```bash
export TWITCH_CHANNEL=your_channel
export TWITCH_STREAMER_USERNAME=your_channel
export TWITCH_BOT_USERNAME=your_bot_account
export TWITCH_BOT_TOKEN=oauth:your_bot_oauth_token
npm start
```

Use a separate bot account if desired. The channel name and streamer login are compared case insensitively. The bot joins Twitch IRC over TLS WebSocket and reconnects after a disconnect. `PORT` and `DATA_FILE` are optional environment variables.

### Optional Double down reward

For live redemptions, create a custom Channel Points reward named exactly **Double down** in the broadcaster's Twitch account. Export `TWITCH_CLIENT_ID` for the Twitch application and `TWITCH_EVENTSUB_TOKEN` as a **broadcaster user access token** with `channel:read:redemptions` or `channel:manage:redemptions`. The token's client ID must match `TWITCH_CLIENT_ID`. If a reward ID is known, set `TWITCH_DOUBLE_DOWN_REWARD_ID` to match that reward instead of relying on its title. `TWITCH_CLIENT_SECRET` is only for obtaining a token through an OAuth flow; this running app does not read it. See Twitch's [EventSub subscription](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchannel_points_custom_reward_redemptionadd) and [WebSocket](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) documentation.

```bash
export TWITCH_CLIENT_ID=your_app_client_id
export TWITCH_EVENTSUB_TOKEN=your_broadcaster_user_token
# Optional: export TWITCH_DOUBLE_DOWN_REWARD_ID=your_custom_reward_id
npm start
```

The service validates that token, opens one EventSub WebSocket, subscribes to custom reward redemption events, and reconnects if the socket drops. The reward is optional; chat predictions work without it. The app does not create, price, fulfill, or refund Channel Points rewards. Any Channel Points cost is set in Twitch by the broadcaster; no Channel Points are required for ordinary `!call` play.

### Chat commands

| Who | Command | Effect |
| --- | --- | --- |
| Streamer | `!open "Will I win this round?" yes no` | Open a 45-second prediction with 2–4 unique options |
| Viewer | `!call yes` | Risk 10 play points on one option, once per round |
| Viewer | `!points` | Show their balance in chat |
| Streamer | `!lock` | Stop accepting calls |
| Streamer | `!resolve yes` | Mark the winner and pay correct calls 20 points total |

Each viewer starts with 100 play points at their first call. A call deducts 10; a correct call then returns 20, for a net gain of 10. An incorrect call loses the 10. Leaderboard balances and the current round are saved atomically to a local JSON file. Odds reflect the share of play points called on each option, not a probability forecast.

During an open round, a Double down redemption doubles one viewer's call from 10 to **20 play points**. If the viewer already called, it deducts 10 more play points and boosts that call. If they have not called yet, it arms their next call in this round for 20 play points. A correct doubled call returns 40, for a net gain of 20; an incorrect one loses 20. Each viewer can use it once per round and needs enough play points. Redemptions after lock do not apply. Redemption IDs are saved so a repeated EventSub notification cannot charge points twice.

## Project layout

- `src/engine.ts`: command rules, points, JSON persistence, state snapshots
- `src/server.ts`: HTTP and overlay WebSocket, Twitch IRC, simulation driver
- `src/eventsub.ts`: EventSub WebSocket subscription, redemption filtering, mock notification
- `public/overlay.html`: self-contained OBS overlay (HTML, CSS, client JavaScript)
- `overlay.mp4`: 60–90 second local demo recording

## Limits

Live IRC and EventSub authentication have not been tested with an authorized Twitch account. The simulator and local overlay do not use Twitch credentials. Twitch reward creation, fulfillment, and refunds are outside this app. This project does not host or submit anything publicly.
