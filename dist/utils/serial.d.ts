/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Stable random HomeKit SerialNumber helpers.
 */
import type { PlatformAccessory } from 'homebridge';
/** Fresh opaque serial for a newly registered accessory. */
export declare function newAccessorySerialNumber(): string;
/**
 * Return the persisted serial from accessory context, generating and storing
 * one if missing (first launch or pre-serial cache).
 */
export declare function ensureAccessorySerialNumber(accessory: PlatformAccessory): string;
//# sourceMappingURL=serial.d.ts.map