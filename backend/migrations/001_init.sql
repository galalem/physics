-- Initial schema: users, sessions, catalog (tags/exercises/translations/
-- recommendations), attempts, entitlements + promo codes, email/password
-- audit + tokens.
-- Trigram search (pg_trgm) is enabled here so we can later swap the
-- in-memory `q` filter for a real ILIKE + GIN lookup.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Users ----------
-- Email is stored as-typed but uniqueness is case-insensitive via
-- LOWER(email). App-side lowercases before insert/lookup so the two
-- stay in sync.
-- password_hash holds an argon2id encoded string
-- ($argon2id$v=19$m=…$…$…$…) — self-describing algorithm + params +
-- salt + hash. Params can drift over time; rehash on next successful
-- login when the encoded params differ from current.
-- customer_id: Galalem Payments customer handle (`cus_...`), lazily
-- populated on the user's first checkout. Nullable — a user who never
-- purchases never gets one. Enables saved payment methods later
-- without a migration.
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  email_verified        boolean NOT NULL DEFAULT false,
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  locale                text NOT NULL,
  role                  text NOT NULL DEFAULT 'learner',
  customer_id           text,
  -- Onboarding tutorial gate. Signed-in users are redirected to /tutorial
  -- until `tutorial_done_at` is set. Finishing and skipping are both
  -- terminal; `tutorial_outcome` records which, so we can tell whether the
  -- tutorial works rather than only whether people got past it.
  tutorial_done_at      timestamptz,
  tutorial_outcome      text,
  failed_login_count    integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));

-- ---------- Sessions (opaque token, SHA-256 hash stored) ----------
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text UNIQUE NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  user_agent     text
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ---------- Email changes (audit + verification token per transition) ----------
-- Every transition of users.email is a row here — including the initial
-- email set at signup (old_email = NULL). Each row carries its own
-- verification token, so a token can only ever verify the specific
-- transition it was minted for.
--
-- Row states:
--   Pending      token_hash set,   verified_at NULL
--   Verified     token_hash NULL,  verified_at set
--   Restored     token_hash NULL,  verified_at set at INSERT time
--                (used when a user switches back to a previously verified
--                 address — verification is borrowed from history)
--
-- token_issued_count tracks resends on the same pending row, and feeds
-- the per-account resend rate limit.
CREATE TABLE email_changes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email              text,
  new_email              text NOT NULL,
  token_hash             text UNIQUE,
  token_expires_at       timestamptz,
  token_issued_count     integer NOT NULL DEFAULT 1,
  verified_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_changes_user_id_idx ON email_changes (user_id);

-- ---------- Password reset tokens (single-use, TTL-bound) ----------
-- Minted on POST /auth/password-reset, consumed on POST /auth/password.
CREATE TABLE password_reset_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text UNIQUE NOT NULL,
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);

-- ---------- Password changes (append-only audit) ----------
-- One row per hash ever set on the account (signup, /my/password, reset).
-- Reads: none yet — the table sits ready for future features (reject reuse
-- of recent passwords, "enter a previous password" recovery).
CREATE TABLE password_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash  text NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_changes_user_changed_idx ON password_changes (user_id, changed_at DESC);

-- ---------- Tags (self-referencing; a "family" is a root tag) ----------
-- parent_id NULL  → root (formerly a family: level, field, pattern, …)
-- parent_id set   → leaf (attached to exercises via exercises_tags)
-- The 2-level "root/leaf" invariant is app-enforced.
CREATE TABLE tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id      uuid REFERENCES tags(id) ON DELETE CASCADE,
  slug           text NOT NULL,
  index          integer NOT NULL,
  UNIQUE (parent_id, slug)
);
-- UNIQUE(parent_id, slug) doesn't catch two roots with the same slug
-- (Postgres treats NULLs as distinct). This partial index does.
CREATE UNIQUE INDEX tags_root_slug_idx ON tags (slug) WHERE parent_id IS NULL;
CREATE INDEX tags_parent_id_idx ON tags (parent_id);

