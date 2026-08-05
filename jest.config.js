/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * Jest configuration for sandboxed testing.
 * All tests run in isolation with mocked dependencies.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Mock lifecycle is handled here rather than in per-suite hooks.
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  // Barrels are listed individually: a blanket `!src/**/index.ts` also excluded
  // `src/index.ts` (the plugin entry point) and `src/errors/index.ts`, both of
  // which carry real logic.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/api/index.ts',
    '!src/devices/index.ts',
    '!src/types/index.ts',
    '!src/utils/index.ts',
    '!src/settings.ts',
  ],

  testMatch: [
    '**/tests/unit/**/*.test.ts',
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],

  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  testTimeout: 10_000,
  verbose: true,
}
