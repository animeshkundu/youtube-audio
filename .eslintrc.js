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
    // Property descriptor get/set closures legitimately need the outer instance captured
    // as `handle`; the rule stays active (error) for every other alias.
    '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['handle'] }],
    'no-console': ['warn', { allow: ['error', 'warn'] }],
    'no-var': 'error',
    'prefer-const': 'error',
  },
  ignorePatterns: ['.output/', '.wxt/', 'coverage/', 'dist/', 'node_modules/'],
  overrides: [
    {
      // e2e probe/bench scripts are throwaway CLI utilities, not shipped code.
      files: ['tests/e2e/**/*.mjs'],
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'no-empty': 'off',
        'no-console': 'off',
        'no-inner-declarations': 'off',
      },
    },
  ],
};
