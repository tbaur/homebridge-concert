/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Stable random HomeKit SerialNumber helpers.
 */

import { randomUUID } from 'node:crypto'

import type { PlatformAccessory } from 'homebridge'

import type { AccessoryContext } from '../types'

/** Fresh opaque serial for a newly registered accessory. */
export function newAccessorySerialNumber(): string {
  return randomUUID()
}

/**
 * Return the persisted serial from accessory context, generating and storing
 * one if missing (first launch or pre-serial cache).
 */
export function ensureAccessorySerialNumber(accessory: PlatformAccessory): string {
  const context = accessory.context as AccessoryContext
  if (typeof context.serialNumber === 'string' && context.serialNumber.length > 0) {
    return context.serialNumber
  }
  const serialNumber = newAccessorySerialNumber()
  context.serialNumber = serialNumber
  return serialNumber
}
