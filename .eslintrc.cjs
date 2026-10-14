module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: { browser: true, node: true },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  ignorePatterns: ['templates/'],
  rules: {
    'import/extensions': ['error', { js: 'always' }],
    'import/prefer-default-export': 'off',
    'import/no-cycle': 'off',
    // Adobe drop-ins are peers resolved by the storefront import map, not installed here.
    'import/no-unresolved': ['error', { ignore: ['^@dropins/'] }],
    'import/no-extraneous-dependencies': 'off',
    'linebreak-style': ['error', 'unix'],
    'no-param-reassign': [2, { props: false }],
    'no-use-before-define': [2, { functions: false }],
    'no-console': ['error', { allow: ['warn', 'error', 'info', 'debug'] }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-underscore-dangle': 'off',
  },
  overrides: [
    {
      // Node tooling (CLI, verification), not browser code.
      files: ['bin/**/*.js', 'cli/**/*.js', 'scripts/**/*.mjs'],
      env: { browser: false, node: true },
      rules: {
        'no-restricted-syntax': 'off',
        'no-continue': 'off',
        'no-console': 'off',
        'no-await-in-loop': 'off',
      },
    },
  ],
};
