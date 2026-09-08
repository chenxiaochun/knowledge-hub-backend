import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'jest'],
  categories: {
    correctness: 'error',
  },
  env: {
    builtin: true,
    node: true,
  },
  ignorePatterns: ['dist', 'coverage', 'node_modules'],
  rules: {
    'typescript/no-explicit-any': 'off',
  },
  overrides: [
    {
      files: ['**/*.{spec,test}.ts', 'test/**/*.ts'],
      env: {
        jest: true,
      },
    },
  ],
});
