# Build notes

**Codex provider session/thread ID:** `01a17329-7d6f-7591-8902-f9d1b3c66543`

## How Codex was used

Codex built Chat Bets in this session from the hackathon brief. It wrote the TypeScript game engine, Twitch IRC connection, EventSub Double down handler, HTTP and WebSocket service, self-contained OBS overlay, and automated simulator. It installed the project dependencies, typechecked the code, ran simulate mode with fake EventSub redemptions, inspected the rendered browser overlay, recorded a local demo, and packaged the source and deliverables. All work stayed local; no Twitch, Devpost, YouTube, or public repository account was created, and nothing was submitted or deployed.

## Known gaps

- Live Twitch IRC and EventSub have not been exercised with real tokens or a channel; the EventSub redemption path has been verified with simulated notifications.
- The app does not create, fulfill, or refund Twitch Channel Points rewards. The broadcaster configures the optional custom reward in Twitch.
- The JSON leaderboard is for one local service instance. It is not meant for multiple writers or cloud persistence.
- There is no administrative dashboard; the streamer uses chat commands.

## Verification

- `npm install`, `npm run typecheck`, and focused game and EventSub tests completed locally.
- `npm run simulate` served `/overlay`, `/api/state`, and `/health`; fake EventSub redemptions armed and doubled calls, and the overlay showed `×2` and a Double down banner.
- `overlay.mp4` is a local demo recording of simulate mode with Double down visible. Video duration and codec are checked during packaging.
