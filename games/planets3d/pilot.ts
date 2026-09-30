/**
 * The player's Friend: its canonical on-chain sprite sheet (idle + walk in four
 * directions), read through the SDK's artwork reader. Never rejects: a
 * deterministic stand-in is used if the read fails, and the UI says so.
 */
import { createFriendReader, decodeSpriteBitmap } from "@rarefriends/friendsdk/sprites";
import { clipsFrom, stillClips, fallbackSprite, type Clips } from "./sprites";

export interface PilotSprite { clips: Clips; familyId: number; fallback: boolean }

const reader = createFriendReader();
const cache = new Map<string, Promise<PilotSprite>>();

export function loadPilot(friendId: bigint): Promise<PilotSprite> {
  const key = friendId.toString();
  const hit = cache.get(key);
  if (hit) return hit;
  const job = (async (): Promise<PilotSprite> => {
    try {
      const art = await reader.read(friendId);
      const frames = art.frames.map(b => decodeSpriteBitmap(b).rows);
      return { clips: clipsFrom(frames), familyId: art.familyId, fallback: false };
    } catch {
      return { clips: stillClips(fallbackSprite(Number(BigInt.asUintN(32, friendId)))), familyId: Number(friendId % 9n), fallback: true };
    }
  })();
  cache.set(key, job);
  return job;
}
