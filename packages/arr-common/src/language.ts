import type { PluginContext } from '@transcoda/sdk';
import type { JsonValue } from './json.ts';

/** Reads `obj.originalLanguage.name`; the result is core's canonical ISO 639-2/T form. */
export function originalLanguageOf(
  ctx: PluginContext,
  obj: JsonValue,
): { language: string | 'unknown'; reason: string } {
  const lng =
    typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? obj.originalLanguage : null;
  const name =
    typeof lng === 'object' && lng !== null && !Array.isArray(lng) ? lng.name : undefined;
  if (typeof name !== 'string') {
    return { language: 'unknown', reason: 'no original language on the item' };
  }
  const code = ctx.lang.fromName(name);
  if (code === null) {
    return { language: 'unknown', reason: `original language "${name}" is not a known language` };
  }
  const normalised = ctx.lang.normalise(code);
  return { language: normalised, reason: `original language ${name} (${code})` };
}
