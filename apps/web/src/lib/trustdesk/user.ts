/**
 * Resolves the current planner's identity for the Trust Desk override feature.
 *
 * In the deployed Databricks App, the front door proxy injects the authenticated
 * user's identity as HTTP headers on every request — including same-origin
 * fetch() calls made from the browser, since those pass back through the same
 * proxy. Locally (no proxy in front of `next dev`), neither header is present,
 * so we fall back to a fixed 'local-dev' identity.
 */
export function appUser(req: Request): string {
  const email = req.headers.get('X-Forwarded-Email');
  if (email && email.trim()) return email.trim();

  const user = req.headers.get('X-Forwarded-User');
  if (user && user.trim()) return user.trim();

  return 'local-dev';
}
