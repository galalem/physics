import type { Locale } from '~/config';

export type AuthEnv = { Variables: { locale: Locale } };

export interface FieldError {
  field: string;
  message: string;
}
