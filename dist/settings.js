"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-wide constants for AudioControl Concert IP control.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RESPONSE_BUFFER_BYTES = exports.DEFAULT_CONNECT_TIMEOUT_MS = exports.VOLUME_READY_NOT_READY_LOG_AFTER_MS = exports.VOLUME_READY_TIMEOUT_MS = exports.VOLUME_READY_RETRY_INTERVAL_MS = exports.POWER_QUERY_RETRY_MS = exports.POWER_QUERY_RETRIES = exports.POWER_VERIFY_ATTEMPTS = exports.POWER_SETTLE_MS = exports.DEFAULT_REQUEST_TIMEOUT_MS = exports.MAX_REFRESH_RATE_SEC = exports.MIN_REFRESH_RATE_SEC = exports.DEFAULT_REFRESH_RATE_SEC = exports.MAX_VOLUME = exports.MIN_VOLUME = exports.DEFAULT_MODEL = exports.DEFAULT_ZONE = exports.DEFAULT_CONTROL_PORT = exports.UUID_PREFIX = exports.PLATFORM_NAME = exports.PLUGIN_NAME = void 0;
exports.readPluginVersion = readPluginVersion;
/** Name used to register the plugin with Homebridge (must match package.json name). */
exports.PLUGIN_NAME = 'homebridge-concert';
/** Platform identifier referenced in the user's Homebridge config. */
exports.PLATFORM_NAME = 'Concert';
/** Prefix used when generating stable HAP accessory UUIDs. */
exports.UUID_PREFIX = 'concert-';
/**
 * Default TCP port for AudioControl X/XR series IP automation control.
 *
 * @see AudioControl X/XR Series user manual — Automation Integration
 */
exports.DEFAULT_CONTROL_PORT = 50_000;
/** Default zone for automation commands (Zone 1 / master). */
exports.DEFAULT_ZONE = 1;
/** Default model shown in HomeKit Accessory Information. */
exports.DEFAULT_MODEL = 'AudioControl Concert XR-8S';
/** Minimum absolute volume level (X/XR protocol). */
exports.MIN_VOLUME = 0;
/** Maximum absolute volume level (X/XR protocol, 0x63). */
exports.MAX_VOLUME = 99;
/** Default polling interval (seconds) for refreshing accessory state. */
exports.DEFAULT_REFRESH_RATE_SEC = 90;
/** Minimum allowed polling interval (seconds). */
exports.MIN_REFRESH_RATE_SEC = 5;
/**
 * Maximum allowed polling interval (seconds).
 *
 * Values above this are clamped. Node collapses `setInterval` delays larger than
 * `2^31 - 1` ms to 1 ms, so an unbounded refreshRate can become a poll storm.
 */
exports.MAX_REFRESH_RATE_SEC = 86_400;
/**
 * How long to wait for a command response before failing the request.
 * AudioControl docs say the unit answers within 3 seconds.
 */
exports.DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
/**
 * How long to wait after a missing set ack before querying state.
 * XR units often apply RC5 / volume changes without echoing a frame while the
 * amp transitions; a short settle avoids racing the status query.
 */
exports.POWER_SETTLE_MS = 1_500;
/** How many settle+query attempts after a missing set ack. */
exports.POWER_VERIFY_ATTEMPTS = 2;
/**
 * Extra state-query attempts after a ConnectionError.
 * XR units occasionally accept TCP then stay silent for one request.
 * Used for both power and volume queries.
 */
exports.POWER_QUERY_RETRIES = 1;
/** Delay before retrying a timed-out / closed state query. */
exports.POWER_QUERY_RETRY_MS = 500;
/**
 * Delay between volume-set attempts while waiting for the receiver to accept
 * volume after a cold wake (standby → on).
 */
exports.VOLUME_READY_RETRY_INTERVAL_MS = 2_000;
/**
 * Maximum time a HomeKit volume-preset On write will wait for the receiver to
 * accept volume (Shortcuts can block on this instead of a fixed Wait).
 */
exports.VOLUME_READY_TIMEOUT_MS = 60_000;
/**
 * How long to wait before logging "device is not ready" during a volume-set
 * retry. Normal XR wake is ~20s; stay quiet until this threshold so healthy
 * boots do not spam the log.
 */
exports.VOLUME_READY_NOT_READY_LOG_AFTER_MS = 30_000;
/** Maximum time allowed for establishing a TCP connection. */
exports.DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
/**
 * Cap on how many bytes a single TCP response may buffer before we abort.
 * Automation frames are a handful of bytes; this guards against a misbehaving peer.
 */
exports.MAX_RESPONSE_BUFFER_BYTES = 4_096;
/**
 * Installed plugin version, used for HomeKit Accessory Information.
 *
 * Resolved via `require` rather than a static `import`: `package.json` lives
 * outside the TypeScript `rootDir` (`src/`), so importing it would alter the
 * emitted `dist/` layout.
 */
function readPluginVersion() {
    try {
        return require('../package.json').version || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
//# sourceMappingURL=settings.js.map