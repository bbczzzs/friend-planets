# Friend Planets

**Every Rare Friend is a planet.** Your verified Generations Friend's own on-chain pixels are raised across its tiny 3D planet as a giant black-and-white portrait. Walk all the way around it, then board your rocket, fly from the cockpit, land on other Friends' planets and play: fishing, farming, treasure digging, butterflies, a hoverboard ring race, and a sport against each planet's Friend. Everyone online shares the galaxy.

Built with **FriendSDK v0.1.4**, three.js 0.186 and Trystero (peer-to-peer). Rare Friends Vibeathon · **Character Spotlight**. No RF is spent, burned or moved anywhere: the only currency is ★ stars, earned by playing.

## How your Friend is the main character

- **Its pixels are its planet.** The Friend's canonical 16×16 front frame (read on-chain through the SDK artwork reader) becomes a raised geoglyph: black pixels with the white halo, the canonical treatment. You see it from space, on every landing, and you can walk across your own face.
- **Its family is its world.** Each of the 9 families has its own biome, trees, sky, water, fish, crop, night glow and voice (Moonbone Tundra, Lantern Isles, Hearth Meadow, Moss Garden, Crooked Dunes, Cloud Candy, Titan Ridge, Glimmer Reef, Hollow Grove).
- **Its family is its perk.** Night owl (Skeleton, longer fish bites) · Poker face (Mask, keepers read you late) · Green thumb (Family, crops grow 2× faster) · Split (Cellular, extra tennis reach) · Wonky spin (Asymmetry, harder-to-return shots) · Float (Hoverer, hold jump to float, gentler landings) · Heavy hitter (Colossus, +50% punches, ground-shaking jumps) · Glow (Sparkling, lights up the night, fish come faster) · Echo (Hollow, boxers' wind-ups last longer).
- **Its token number is its planet.** Name, size, layout, rings, moons and sport all come from the token, so the same Friend's planet is the same for every player.
- **Other Friends are real, too.** Neighbour planets belong to real Generations Friends (canonical sprites from the artwork registry). Each planet's Friend walks around, greets you in its family's voice, and cheers or teases after a match. Friends you've visited come to hang out at your campfire.
- Your Friend is drawn from its **unmodified on-chain frames** (idle and walk clips, four facings) as a camera-facing billboard: in the world, in the pilot seat of the cockpit, walking down the rocket ramp.

## How to play

**Walk:** WASD / arrows, or the on-screen stick on phones · look: drag · zoom: wheel or I/O · jump: Space · use: E (or tap the prompt).

**Your planet:** a 10-step quest list with a guide arrow walks you through everything. The collection book (🎣) tracks fish, harvest, treasures, butterflies and trophies.

**Activities (on every planet):**
- 🎣 **Fishing:** fish shadows swim in the pond. Aim with ◀ ▶, hold to charge the cast, release. A fish comes over and nibbles (don't pull yet), then bites: hook it. Then fight: hold to reel (line tension rises), ease off when it runs, and pull the other way. Snap the line or let it swim off and it's gone. 22 species by family and rarity.
- 🌱 **Farming:** 3×3 plots. Plant the planet's crop, come back when it's ripe (40 s; 20 s with Green thumb), harvest.
- ⛏️ **Treasure:** dig at sparkling spots: pebbles, fossils, gold, and one rare treasure per family.
- 🦋 **Butterflies:** six species, rare ones sparkle.
- 🛹 **Hoverboard ring race:** ten rings looping all the way around the planet. A / D steer, Space jumps for high rings, Shift boosts. Best times are saved per planet.
- **The planet's sport, against its Friend:**
  - ⚽ **Penalty shootout:** aim with WASD, hold to power up (too much goes over the bar), release; then you're in goal: read the run-up, move with A / D, dive. Five each, then sudden death.
  - 🎾 **Tennis:** move around your half, swing as the ball reaches you, hold A / D to aim. Real bounces, net and out calls, tennis scoring, first to 2 games.
  - 🥊 **Boxing:** from behind your Friend. Their gloves telegraph jabs, left and right hooks and uppercuts: dodge away from hooks, any way from jabs and uppercuts (you can't block an uppercut), block with S, punch while they're dizzy, counter in the wind-up for a star, W for the star punch.

**The rocket:** walk up the ramp, the hatch closes, 3-2-1 from the cockpit (your Friend in the pilot seat, radar, throttle, yoke). In space: WASD steers, Shift boosts, C swaps cockpit / outside view, tap a planet at the bottom for autopilot, E to land. **🔭 Discover** reads a random Friend from the chain and adds its planet to your galaxy; or type any token number to visit that Friend.

**Landing:** atmosphere entry, the planet's portrait from above, a flip, then you fly the burn: hold Space / THRUST to slow down. Under 2.8 m/s is a perfect landing (+5 ★), under 5.5 a nice one (+2 ★). The hatch opens and your Friend walks down the ramp.

**Online:** everyone playing shares the galaxy. You see other players' Friends on the same planet with their token number, chat with T (speech bubbles), emote (👋 ❤️ 🎉 😂), and the 🌐 list shows who's online and where; **Go** boards your rocket and flies you to them. You can switch online off in that list.

## Rewards and rules

★ stars only, never RF: fish 5–20 ★ by rarity, harvest 3 ★, treasure and butterflies 4–16 ★, sports up to 10 ★ plus per-point stars and a planet trophy for a win (shown on the shelf by your house), ring race 6–20 ★, perfect landing 5 ★, each quest 10 ★. `game.json` holds the placeholder chance-game definition the SDK runtime requires; it is not used as a mechanic.

## Online: how it works

The SDK keeps the game frame offline (its CSP only allows the Robinhood RPC), so the host page runs the network: `host/net.ts`, bundled to `net.js` by `tools/add-net.mjs` and loaded by the built `index.html`. It joins one shared room with **Trystero** over public **Nostr relays**, which only introduce players; game data then flows **peer to peer over WebRTC**. The game and host talk with `postMessage`.

What is shared: your Friend's token number and family, which planet you're on and where you stand, what you're doing, chat text and emotes. Never wallet addresses. Everything received is checked field by field, rate-limited, and chat is stripped of links and HTML.

## Run it

```sh
npm install
npx friendsdk dev games/planets3d        # local preview in the SDK runtime (real wallet gate)
npm run build                             # dist/ = SDK build + the online bridge (net.js)
npx tsc -p tsconfig.json                  # typecheck
npx friendsdk check games/planets3d       # game validation
node test-interaction.mjs 960             # interaction test in the SDK's automated runtime (also 390)
```

Wallet: a browser wallet on **Robinhood mainnet (chain 4663)** holding a hardwired Rare Friends **Generations NFT (generation ≥ 1)**. This is the SDK's standard ownership gate. No signature, transaction or RF is ever requested.

## Checks

- `tsc` clean · `friendsdk check games/planets3d` valid.
- `test-interaction.mjs` passes at 960 px and 390 px in the SDK automated runtime (mock wallet, fixture Friend #7730): play, walk, plant, a full fishing fight, boarding up the ramp and launch, boost, outside view, autopilot, the landing burn and walking out, a sport, the collection, pause through the runtime menu, sound.
- Every activity played to a result by in-page bots (fishing catch, penalty shootout, tennis match, boxing KO, dig, butterfly, ring race).
- Live chain: the production build, opened with a read-only stand-in wallet that reports a real holder's address, lists that holder's Friends from mainnet and opens the game.
- Online: two browsers met on the same planet and saw each other's Friends, chat bubbles and emotes over the public relays.

## Known issues and risks

- It's a 3D game: it needs WebGL. Quality adapts automatically (bloom → shadows → resolution) if frames are slow, and phones start without bloom and shadows. Developed and tested in headless Chromium with software rendering, so please test on your own device.
- Online depends on public Nostr relays to introduce players; some networks block WebRTC and there is no TURN relay, so you may play solo. Like any peer-to-peer game, peers can see each other's IP address. A modified client could send a fake position or chat; there is no moderation beyond validation and link stripping.
- Progress is saved in your browser (`localStorage`), not across devices.
- 🔭 Discover picks random token numbers and reads them from the chain; numbers that don't exist are skipped (after a few misses it falls back to a bundled Friend).

## Credits

- [three.js](https://threejs.org) (MIT), [Trystero](https://github.com/dmotz/trystero) (MIT).
- The follow camera, input handling, merged low-poly "Blocks", canvas labels and the Friend billboard are adapted from the **Steal An Egg** FriendSDK example (Apache-2.0).
- Fonts: Silkscreen, Sometype Mono, Archivo (SIL Open Font License), bundled.
- Rare Friends artwork is read from the chain and the artwork registry through FriendSDK and drawn unmodified. Everything else (models, shaders, sounds) is made in code for this game.
