import { createHash } from 'node:crypto';
import { runtimeSigningSecret } from '~/config';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

// Signs a runtime bundle URL for nginx's `secure_link_module`. The MD5
// format mirrors `secure_link_md5 "$secure_link_expires$uri $secret"` —
// the space between `$uri` and `$secret` is significant and must match
// the nginx conf exactly.
//
//   input:  "/runtime/reflexion-lumiere-v0.1.0/"
//   output: "/runtime/reflexion-lumiere-v0.1.0/?exp=1735689600&sig=<...>"
export function signBundleUrl(path: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHash('md5')
    .update(`${exp}${path} ${runtimeSigningSecret()}`)
    .digest('base64url');
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}exp=${exp}&sig=${sig}`;
}
