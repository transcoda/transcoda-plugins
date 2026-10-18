import { defineIntegration, secret } from '@transcoda/sdk';
import { z } from 'zod';
import { credentialKind, fetchKindOf, TMDB_ORIGIN, TmdbHttpError, tmdbGet } from './client.ts';

export const integration = defineIntegration({
  id: 'tmdb',
  title: 'TMDB',
  settings: z.object({
    credential: secret().describe('Your TMDB API key (v3) or API read access token'),
    language: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .default('en-US')
      .describe('Language for titles in messages'),
  }),
  allowedOrigins: [TMDB_ORIGIN],
  async test(ctx) {
    const raw = ctx.settings.credential;
    const kind = credentialKind(typeof raw === 'string' ? raw : '');
    try {
      const body = await tmdbGet(ctx, '/3/authentication');
      if (
        typeof body === 'object' &&
        body !== null &&
        !Array.isArray(body) &&
        body.success === true
      ) {
        return { ok: true, message: `TMDB accepted the ${kind}` };
      }
      return { ok: false, kind: 'other', message: 'TMDB did not confirm the credential' };
    } catch (error) {
      if (error instanceof TmdbHttpError) {
        if (error.status === 401) {
          return { ok: false, kind: 'unauthorized', message: 'TMDB rejected the credential' };
        }
        return { ok: false, kind: 'other', message: error.message };
      }
      const fetchKind = fetchKindOf(error);
      if (fetchKind !== null) {
        return { ok: false, kind: 'unreachable', message: `Could not reach TMDB (${fetchKind})` };
      }
      throw error;
    }
  },
});
