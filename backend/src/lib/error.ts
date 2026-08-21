// Unified error schema — every error response the API emits looks like:
//   { "error": { "message", "status", "code", ...extras } }

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extras: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
}

export const errors = {
  authenticationRequired: () =>
    new HttpError(401, 'authentication_required', 'Authentication required.'),
  authenticationInvalid: () =>
    new HttpError(401, 'authentication_invalid', 'Invalid credentials.'),
  authenticationExpired: (extras: Record<string, unknown> = {}) =>
    new HttpError(401, 'authentication_expired', 'Session expired.', extras),
  invalidCredentials: (message = 'Invalid email or password.') =>
    new HttpError(401, 'invalid_credentials', message),
  emailNotVerified: (message = 'Email not verified. Please verify your email before logging in.') =>
    new HttpError(401, 'email_not_verified', message, { resendUrl: '/api/v1/auth/verify-email/resend' }),
  invalidValue: (message: string, fields?: Array<{ field: string; message: string }>) =>
    new HttpError(400, 'invalid_value', message, fields ? { fields } : {}),
  emailAlreadyRegistered: (message = 'That email is already registered.') =>
    new HttpError(409, 'email_already_registered', message),
  tokenInvalid: (message = 'Token is invalid.') =>
    new HttpError(400, 'token_invalid', message),
  tokenExpired: (message = 'Token has expired.') =>
    new HttpError(400, 'token_expired', message),
  rateLimited: (retryAfter: number, message = 'Too many requests, please try again later.') =>
    new HttpError(429, 'rate_limited', message, { retryAfter }),
  resourceMissing: (message = 'Not found.') =>
    new HttpError(404, 'resource_missing', message),
  entitlementRequired: (
    message = 'Purchase required to play this exercise.',
    extras: Record<string, unknown> = { checkoutUrl: '/pricing' },
  ) => new HttpError(403, 'entitlement_required', message, extras),
  attemptCompleted: (message = 'Attempt is already complete; further updates rejected.') =>
    new HttpError(409, 'attempt_completed', message),
  checkoutValidityOutOfRange: (message = 'validity_until must be between 1 and 365 days from now.') =>
    new HttpError(422, 'checkout_validity_out_of_range', message),
  checkoutScopeFilterInvalid: (message = 'scope_filter.tags is not a well-formed Odoo domain.') =>
    new HttpError(422, 'checkout_scope_filter_invalid', message),
  checkoutLocaleUnsupported: (message = 'locale must be one of en, fr, ar.') =>
    new HttpError(422, 'checkout_locale_unsupported', message),
  promoCodeInvalid: (message = 'Promo code is invalid or inactive.') =>
    new HttpError(422, 'promo_code_invalid', message),
  promoCodeAlreadyRedeemed: (message = 'You have already redeemed this promo code.') =>
    new HttpError(409, 'promo_code_already_redeemed', message),
  webhookSignatureInvalid: (message = 'Webhook signature verification failed.') =>
    new HttpError(400, 'webhook_signature_invalid', message),
  notImplemented: (message = 'Not implemented.') =>
    new HttpError(501, 'not_implemented', message),
};
