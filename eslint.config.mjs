import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', '.test-build/**', 'coverage/**', 'test/fixtures/**', '**/*.d.ts'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.test.ts'],
    rules: {
      /**
       * Test code may use non-null assertions for brevity.
       */
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
