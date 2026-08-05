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
exports.UNKNOWN_PLUGIN_VERSION = exports.MAX_RESPONSE_BUFFER_BYTES = exports.DEFAULT_CONNECT_TIMEOUT_MS = exports.WAKE_RETRY_TIMEOUT_SEC = exports.WAKE_RETRY_TIMEOUT_MS = exports.WAKE_RETRY_INTERVAL_MS = exports.POWER_STATE_TTL_MS = exports.POWER_SET_TIMEOUT_MS = exports.HOMEKIT_WRITE_BUDGET_MS = exports.POLL_FAILURE_REWARN_MS = exports.POLL_FAILURES_BEFORE_UNKNOWN = exports.STATE_FRESHNESS_MS = exports.QUERY_BREAKER_MAX_COOLDOWN_MS = exports.QUERY_BREAKER_BASE_COOLDOWN_MS = exports.QUERY_BREAKER_FAILURE_THRESHOLD = exports.STATE_QUERY_RETRY_MS = exports.STATE_QUERY_RETRIES = exports.SET_VERIFY_ATTEMPTS = exports.SET_SETTLE_MS = exports.DEFAULT_REQUEST_TIMEOUT_MS = exports.MAX_ACCESSORY_TEXT_LENGTH = exports.MAX_HOSTNAME_LENGTH = exports.MAX_TCP_PORT = exports.MIN_TCP_PORT = exports.MAX_REFRESH_RATE_SEC = exports.MIN_REFRESH_RATE_SEC = exports.DEFAULT_REFRESH_RATE_SEC = exports.MAX_VOLUME = exports.MIN_VOLUME = exports.MANUFACTURER = exports.DEFAULT_MODEL = exports.DEFAULT_ZONE = exports.DEFAULT_CONTROL_PORT = exports.UUID_PREFIX = exports.PLATFORM_NAME = exports.PLUGIN_NAME = void 0;
exports.readPluginVersion = readPluginVersion;
const errors_1 = require("./utils/errors");
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
/** Manufacturer shown in HomeKit Accessory Information. */
exports.MANUFACTURER = 'AudioControl';
/** Minimum absolute volume level (X/XR protocol). */
exports.MIN_VOLUME = 0;
/** Maximum absolute volume level (X/XR protocol, 0x63). */
exports.MAX_VOLUME = 99;
/** Default polling interval (seconds) for refreshing accessory state. */
exports.DEFAULT_REFRESH_RATE_SEC = 90;
/** Minimum allowed polling interval (seconds). */
exports.MIN_REFRESH_RATE_SEC = 5;
/**
 * Maximum allowed polling interval (seconds), i.e. 24 hours.
 *
 * Chosen as a sanity limit rather than a technical boundary: the hard ceiling is
 * `2^31 - 1` ms (about 24.8 days), above which Node collapses a `setInterval`
 * delay to 1 ms and turns a huge refreshRate into a poll storm. Capping well
 * below that leaves the clamp obviously safe.
 */
exports.MAX_REFRESH_RATE_SEC = 86_400;
/** Lowest valid TCP port. */
exports.MIN_TCP_PORT = 1;
/** Highest valid TCP port. */
exports.MAX_TCP_PORT = 65_535;
/** Maximum length of a DNS name in text form (RFC 1035 caps the wire form at 255 octets). */
exports.MAX_HOSTNAME_LENGTH = 253;
/**
 * Longest name or model HomeKit will accept without truncating.
 *
 * HAP silently truncates a longer string and emits a characteristic warning for
 * every affected accessory on every restart.
 */
exports.MAX_ACCESSORY_TEXT_LENGTH = 64;
/**
 * How long to wait for a command response before failing the request.
 * AudioControl docs say the unit answers within 3 seconds.
 */
exports.DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
/**
 * How long to wait between verification attempts after a missing set ack.
 * XR units often apply RC5 / volume changes without echoing a frame while the
 * amp transitions; a short settle avoids racing the status query.
 */
exports.SET_SETTLE_MS = 1_500;
/**
 * How many state queries to make after a missing set ack, across power,
 * volume, and source sets.
 */
exports.SET_VERIFY_ATTEMPTS = 2;
/**
 * Extra state-query attempts after a ConnectionError.
 * XR units occasionally accept TCP then stay silent for one request.
 * Used for power, volume, and source queries.
 */
exports.STATE_QUERY_RETRIES = 1;
/** Delay before retrying a timed-out / closed state query. */
exports.STATE_QUERY_RETRY_MS = 500;
/**
 * Consecutive query failures before the client stops dialing a receiver that
 * looks absent. Sets always bypass the breaker, so a deliberate HomeKit action
 * is never refused — this only stops the poll loop from burning the whole
 * interval on connect timeouts when the unit is unplugged or off-network.
 */
