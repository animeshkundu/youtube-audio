module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true,
    webextensions: true,
  },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['error', 'warn'] }],
    'no-var': 'error',
    'prefer-const': 'error',
  },
  ignorePatterns: ['.output/', '.wxt/', 'coverage/', 'dist/', 'node_modules/'],
  overrides: [
    {
      files: ['tests/e2e/*.mjs'],
      rules: {
        'no-unused-vars': 'off',
        'no-empty': 'off',
      },
    },
  ],
};
