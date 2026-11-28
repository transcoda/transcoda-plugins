// Sonarr and Radarr are meant to have the same features. This compares what each plugin exposes
// (nodes, node versions, ports, settings, hooks, integration settings) with the product name taken
// out, so a step, setting or port added to one plugin and not the other fails here. Wording that
// names the domain (movie, series) is left out on purpose: titles and descriptions differ.
import {
  type AnyNodeDefinition,
  type AnyTrigger,
  nodeMetadata,
  pluginManifest,
  triggerMetadata,
} from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import radarr, {
  integration as radarrIntegration,
  trigger as radarrTrigger,
} from '../plugins/radarr/src/index.ts';
import sonarr, {
  integration as sonarrIntegration,
  trigger as sonarrTrigger,
} from '../plugins/sonarr/src/index.ts';

const suffix = (type: string) => type.slice(type.indexOf(':') + 1);

function nodeShape(node: AnyNodeDefinition) {
  const m = nodeMetadata(node);
  return {
    type: suffix(m.type),
    version: m.version,
    kind: m.kind,
    icon: m.icon,
    finishPhase: m.finishPhase,
    damagedOnly: m.damagedOnly,
    hooks: m.hooks,
    inputs: m.inputs.map((p) => [p.id, p.type]),
    outputs: m.outputs.map((p) => [p.id, p.type]),
    settingsSchema: m.settingsSchema,
    requires: m.requires,
    migrations: m.migrations.length,
  };
}

function pluginShape(plugin: typeof radarr) {
  const m = pluginManifest(plugin);
  return {
    sdk: m.sdk,
    nodes: m.nodes.map(suffix),
    triggers: m.triggers,
    hooks: m.hooks,
    network: m.network?.map((n) => n.setting),
  };
}

describe('Sonarr and Radarr parity', () => {
  it('expose the same nodes, node versions, hooks and triggers', () => {
    expect(pluginShape(sonarr)).toEqual(pluginShape(radarr));
  });

  it('give each node the same kind, phase, ports and settings', () => {
    expect(sonarr.nodes.map(nodeShape)).toEqual(radarr.nodes.map(nodeShape));
  });

  it('have the same integration settings and requirements', () => {
    const shape = (i: typeof radarrIntegration) => ({
      settings: Object.keys(i.settings.shape),
      allowedOrigins: i.allowedOrigins,
      minVersion: i.requires?.minVersion,
      hasTest: typeof i.test === 'function',
    });
    expect(shape(sonarrIntegration)).toEqual(shape(radarrIntegration));
  });

  it('have the same import trigger: id, auth, icon and settings', () => {
    const shape = (t: AnyTrigger) => {
      const { id, icon, auth, settingsSchema } = triggerMetadata(t);
      return { id, icon, auth, settingsSchema };
    };
    expect(shape(sonarrTrigger)).toEqual(shape(radarrTrigger));
  });
});
