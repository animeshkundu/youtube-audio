module.exports = {
  env: {
    browser: true,
    es2021: true,
    jest: true,
    webextensions: true,
    node: true,
  },
  extends: ['eslint:recommended', 'plugin:jest/recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['jest'],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'warn',
    'prefer-const': 'error',
    'no-var': 'error',
  },
  globals: {
    chrome: 'readonly',
    browser: 'readonly',
    global: 'writable',
    createMockVideoElement: 'readonly',
  },
  overrides: [
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true,
        node: true,
      },
      globals: {
        global: 'writable',
        createMockVideoElement: 'readonly',
        waitForDom: 'readonly',
      },
    },
    {
      // Legacy browser extension code - allow var for compatibility
      files: ['js/**/*.js'],
      rules: {
        'no-var': 'off',
        'prefer-const': 'off',
      },
    },
  ],
};
