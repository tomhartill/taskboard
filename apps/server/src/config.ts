import { z } from 'zod';

const Env = z
  .object({
    DATABASE_URL: z.string().default('postgres://taskboard:taskboard@localhost:5432/taskboard'),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default('127.0.0.1'),
    PUBLIC_URL: z.string().url().default('http://localhost:5173'),
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
    AUTH_MODE: z.enum(['google', 'dev']).default('google'),
    ALLOWED_EMAIL: z.string().default(''),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    /** Folder holding the built web app. Served by the server in production. */
    WEB_DIST: z.string().optional(),
    LOG_LEVEL: z.string().default('info'),
    /** Whose midnight counts: unfinished cards roll onto the new day at midnight here. */
    TIMEZONE: z
      .string()
      .default('Europe/London')
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-GB', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'TIMEZONE must be an IANA time zone such as Europe/London'),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'google') {
      for (const key of ['ALLOWED_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when AUTH_MODE=google` });
      }
    }
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration. Check your .env file:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
