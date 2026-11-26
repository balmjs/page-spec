import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL?.startsWith('file://') &&
      !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const base = resolve(parentDir, specifier);
      for (const candidate of [`${base}.ts`, `${base}.mts`, `${base}/index.ts`, `${base}.js`]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return {
            url: pathToFileURL(candidate).href,
            shortCircuit: true,
          };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
