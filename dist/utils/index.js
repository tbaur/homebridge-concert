"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateConfig = exports.resolveRefreshRateSec = exports.resolvePort = exports.resolveAccessories = exports.isValidHost = exports.forLog = exports.accessoryIdentityKey = exports.ConfigValidationError = exports.newAccessorySerialNumber = exports.ensureAccessorySerialNumber = exports.describeErrorStack = exports.describeError = exports.parseAccessoryContext = void 0;
var context_1 = require("./context");
Object.defineProperty(exports, "parseAccessoryContext", { enumerable: true, get: function () { return context_1.parseAccessoryContext; } });
var errors_1 = require("./errors");
Object.defineProperty(exports, "describeError", { enumerable: true, get: function () { return errors_1.describeError; } });
Object.defineProperty(exports, "describeErrorStack", { enumerable: true, get: function () { return errors_1.describeErrorStack; } });
var serial_1 = require("./serial");
Object.defineProperty(exports, "ensureAccessorySerialNumber", { enumerable: true, get: function () { return serial_1.ensureAccessorySerialNumber; } });
Object.defineProperty(exports, "newAccessorySerialNumber", { enumerable: true, get: function () { return serial_1.newAccessorySerialNumber; } });
var validators_1 = require("./validators");
Object.defineProperty(exports, "ConfigValidationError", { enumerable: true, get: function () { return validators_1.ConfigValidationError; } });
Object.defineProperty(exports, "accessoryIdentityKey", { enumerable: true, get: function () { return validators_1.accessoryIdentityKey; } });
Object.defineProperty(exports, "forLog", { enumerable: true, get: function () { return validators_1.forLog; } });
Object.defineProperty(exports, "isValidHost", { enumerable: true, get: function () { return validators_1.isValidHost; } });
Object.defineProperty(exports, "resolveAccessories", { enumerable: true, get: function () { return validators_1.resolveAccessories; } });
Object.defineProperty(exports, "resolvePort", { enumerable: true, get: function () { return validators_1.resolvePort; } });
Object.defineProperty(exports, "resolveRefreshRateSec", { enumerable: true, get: function () { return validators_1.resolveRefreshRateSec; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return validators_1.validateConfig; } });
//# sourceMappingURL=index.js.map