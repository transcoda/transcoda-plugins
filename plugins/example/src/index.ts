import { defineNode, definePlugin } from '@transcoda/sdk';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };

/** The lower-cased last extension of the file name, or null when it has none. */
export function extensionOf(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot === -1 || dot < path.lastIndexOf('/')) return null;
  return path.slice(dot + 1).toLowerCase();
}

export function extensionMatches(path: string, extensions: readonly string[]): boolean {
  const ext = extensionOf(path);
  return ext !== null && extensions.includes(ext);
}

export const extensionIs = defineNode({
  type: 'example:extension-is',
  version: 1,
  kind: 'condition',
  title: 'Extension is',
  description: 'Branches on the file extension.',
  icon: 'file-type',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [
    { id: 'pass', label: 'Pass', type: 'file' },
    { id: 'else', label: 'Else', type: 'file' },
  ],
  settings: z.object({
    extensions: z
      .array(z.string().regex(/^[a-z0-9]+$/))
      .min(1)
      .default(['mkv'])
      .describe('Extensions'),
  }),
  async decide(ctx, settings) {
    const ext = extensionOf(ctx.file.path);
    const matched = extensionMatches(ctx.file.path, settings.extensions);
    return {
      port: matched ? 'pass' : 'else',
      reason: `extension ${ext ?? '(none)'} ${matched ? 'is' : 'is not'} one of ${settings.extensions.join(', ')}`,
      findings: { extension: ext },
    };
  },
});

const nodes = [extensionIs];

export default definePlugin({
  name: 'example',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  nodes,
  async setup(ctx) {
    await ctx.log('debug', `example ${pkg.version} loaded`);
  },
});
