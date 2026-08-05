/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

export { parseAccessoryContext } from './context'
export { describeError, describeErrorStack } from './errors'
export {
  ensureAccessorySerialNumber,
  newAccessorySerialNumber,
} from './serial'
export {
  ConfigValidationError,
  accessoryIdentityKey,
  forLog,
  isValidHost,
  resolveAccessories,
  resolvePort,
  resolveRefreshRateSec,
  validateConfig,
} from './validators'
export type { ConfigValidationResult } from './validators'
