"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Type definitions for plugin config and device context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAccessoryKind = isAccessoryKind;
/**
 * Narrow an unknown value to an {@link AccessoryKind}.
 *
 * Shared so config validation and cache validation cannot drift apart; the
 * exhaustive `switch` in the platform will not catch a missed update here,
 * because these narrow from `unknown`.
 */
function isAccessoryKind(value) {
    return value === 'power' || value === 'volumePreset' || value === 'sourcePreset';
}
//# sourceMappingURL=index.js.map