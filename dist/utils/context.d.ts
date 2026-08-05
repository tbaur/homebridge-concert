/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Validation for accessory context restored from the Homebridge cache.
 */
import type { PlatformAccessory } from 'homebridge';
import type { AccessoryContext } from '../types';
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
export declare function parseAccessoryContext(accessory: PlatformAccessory): AccessoryContext;
//# sourceMappingURL=context.d.ts.map