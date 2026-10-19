/** Module boundaries from docs/03-architecture.md §4.1. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'shared-is-pure',
      comment: 'packages/shared is consumed by the renderer: no app/package imports and no Node built-ins',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: ['^apps/', '^packages/(?!shared/)'], dependencyTypes: ['local', 'aliased-workspace', 'npm'] },
    },
    {
      name: 'shared-no-node-builtins',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'web-depends-only-on-shared',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^(packages/(?!shared/)|apps/(?!web/))' },
    },
    {
      name: 'server-core-not-modules',
      severity: 'error',
      from: { path: '^packages/server/src/core/' },
      to: { path: '^packages/server/src/modules/' },
    },
    {
      name: 'modules-via-index-only',
      comment: 'Cross-module imports go through the other module index.ts',
      severity: 'error',
      from: { path: '^packages/server/src/modules/([^/]+)/' },
      to: {
        path: '^packages/server/src/modules/[^/]+/',
        pathNot: ['^packages/server/src/modules/$1/', '/index\\.ts$'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['/out/', '/dist/', 'node_modules'] },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.tsx', '.js'],
    },
  },
};
