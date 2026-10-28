// Cross-checks core's examples/workflows/keep-my-languages-plugins.json against the real plugin node
// definitions in this repo. Core's checkout is expected next to this one (../transcoda), as in CI.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnyNodeDefinition, JsonValue, PortSpec } from '@transcoda/sdk';
import { parseSettings } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import jellyfin from '../plugins/jellyfin/src/index.ts';
import ntfy from '../plugins/ntfy/src/index.ts';
import sonarr from '../plugins/sonarr/src/index.ts';

interface ExampleNode {
  id: string;
  type: string;
  typeVersion: number;
  settings: JsonValue;
}
interface ExampleEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}

const root = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(
  root,
  '..',
  '..',
  'transcoda',
  'examples',
  'workflows',
  'keep-my-languages-plugins.json',
);
const example = JSON.parse(readFileSync(examplePath, 'utf8')) as {
  nodes: ExampleNode[];
  edges: ExampleEdge[];
};

const defs = new Map<string, AnyNodeDefinition>(
  [sonarr, jellyfin, ntfy].flatMap((p) => p.nodes.map((n) => [n.type, n] as const)),
);

// The core nodes the example wires to plugin nodes (apps/server/src/nodes/core: filePort, languageInput,
// render's Done and Damaged).
const file: PortSpec = { id: 'file', label: 'File', type: 'file' };
const language: PortSpec = { id: 'language', label: 'Language', type: 'data:language' };
const CORE: Record<string, { inputs: PortSpec[]; outputs: PortSpec[] }> = {
  'core:input-manual': { inputs: [], outputs: [file] },
  'core:keep-languages': { inputs: [file, language], outputs: [file] },
  'core:remove-duplicate-audio': { inputs: [file], outputs: [file] },
  'core:set-default-track': { inputs: [file], outputs: [file] },
  'core:reorder-tracks': { inputs: [file], outputs: [file] },
  'core:cover-attachments': { inputs: [file], outputs: [file] },
  'core:render': {
    inputs: [file],
    outputs: [
      { id: 'done', label: 'Done', type: 'file' },
      { id: 'damaged', label: 'Damaged', type: 'file' },
    ],
  },
  'core:replace-original': { inputs: [file], outputs: [file] },
};

const nodeById = new Map(example.nodes.map((n) => [n.id, n]));
const pluginNodes = example.nodes.filter((n) => !n.type.startsWith('core:'));

function portsOf(node: ExampleNode): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const def = defs.get(node.type);
  if (def) return def;
  const core = CORE[node.type];
  if (!core) throw new Error(`example uses ${node.type}, unknown to this cross-check`);
  return core;
}

describe('keep-my-languages-plugins example vs the real plugin definitions', () => {
  it('uses plugin nodes of all three plugins it needs', () => {
    expect(pluginNodes.map((n) => n.type).sort()).toEqual([
      'jellyfin:refresh',
      'ntfy:notify',
      'sonarr:original-language',
      'sonarr:rescan',
    ]);
  });

  it.each(pluginNodes.map((n) => [n.type, n] as const))(
    '%s: a real definition, current version, settings that parse',
    (type, node) => {
      const def = defs.get(type);
      expect(def, `no definition for ${type}`).toBeDefined();
      if (!def) return;
      expect(node.typeVersion).toBe(def.version);
      const parsed = parseSettings(def, node.settings);
      expect(parsed, JSON.stringify(parsed)).toMatchObject({ ok: true });
    },
  );

  it('every edge joins existing ports of the same type', () => {
    for (const edge of example.edges) {
      const from = nodeById.get(edge.from.node);
      const to = nodeById.get(edge.to.node);
      expect(from, `edge ${edge.id}: unknown from node`).toBeDefined();
      expect(to, `edge ${edge.id}: unknown to node`).toBeDefined();
      if (!from || !to) continue;
      const out = portsOf(from).outputs.find((p) => p.id === edge.from.port);
      const inp = portsOf(to).inputs.find((p) => p.id === edge.to.port);
      expect(out, `edge ${edge.id}: ${from.type} has no output ${edge.from.port}`).toBeDefined();
      expect(inp, `edge ${edge.id}: ${to.type} has no input ${edge.to.port}`).toBeDefined();
      expect(out?.type, `edge ${edge.id}: port types differ`).toBe(inp?.type);
    }
  });

  it('every required input of a plugin node is wired', () => {
    for (const node of pluginNodes) {
      const def = defs.get(node.type);
      for (const port of def?.inputs ?? []) {
        if (port.required === false) continue;
        const wired = example.edges.some((e) => e.to.node === node.id && e.to.port === port.id);
        expect(wired, `${node.id}.${port.id} is not wired`).toBe(true);
      }
    }
  });

  it('the plugin finish nodes run after the write, each from the replace node, in distinct phases', () => {
    const writer = example.nodes.find((n) => n.type === 'core:replace-original');
    expect(writer).toBeDefined();
    const finishers = pluginNodes.filter((n) => defs.get(n.type)?.kind === 'finish');
    expect(finishers.map((n) => defs.get(n.type)?.finishPhase).sort()).toEqual([
      'library-manager',
      'media-server',
      'notify',
    ]);
    for (const node of finishers) {
      const def = defs.get(node.type);
      expect(def?.outputs).toEqual([]);
      const fromWriter = example.edges.some(
        (e) => e.from.node === writer?.id && e.to.node === node.id && e.to.port === 'file',
      );
      expect(fromWriter, `${node.id} is not fed by the replace node`).toBe(true);
    }
  });

  it('the data node feeds core and has no file input', () => {
    const orig = example.nodes.find((n) => n.type === 'sonarr:original-language');
    const def = orig && defs.get(orig.type);
    expect(def?.kind).toBe('data');
    expect(def?.outputs.map((p) => p.id)).toContain('language');
    const feeds = example.edges.filter((e) => e.from.node === orig?.id);
    expect(feeds.map((e) => `${e.from.port}->${e.to.node}.${e.to.port}`)).toEqual([
      'language->languages.language',
    ]);
  });
});
