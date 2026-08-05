/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Validation for accessory context restored from the Homebridge cache.
 */

import type { PlatformAccessory } from 'homebridge'

import { DEFAULT_MODEL } from '../settings'
import { isAccessoryKind } from '../types'
import type { AccessoryContext } from '../types'

/**
 * Read an accessory's context, checking the fields the handlers depend on.
 *
 * `PlatformAccessory.context` is `any`-shaped data deserialized from Homebridge's
 * on-disk cache, so it can predate the running plugin version. Asserting the
 * type instead of checking it let a cache without `zone` silently fall back to
 * zone 1, quietly pointing a zone-2 accessory at the main zone.
 *
 * @throws {Error} when a required field is missing or malformed
 */
export function parseAccessoryContext(accessory: PlatformAccessory): AccessoryContext {
  const context = accessory.context as Partial<AccessoryContext> | undefined
  const label = accessory.displayName

  if (!context || typeof context !== 'object') {
    throw new Error(`${label}: accessory context is missing`)
  }
  if (!isAccessoryKind(context.kind)) {
    throw new Error(`${label}: accessory context has unknown kind "${String(context.kind)}"`)
  }
  if (context.zone !== 1 && context.zone !== 2) {
    throw new Error(`${label}: accessory context has invalid zone "${String(context.zone)}"`)
  }

  return {
    ...context,
    kind: context.kind,
    zone: context.zone,
    model: typeof context.model === 'string' && context.model.length > 0
      ? context.model
      : DEFAULT_MODEL,
  } as AccessoryContext
}
