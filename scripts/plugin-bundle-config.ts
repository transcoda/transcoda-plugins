// Shared tsdown config for every plugin: one self-contained ESM file per plugin,
// named <plugin>-<version>.js, with every dependency inlined. Only Node built-ins stay
// external; scripts/finalize-bundle.mjs enforces that and writes the checksum.
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'tsdown';

export function pluginBundleConfig(configUrl: string): UserConfig {
  const dir = dirname(fileURLToPath(configUrl));
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as { version: string };
  return defineConfig({
    cwd: dir,
    entry: { [`${basename(dir)}-${pkg.version}`]: 'src/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node24',
    outDir: 'dist',
    clean: true,
    dts: false,
    sourcemap: false,
    // Inline everything on purpose: plugins are never npm-installed.
    deps: { alwaysBundle: [/^(?!node:)/], onlyBundle: false },
    outExtensions: () => ({ js: '.js' }),
  });
}
