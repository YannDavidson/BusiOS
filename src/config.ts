import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_LIVE_MODEL: z.string().default('gemini-3.1-flash-live-preview'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_PICKER_API_KEY: z.string().min(1).optional(),
  GOOGLE_DRIVE_APP_ID: z.string().min(1).optional(),
  KNOWLEDGE_SYNC_SECRET: z.string().min(32).optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().default('whatsapp:+14155238886'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  PORTAL_ENABLED: z.string().default('true').transform((value) => value === 'true'),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_BASIC_ID: z.string().min(1).optional(),
  STRIPE_PRICE_GROWTH_ID: z.string().min(1).optional(),
  STRIPE_PRICE_BUSINESS_ID: z.string().min(1).optional(),
  APP_ENCRYPTION_KEY: z.string().min(32).optional()
});

export const config = schema.parse(process.env);

export function assertProductionConfig() {
  if (config.NODE_ENV !== 'production') return;
  const required = ['GEMINI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_ENCRYPTION_KEY'] as const;
  const missing = required.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
}

export function assertGoogleOAuthConfig() {
  const required = ['PUBLIC_BASE_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'APP_ENCRYPTION_KEY'] as const;
  const missing = required.filter((key) => !config[key]);
  if (missing.length) throw new Error(`Google Calendar OAuth is not configured: ${missing.join(', ')}`);
}
