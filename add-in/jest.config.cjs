/** @type {import('jest').Config} */
//
// CJS preset. ts-jest emits CommonJS (overriding tsconfig's `module`), Jest's
// resolver picks each Fluent package's `main` (CJS) over `module` (ESM), and
// transitive subpath imports like `@fluentui/react-icons/lib/providers` resolve
// via the package's `exports` map. No moduleNameMapper hacks needed.
//
// The `.js` extension stripper still maps relative `./foo.js` → `./foo` so
// TypeScript ESM-style imports keep working under CJS resolution.
module.exports = {
  preset: "ts-jest/presets/default",
  testEnvironment: "jsdom",
  setupFiles: ["<rootDir>/jest.setup.cjs"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          module: "commonjs",
          target: "es2020",
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)"],
};
