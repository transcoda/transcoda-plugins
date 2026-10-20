import { nodeMetadata, secretPaths } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import plugin, { integration, notify } from './index.ts';

describe('plugin', () => {
  it('is a valid plugin with a notify-phase finish node', () => {
    expect(plugin.name).toBe('discord');
    expect(plugin.version).toBe('1.0.0');
    const meta = nodeMetadata(notify);
    expect(meta.finishPhase).toBe('notify');
    expect(meta.hooks).toEqual(['finish', 'run']);
  });

  it('marks only webhookUrl as secret', () => {
    const schema = z.toJSONSchema(integration.settings, { io: 'input' });
    expect(secretPaths(schema as never)).toEqual(['webhookUrl']);
  });
});