-- ---------- Exercises ----------
-- version: bundle version segment (matches the `v<x.y.z>` in bundle_url).
-- Frozen onto each attempt (attempts.exercise_version) at start-time per
-- D12 so a version bump mid-attempt doesn't invalidate in-flight state.
-- tier: access-control policy, not opaque metadata. `'standard'` (default)
-- goes through the entitlement gate; `'free'` bypasses it. Fail-closed —
-- anything not literally `'free'` falls through to the entitlement check.
-- Editorial column, curated by admin, not a schema constraint.
CREATE TABLE exercises (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text UNIQUE NOT NULL,
  formula        text,
  bundle_url     text,
  version        text NOT NULL DEFAULT '0.0.0',
  tier           text NOT NULL DEFAULT 'standard',
  published      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- Exercises ↔ Tags join ----------
CREATE TABLE exercises_tags (
  exercise_id    uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (exercise_id, tag_id)
);
CREATE INDEX exercises_tags_tag_id_idx ON exercises_tags (tag_id);

-- ---------- Recommendations (before/after) ----------
CREATE TABLE exercises_recommendations (
  from_id        uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  to_id          uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  direction      text NOT NULL,
  PRIMARY KEY (from_id, to_id, direction),
  CHECK (from_id <> to_id)
);
CREATE INDEX exercises_recommendations_from_dir_idx
  ON exercises_recommendations (from_id, direction);

-- ---------- Promo codes ----------
-- One-time-per-user campaign discounts (e.g. bac season). No user-facing
-- entry field V1 — codes are baked into frontend CTAs. Enforcement of
-- "already redeemed by this user" is a partial unique index on
-- entitlements (user_id, promo_code_id).
CREATE TABLE promo_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text UNIQUE NOT NULL,
  discount       integer NOT NULL CHECK (discount BETWEEN 1 AND 100),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- Entitlements (access grants — purchases + admin grants) ----------
-- Multi-row per user, union semantics: any active grant (valid_until >
-- now()) whose scope_filter matches the exercise is enough.
--
-- scope_filter: null = full catalog. Otherwise `{"tags": <Odoo-domain>}`
-- where <domain> is a polish-notation array of "&" / "|" operators + tag
-- string leaves. Evaluated in TypeScript at request time, not in SQL.
--
-- Idempotency guards:
--   payment_session_id unique (partial)  — webhook replay is a no-op
--   (user_id, promo_code_id) unique (partial) — one redemption per user
CREATE TABLE entitlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at          timestamptz NOT NULL DEFAULT now(),
  valid_until         timestamptz NOT NULL,
  scope_filter        jsonb,
  source              text NOT NULL,
  promo_code_id       uuid REFERENCES promo_codes(id),
  payment_session_id  text,
  payment_metadata    jsonb
);
CREATE UNIQUE INDEX entitlements_user_promo_idx
  ON entitlements (user_id, promo_code_id)
  WHERE promo_code_id IS NOT NULL;
CREATE UNIQUE INDEX entitlements_session_idx
  ON entitlements (payment_session_id)
  WHERE payment_session_id IS NOT NULL;
CREATE INDEX entitlements_user_valid_idx
  ON entitlements (user_id, valid_until DESC);

-- ---------- Attempts ----------
CREATE TABLE attempts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id            uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  exercise_version       text NOT NULL,
  seed                   bigint NOT NULL,
  started_at             timestamptz NOT NULL DEFAULT now(),
  last_action_at         timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  succeeded              boolean,
  saved_state_blob       text,
  saved_state_version    integer,
  log                    text NOT NULL DEFAULT ''
);
CREATE INDEX attempts_user_exercise_idx
  ON attempts (user_id, exercise_id, completed_at NULLS FIRST);

-- ---------- Translations (polymorphic) ----------
-- record_type × record_id × locale × field  →  value
-- Used for tag `label` and exercise `title` (and eventually
-- description / long-form). Formula stays on the exercises row as a
-- non-translated string.
CREATE TABLE translations (
  record_type    text NOT NULL,
  record_id      uuid NOT NULL,
  locale         text NOT NULL,
  field          text NOT NULL,
  value          text NOT NULL,
  PRIMARY KEY (record_type, record_id, locale, field)
);
CREATE INDEX translations_record_idx ON translations (record_type, record_id);
CREATE INDEX translations_title_trgm_idx
  ON translations USING gin (value gin_trgm_ops)
  WHERE record_type = 'exercise' AND field = 'title';
