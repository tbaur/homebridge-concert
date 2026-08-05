"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Public surface of the receiver client, for the platform and
 * device handlers. Protocol internals are imported from `./protocol` directly
 * by the few places that build or parse frames.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSourceDefinition = exports.isReceiverNotReadyError = exports.ConcertClient = void 0;
var client_1 = require("./client");
Object.defineProperty(exports, "ConcertClient", { enumerable: true, get: function () { return client_1.ConcertClient; } });
Object.defineProperty(exports, "isReceiverNotReadyError", { enumerable: true, get: function () { return client_1.isReceiverNotReadyError; } });
var protocol_1 = require("./protocol");
Object.defineProperty(exports, "resolveSourceDefinition", { enumerable: true, get: function () { return protocol_1.resolveSourceDefinition; } });
//# sourceMappingURL=index.js.map