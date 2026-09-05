# Setup notes — services catalog, company archiving & signup security

## New environment variables (`.env`)

```
# Cloudflare Turnstile — https://dash.cloudflare.com/?to=/:account/turnstile
# Until TURNSTILE_SECRET_KEY is set, Turnstile checks fail OPEN (a warning is logged).
TURNSTILE_SECRET_KEY=

# Used to build the email-verification link sent to new partners.
# Must point at the deployed frontend, e.g. https://portal.alhudafinancial.com
FRONTEND_URL=

# --- optional, sensible defaults shown ---
AUTH_RATE_LIMIT=20         # per-IP requests / 15 min on login, register, resend, forgot-password
SIGNUP_IP_DAILY_MAX=5      # max partner signups per IP per 24h
```

The matching **public** site key goes in the frontend as `VITE_TURNSTILE_SITE_KEY`.

## What changed

- **Schema bootstrap** (`src/db/ensureSchema.js`) runs on every server start. Adds
  `archived_*`, `email_verified*` and `signup_ip` columns to `users`, creates the
  `services` table, and seeds it with the 7 default services. Safe to run repeatedly.
  Already-approved accounts are backfilled to `email_verified = true`.

- **Services API** — `/api/services` (GET public; POST/PUT/PATCH admin_b+admin_c;
  DELETE admin_c). DELETE is blocked with 409 when a service is referenced by cases.

- **Company archive** — `PATCH /api/auth/users/:id/archive` `{ archived, reason? }`.
  Archiving forces `is_active = false` and blocks login (`status: 'archived'`).
  `GET /api/auth/users` hides archived users unless `?include_archived=true`.

- **Email verification** — new partners get a verification email. Login is blocked with
  `status: 'email_unverified'` and approval is refused until verified.
  `GET /api/auth/verify-email/:token`, `POST /api/auth/resend-verification`.

- **Signup / login bot protection**:
  - **Cloudflare Turnstile** (`src/utils/turnstile.js`) verified on `/register` and
    `/login` (`turnstile_token` in the body). Fails open until the secret is set;
    returns `status: 'captcha_failed'` on failure.
  - Hidden honeypot field (`company_website`) on registration.
  - Per-IP signup velocity cap (`SIGNUP_IP_DAILY_MAX`), via `users.signup_ip`.
  - Disposable / junk email domains rejected; all-digit local parts (e.g.
    `397937549@…`) rejected; password min length 8 (letters + numbers).
  - Stricter per-IP rate limiting on the auth endpoints (`AUTH_RATE_LIMIT`).
