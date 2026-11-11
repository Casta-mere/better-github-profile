import { validateProfileData, type ProfileData } from '../src/collect/profile';
import type { Fetch } from './check';

/** The usage Worker's route for a user's public profile data (worker/src/profile.ts). */
export const PROFILE_URL = 'https://better-github-profile-usage.castamerego.workers.dev/profile';

/** How long a visitor's data is reused from the browser before it is asked for again. */
export const PROFILE_CACHE_MS = 60 * 60 * 1000;

/**
 * `user`'s public profile data through the Worker. Null for anything but a 200 with valid
 * data (unknown user, rate limit, network, Worker down): the preview then keeps what it shows.
 */
export async function fetchProfile(user: string, fetch: Fetch, base = PROFILE_URL): Promise<ProfileData | null> {
  try {
    const res = await fetch(`${base}/${encodeURIComponent(user)}`);
    if (res.status !== 200) return null;
    const body: unknown = await res.json();
    return validateProfileData(body) ? body : null;
  } catch {
    return null;
  }
}

const cacheKey = (user: string) => `bgp-profile:${user.toLowerCase()}`;

/**
 * `user`'s data as cached by `writeCachedProfile`, if it is less than `PROFILE_CACHE_MS` old.
 * Null when missing, stale, from the future, unreadable, or when storage is blocked.
 */
export function readCachedProfile(storage: Pick<Storage, 'getItem'>, user: string, now: number): ProfileData | null {
  try {
    const raw = storage.getItem(cacheKey(user));
    if (raw === null) return null;
    const entry: unknown = JSON.parse(raw);
    if (typeof entry !== 'object' || entry === null || !('at' in entry) || !('data' in entry)) return null;
    const { at, data } = entry;
    if (typeof at !== 'number' || at > now || now - at >= PROFILE_CACHE_MS) return null;
    return validateProfileData(data) ? data : null;
  } catch {
    return null;
  }
}

/** Keeps `user`'s data in the browser for an hour. Blocked or full storage just means no cache. */
export function writeCachedProfile(storage: Pick<Storage, 'setItem'>, user: string, data: ProfileData, now: number): void {
  try {
    storage.setItem(cacheKey(user), JSON.stringify({ at: now, data }));
  } catch {
    // No cache this time.
  }
}

/** Whether an answer for `requested` may replace the preview: only while that name is still in the box. */
export function acceptProfile(current: string, requested: string): boolean {
  return current.toLowerCase() === requested.toLowerCase();
}

/**
 * What the preview should show once the box holds `username`, given the visitor whose data it
 * shows (`shownLogin`, null for the sample) and the data already known for `username`.
 * 'keep' while the shown data is still this name's, e.g. after a case change or a trailing space.
 */
export function previewSourceFor(
  username: string,
  shownLogin: string | null,
  known: ProfileData | null,
): 'keep' | 'sample' | ProfileData {
  const name = username.trim();
  if (shownLogin !== null && acceptProfile(name, shownLogin)) return 'keep';
  if (known !== null) return known;
  return shownLogin === null ? 'keep' : 'sample';
}
