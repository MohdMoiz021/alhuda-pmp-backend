// Cloudflare Turnstile server-side verification.
// Fails OPEN when TURNSTILE_SECRET_KEY is not configured, so the app keeps working
// until keys are provisioned. Once the secret is set, verification is enforced.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let warnedMissingKey = false;

/**
 * @param {string} token  the cf-turnstile-response token from the client
 * @param {string} [ip]   remote IP (optional, Cloudflare cross-checks it)
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
const verifyTurnstile = async (token, ip) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (!warnedMissingKey) {
      console.warn('⚠️  TURNSTILE_SECRET_KEY not set — Turnstile verification is disabled (fail-open).');
      warnedMissingKey = true;
    }
    return { ok: true, reason: 'disabled' };
  }

  if (!token) return { ok: false, reason: 'missing_token' };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.append('remoteip', ip);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();

    if (!data.success) {
      return { ok: false, reason: (data['error-codes'] || ['verification_failed']).join(',') };
    }
    return { ok: true };
  } catch (err) {
    console.error('Turnstile verification error:', err.message);
    // Cloudflare outage shouldn't hard-block real users.
    return { ok: true, reason: 'verify_error' };
  }
};

module.exports = { verifyTurnstile };