exports.QUERY_BREAKER_FAILURE_THRESHOLD = 3;
/** First cool-off once the query breaker opens; doubles per further failure. */
exports.QUERY_BREAKER_BASE_COOLDOWN_MS = 30_000;
/** Ceiling for the query breaker cool-off. */
exports.QUERY_BREAKER_MAX_COOLDOWN_MS = 600_000;
/**
 * How long a polled reading may be trusted when deciding to skip a HomeKit
 * write because the zone already matches. Beyond this the receiver may have
 * been changed at the front panel, so the write is applied rather than dropped.
 */
exports.STATE_FRESHNESS_MS = 5_000;
/**
 * Consecutive poll failures before an accessory stops asserting its last known
 * value and reports HomeKit "No Response". Short streaks keep the old value so
 * a single timeout does not make the switch flicker.
 */
exports.POLL_FAILURES_BEFORE_UNKNOWN = 3;
/**
 * How often to repeat the warn-level poll failure line. Without this a receiver
 * offline for days is represented by one log line from the moment it went down.
 */
exports.POLL_FAILURE_REWARN_MS = 3_600_000;
/**
 * How long a HomeKit write may block before HAP gives up on it.
 *
 * HAP-NodeJS warns at `Accessory.TIMEOUT_WARNING` (3s) and abandons the write
 * at `TIMEOUT_WARNING + TIMEOUT_AFTER_WARNING` (9s total), returning
 * `OPERATION_TIMED_OUT` to the controller and discarding whatever the handler
 * eventually returns. So a set has to answer well inside that window and finish
 * any longer work in the background.
 */
exports.HOMEKIT_WRITE_BUDGET_MS = 2_500;
/**
 * Overall budget for a power set, including post-ack verification.
 *
 * Unbounded, the write plus two verification rounds can run for ~52s — long
 * past the point HAP stopped listening.
 */
exports.POWER_SET_TIMEOUT_MS = exports.HOMEKIT_WRITE_BUDGET_MS;
/**
 * How long a cached power reading may be trusted when a preset decides the zone
 * is in standby and reports Off without querying.
 *
 * Without an expiry, a receiver unplugged while last seen in standby would let
 * every preset re-confirm Off forever and never reach "No Response".
 */
exports.POWER_STATE_TTL_MS = 5 * 60_000;
/**
 * Wake-retry window shared by volume and source sets.
 *
 * Cold boot often reports power On before volume or input changes are accepted
 * (`0x85` / timeouts), so a HomeKit write retries politely rather than failing.
 * One set of constants rather than per-command copies: the two paths have never
 * had a reason to differ, and separate names implied a tunability that did not
 * exist.
 */
/** Delay between attempts while waiting for the receiver to finish waking. */
exports.WAKE_RETRY_INTERVAL_MS = 2_000;
/**
 * Maximum time a HomeKit preset On write will wait for the receiver to accept
 * the command (Shortcuts can block on this instead of a fixed Wait).
 */
exports.WAKE_RETRY_TIMEOUT_MS = 60_000;
/** {@link WAKE_RETRY_TIMEOUT_MS} in whole seconds, for log messages. */
exports.WAKE_RETRY_TIMEOUT_SEC = exports.WAKE_RETRY_TIMEOUT_MS / 1_000;
/** Maximum time allowed for establishing a TCP connection. */
exports.DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
/**
 * Cap on how many bytes a single TCP response may buffer before we abort.
 * Automation frames are a handful of bytes; this guards against a misbehaving peer.
 */
exports.MAX_RESPONSE_BUFFER_BYTES = 4_096;
/** Reported when the version cannot be read, so HomeKit still gets a valid value. */
exports.UNKNOWN_PLUGIN_VERSION = '0.0.0';
let cachedPluginVersion;
/**
 * Installed plugin version, used for HomeKit Accessory Information.
 *
 * Resolved via `require` rather than a static `import`: `package.json` lives
 * outside the TypeScript `rootDir` (`src/`), so importing it would alter the
 * emitted `dist/` layout.
 *
 * @param log - Optional sink for the one-time warning when the lookup fails;
 *   without it a packaging fault silently reports `0.0.0` forever, which makes
 *   version-specific bug reports impossible to triage.
 */
function readPluginVersion(log) {
    if (cachedPluginVersion !== undefined) {
        return cachedPluginVersion;
    }
    try {
        const pkg = require('../package.json');
        cachedPluginVersion = typeof pkg.version === 'string' && pkg.version.length > 0
            ? pkg.version
            : exports.UNKNOWN_PLUGIN_VERSION;
    }
    catch (error) {
        log?.warn?.(`Could not read plugin version from package.json (${(0, errors_1.describeError)(error)}); `
            + `reporting ${exports.UNKNOWN_PLUGIN_VERSION} as FirmwareRevision.`);
        cachedPluginVersion = exports.UNKNOWN_PLUGIN_VERSION;
    }
    return cachedPluginVersion;
}
//# sourceMappingURL=settings.js.map