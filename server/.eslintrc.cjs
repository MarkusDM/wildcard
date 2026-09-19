module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  extends: ['eslint:recommended'],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist'],
  rules: {
    'no-unused-vars': 'off',
  },
};
