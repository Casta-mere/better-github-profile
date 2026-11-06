/**
 * How a visitor lands on the selector page: the parameters that fill the username box.
 *
 * - `?user=<login>` fills the box. A person can put it in a link by hand, and the usage
 *   Worker's sign-in (worker/src/auth.ts) ends with it. A login is public, so it fills the
 *   box and nothing else: it is not trusted for anything.
 * - `?auth=cancelled | failed | unavailable` says why sign-in didn't fill it.
 *
 * Sign-in is a plain navigation to the Worker, which asks GitHub who the visitor is (an
 * OAuth App with no scopes), throws the token away and sends back only the login. No token
 * ever reaches the page. Pure, no DOM: tested in test/site-landing.test.ts.
 */

/**
 * The usage Worker's sign-in route. Same Worker as the Action's TELEMETRY_URL and the page's
 * CHECK_PROXY (a test keeps them together).
 */
export const AUTH_START = 'https://better-github-profile-usage.castamerego.workers.dev/auth/start';

/** Why sign-in came back without a login. */
export type AuthOutcome = 'cancelled' | 'failed' | 'unavailable';

export interface Landing {
  /** The trimmed `?user=` value, valid or not; null when absent or blank. */
  user: string | null;
  /** A known `?auth=` value; null when absent or unknown. */
  auth: AuthOutcome | null;
}

const AUTH_OUTCOMES: readonly string[] = ['cancelled', 'failed', 'unavailable'] satisfies AuthOutcome[];
const LANDING_PARAMS: readonly string[] = ['user', 'auth'];

/**
 * The sign-in link for the page at `pageUrl`. The Worker sends the browser back to the page's
 * origin and path only, so a stale `?user=` or `?auth=` never comes back.
 */
export function signInUrl(pageUrl: string): string {
  const page = new URL(pageUrl);
  return `${AUTH_START}?return=${encodeURIComponent(page.origin + page.pathname)}`;
}

/** The username and sign-in outcome in a page's query string (`location.search`). */
export function readLanding(search: string): Landing {
  const params = new URLSearchParams(search);
  const auth = params.get('auth');
  return {
    user: params.get('user')?.trim() || null,
    auth: auth !== null && AUTH_OUTCOMES.includes(auth) ? (auth as AuthOutcome) : null,
  };
}

/**
 * `search` without the parameters `readLanding` reads, for `history.replaceState`: a reload
 * or a later edit of the box isn't overridden by a stale URL. Other parameters are kept in
 * order and exactly as written; '' when none are left.
 */
export function withoutLanding(search: string): string {
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => {
      if (pair === '') return false;
      // Decode the name the way URLSearchParams (and so readLanding) does: `%75ser` is `user`.
      const [name] = new URLSearchParams(pair).keys();
      return !LANDING_PARAMS.includes(name ?? '');
    });
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
}
