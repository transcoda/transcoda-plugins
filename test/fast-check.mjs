// How many cases every fast-check property runs: FC_NUM_RUNS, or 100 so `pnpm test` stays fast.
// No fixed seed, so each run tries new inputs. A failure prints the `seed` and `path` that
// reproduce it; see docs/maintaining.md, "Property tests".
import fc from 'fast-check';

export function configureFastCheck() {
  const runs = Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10);
  fc.configureGlobal({ numRuns: Number.isInteger(runs) && runs > 0 ? runs : 100 });
}
