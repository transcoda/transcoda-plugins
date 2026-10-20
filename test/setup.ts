// Runs before every test file. Plugin tests script `ctx.plugin.fetch` through the SDK's
// fakePluginContext (which throws FetchFailed on an unscripted call); the global fetch is
// stubbed so nothing can reach a socket by accident.
globalThis.fetch = (() => {
  throw new Error('tests must not use the network; script ctx.plugin.fetch');
}) as typeof fetch;
