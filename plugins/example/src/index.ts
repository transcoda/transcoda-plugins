import { defineNode, definePlugin } from '@transcoda/sdk';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };

export function extensionMatches(path: string, extensions: readonly string[]): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1 || dot < path.lastIndexOf('/')) return false;
  return extensions.includes(path.slice(dot + 1).toLowerCase());
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
  // EngineContext is opaque until the engine track defines it; this reads a `path`
  // field defensively so the example stays honest about what it relies on.
  async decide(ctx, settings) {
    const path = typeof ctx.path === 'string' ? ctx.path : '';
    return extensionMatches(path, settings.extensions) ? 'pass' : 'else';
  },
});

export const nodes = [extensionIs];

export default definePlugin({
  name: pkg.name,
  version: pkg.version,
  async setup(ctx) {
    await ctx.log('debug', `${pkg.name} ${pkg.version} loaded`);
  },
});
