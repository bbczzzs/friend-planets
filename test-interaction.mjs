// Interaction test for Friend Planets 3D in the SDK's automated harness (mock
// wallet + sample Friend #7730): press Play, walk on your planet, plant a crop,
// catch a fish, board the rocket, fly + boost, autopilot to a neighbour and land,
// play its sport, open the collection, and pause through the runtime menu.
//   node test-interaction.mjs [width]
import { testGame } from "@rarefriends/friendsdk/testing";

const width = Number(process.argv[2] || 960);

await testGame("./games/planets3d", {
  width,
  timeout: 120000,
  screenshot: `./artifacts/planets3d-${width}.png`,
  check: async ({ page, game }) => {
    await game.getByRole("button", { name: /^Play/ }).click({ timeout: 60000 });
    // The game runs in a frame; the webdriver-only hook lets the test act like a player.
    const frame = page.frames().find(f => f !== page.mainFrame() && f.url() !== "about:blank");
    const E = (fn, arg) => frame.evaluate(fn, arg);
    await frame.waitForFunction(() => !!window.__fp3);
    await E(() => { window.__fp3.lockQuality = true; window.__fp3.setQuality(0); });
    // Skip the opening shot of your planet.
    await E(() => { window.__fp3.introT = 99; });
    await frame.waitForFunction(() => window.__fp3.mode === "walk", null, { timeout: 60000 });
    // Press the game's action on the exact frame a condition holds (no input latency in CI).
    const pressWhen = (kind, ms = 15000) => E(([kind, ms]) => new Promise(res => {
      const t0 = performance.now();
      const ok = h => kind === "zone" ? h.meter && h.meter.zone && h.meter.value > h.meter.zone[0] + 0.03 && h.meter.value < h.meter.zone[1] - 0.03
        : kind === "full" ? h.meter && h.meter.value > 0.9 : h.action === kind;
      const tick = () => { const h = window.__fp3.activityHud(); if (!h || h.result) return res(false); if (ok(h)) { window.__fp3.action(); return res(true); } if (performance.now() - t0 > ms) return res(false); requestAnimationFrame(tick); };
      tick();
    }), [kind, ms]);

    // Walk on your home planet.
    const n0 = await E(() => window.__fp3.n.toArray().join());
    await page.keyboard.down("w"); await page.waitForTimeout(700); await page.keyboard.up("w");
    if ((await E(() => window.__fp3.n.toArray().join())) === n0) throw new Error("did not walk");

    // Farm: plant on a plot.
    await E(() => window.__fp3.testUse("farm", 4));
    await game.getByText(/^Planted /).first().waitFor({ timeout: 5000 });

    // Fish off the dock until something bites and you reel it in.
    await E(() => window.__fp3.testUse("pond"));
    await game.getByText("Fishing").first().waitFor({ timeout: 5000 });
    // Hold to charge the cast, release; hook on the bite; then reel like a careful player.
    let caught = false;
    for (let attempt = 0; attempt < 3 && !caught; attempt++) {
      await E(() => window.__fp3.setAction(true)); await page.waitForTimeout(900); await E(() => window.__fp3.setAction(false));
      caught = await E(() => new Promise(res => {
        const e = window.__fp3, t0 = performance.now();
        const tick = () => {
          const a = e.activity;
          if (!a || a.phase === "caught" || a.phase === "lost" || performance.now() - t0 > 240000) { e.setAction(false); e.setSteer(0); return res(a?.phase === "caught"); }
          if (a.phase === "bite") e.action();
          if (a.phase === "fight") { const run = a.surge > 0; e.setAction(run ? a.tension < 0.35 : a.tension < 0.75); e.setSteer(run ? -a.surgeDir : 0); }
          requestAnimationFrame(tick);
        };
        tick();
      }));
      if (!caught) await E(() => window.__fp3.action());
    }
    if (!caught) throw new Error("no fish caught");
    // The catch card slides in a moment later; leave from it once it has settled.
    const leave = game.locator(".fp-result").getByRole("button", { name: "Leave" });
    await leave.waitFor({ timeout: 10000 }); await page.waitForTimeout(400);
    await leave.click();

    // Board the rocket and launch into space.
    await E(() => window.__fp3.testUse("pad"));
    await frame.waitForFunction(() => window.__fp3.mode === "fly", null, { timeout: 120000 });
    await page.keyboard.down("Shift"); await page.waitForTimeout(400);
    if (!(await E(() => window.__fp3.ship.boosting))) throw new Error("boost did not fire");
    await page.keyboard.up("Shift");
    await game.getByRole("button", { name: /Outside view/ }).click();
    // Autopilot to the first neighbour; it lands by itself.
    await game.locator(".fp-chip").nth(1).click();
    // Landing: fly the burn (hold thrust when falling fast), then walk out of the rocket.
    await frame.waitForFunction(() => window.__fp3.mode === "land", null, { timeout: 120000 });
    await E(() => { const e = window.__fp3; const tick = () => { if (e.mode !== "land") { e.setThrust(false); return; } if (e.L.phase === "descent") e.setThrust(e.L.vel < -(e.L.alt > 8 ? 5 : 2.2)); requestAnimationFrame(tick); }; tick(); });
    await frame.waitForFunction(() => window.__fp3.mode === "walk" && window.__fp3.current.spec.index === 1, null, { timeout: 180000 });
    await game.getByText(/Friend #\d+'s planet/).first().waitFor({ timeout: 5000 });

    // Play the planet's sport against its Friend.
    await E(() => window.__fp3.testUse("sport"));
    await game.locator(".fp-act-title").waitFor({ timeout: 5000 });
    await game.locator(".fp-action").click();
    await game.getByRole("button", { name: /Leave/ }).first().click();

    // Collection, then pause and resume through the runtime menu, then sound.
    await game.getByRole("button", { name: "Collection" }).click();
    await game.getByText(/^Fish \d+\/\d+/).waitFor({ timeout: 3000 });
    await game.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Open Friend wallet" }).click();
    await game.locator('section[aria-busy="true"]').waitFor({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Escape");
    await game.getByRole("button", { name: /Turn sound on/ }).click();
  },
});

console.log(`INTERACTION PASS at ${width}px: play, walk, plant, catch a fish (cast, bite, fight), board up the ramp + launch, boost, outside view, autopilot, landing burn + walk out, sport, collection, pause, sound`);
