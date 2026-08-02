"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Stable random HomeKit SerialNumber helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.newAccessorySerialNumber = newAccessorySerialNumber;
exports.ensureAccessorySerialNumber = ensureAccessorySerialNumber;
const node_crypto_1 = require("node:crypto");
/** Fresh opaque serial for a newly registered accessory. */
function newAccessorySerialNumber() {
    return (0, node_crypto_1.randomUUID)();
}
/**
 * Return the persisted serial from accessory context, generating and storing
 * one if missing (first launch or pre-serial cache).
 */
function ensureAccessorySerialNumber(accessory) {
    const context = accessory.context;
    if (typeof context.serialNumber === 'string' && context.serialNumber.length > 0) {
        return context.serialNumber;
    }
    const serialNumber = newAccessorySerialNumber();
    context.serialNumber = serialNumber;
    return serialNumber;
}
//# sourceMappingURL=serial.js.map