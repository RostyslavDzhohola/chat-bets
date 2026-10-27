# Devpost draft — Chat Bets

**Title:** Chat Bets

**Tagline:** Turn Twitch chat predictions into a live, play-points overlay.

## Description

Chat Bets lets a streamer ask a quick prediction in chat, then turns viewer calls into a live graphic for the stream. The streamer types `!open "Will I win this round?" yes no`. Viewers answer with `!call yes` or `!call no`. The OBS browser source displays the countdown, each option's share of calls, recent viewers, and a top-five leaderboard. The streamer can lock the round and resolve the winner with chat commands.

Each viewer starts with 100 fictional points. A call costs 10, and a correct result returns 20. The scoreboard stays in a local JSON file. There are no real-money wagers, required Channel Points, purchases, or account links. A built-in simulator shows the whole experience without a Twitch account, so judges can run `npm install && npm run simulate` and open `http://localhost:3000/overlay`.

The app is a single Node.js/TypeScript service. It connects to Twitch chat over IRC WebSocket in live mode, listens for an optional EventSub custom reward named Double down, sends game state to the browser source over a local WebSocket, and serves a self-contained transparent HTML overlay. A Double down redemption boosts one call to 20 play points. Simulate mode feeds fake EventSub notifications through the same parser without Twitch credentials.

## Built with

Codex, TypeScript, Node.js, WebSocket (`ws`), Twitch IRC and EventSub over WebSocket, HTML, CSS, JavaScript, JSON persistence, OBS Browser Source.

## Video script (under 3 minutes)

1. **0:00–0:15** — Introduce Chat Bets: streamer predictions, viewer calls, play points only.
2. **0:15–0:35** — Run `npm run simulate`, open `/overlay`, point out the transparent OBS-ready layout.
3. **0:35–1:10** — Watch calls arrive; explain the odds bars, countdown, recent calls, and leaderboard.
4. **1:10–1:35** — Show the automatic lock and resolution, winner highlight, and points update.
5. **1:35–1:55** — Show the next simulated round and explain the real Twitch chat commands.
6. **1:55–2:10** — Show the Double down banner and `×2` call marker, then close with the local setup.

**Submission status:** Draft only. No account creation, upload, public push, or submission has been performed.
