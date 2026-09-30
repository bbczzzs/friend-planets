/**
 * Your galaxy: your home planet in the middle and fifteen neighbour planets in
 * three rings, each belonging to a real Rare Friend. A planet depends only on
 * its Friend (token number, family and pixels), so the same Friend's planet is
 * the same for every player: that's what lets players meet on it online.
 * Only where it sits in your sky depends on you. Pure data.
 */
import * as THREE from "three";
import { mulberry32, seedOf, planetName, themeOf, TAU, type Sport } from "./data";
import { ROSTER, type RosterFriend } from "../sprites";
import { SUN_DIR, type PlanetSpec } from "./planet";

export interface World { specs: PlanetSpec[]; hosts: (RosterFriend | null)[] }

const SPORTS_CYCLE: Sport[] = ["goal", "tennis", "boxing"];

/** Everything about a Friend's planet except where it is. */
export function planetSpecFor(id: number, family: number, mask: readonly string[] | undefined, index: number, center: THREE.Vector3, home: boolean): PlanetSpec {
  const seed = seedOf(id), r = mulberry32(seed ^ 0x9a1a7e);
  const side = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).cross(SUN_DIR).normalize();
  return {
    index, id, name: planetName(id), family, theme: themeOf(family), R: 30 + Math.floor(r() * 7), center, seed,
    home, sport: SPORTS_CYCLE[seed % 3], fishing: true, farm: true,
    baseUp: SUN_DIR.clone().applyAxisAngle(side, 0.8 + r() * 0.15).normalize(),
    rings: r() < 0.3, moons: Math.floor(r() * 3), mask,
  };
}

/** Where the k-th planet sits in your sky (rings of 4, 5 and 6, then farther out). */
export function orbitFor(k: number, seed: number) {
  const r = mulberry32(seed ^ (0x51ab + k * 977));
  const ring = k < 4 ? 0 : k < 9 ? 1 : k < 15 ? 2 : 3 + Math.floor((k - 15) / 8);
  const inRing = ring === 0 ? 4 : ring === 1 ? 5 : ring === 2 ? 6 : 8, slot = ring === 0 ? k : ring === 1 ? k - 4 : ring === 2 ? k - 9 : (k - 15) % 8;
  const azimuth = (slot / inRing) * TAU + ring * 0.7 + (r() - 0.5) * 0.4, elevation = (r() - 0.35) * 0.6;
  const distance = [480, 800, 1120, 1450][Math.min(3, ring)] + (ring > 3 ? (ring - 3) * 300 : 0) + r() * 90;
  return new THREE.Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation)).multiplyScalar(distance);
}

export function makeGalaxy(friendId: bigint, homeFamily: number, homeMask?: readonly string[]): World {
  const me = Number(friendId), seed = seedOf(friendId), r = mulberry32(seed ^ 0x9a1a);
  // Two Friends from each family where we can, shuffled by your token.
  const pool = ROSTER.filter(f => f.id !== me).map(f => ({ f, k: r() })).sort((a, b) => a.k - b.k).map(o => o.f);
  const picks: RosterFriend[] = [], perFamily = new Map<number, number>();
  for (const f of pool) { const n = perFamily.get(f.familyId) ?? 0; if (n < 2 && picks.length < 15) { picks.push(f); perFamily.set(f.familyId, n + 1); } }
  for (const f of pool) if (picks.length < 15 && !picks.includes(f)) picks.push(f);

  const specs: PlanetSpec[] = [planetSpecFor(me, homeFamily, homeMask, 0, new THREE.Vector3(), true)];
  const hosts: (RosterFriend | null)[] = [null];
  picks.forEach((f, k) => {
    specs.push(planetSpecFor(f.id, f.familyId, f.clips.idle.down[0], k + 1, orbitFor(k, seed), false));
    hosts.push(f);
  });
  return { specs, hosts };
}
