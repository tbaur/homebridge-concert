/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-wide constants for AudioControl Concert IP control.
 */
/** Name used to register the plugin with Homebridge (must match package.json name). */
export declare const PLUGIN_NAME = "homebridge-concert";
/** Platform identifier referenced in the user's Homebridge config. */
export declare const PLATFORM_NAME = "Concert";
/** Prefix used when generating stable HAP accessory UUIDs. */
export declare const UUID_PREFIX = "concert-";
/**
 * Default TCP port for AudioControl X/XR series IP automation control.
 *
 * @see AudioControl X/XR Series user manual — Automation Integration
 */
export declare const DEFAULT_CONTROL_PORT = 50000;
/** Default zone for automation commands (Zone 1 / master). */
export declare const DEFAULT_ZONE = 1;
/** Default model shown in HomeKit Accessory Information. */
export declare const DEFAULT_MODEL = "Concert XR-8S";
/** Minimum absolute volume level (X/XR protocol). */
export declare const MIN_VOLUME = 0;
/** Maximum absolute volume level (X/XR protocol, 0x63). */
export declare const MAX_VOLUME = 99;
/** Default polling interval (seconds) for refreshing accessory state. */
export declare const DEFAULT_REFRESH_RATE_SEC = 90;
/** Minimum allowed polling interval (seconds). */
export declare const MIN_REFRESH_RATE_SEC = 5;
/**
 * Maximum allowed polling interval (seconds).
 *
 * Values above this are clamped. Node collapses `setInterval` delays larger than
 * `2^31 - 1` ms to 1 ms, so an unbounded refreshRate can become a poll storm.
 */
export declare const MAX_REFRESH_RATE_SEC = 86400;
/**
 * How long to wait for a command response before failing the request.
 * AudioControl docs say the unit answers within 3 seconds.
 */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
/**
 * How long to wait after a missing set ack before querying state.
 * XR units often apply RC5 / volume changes without echoing a frame while the
 * amp transitions; a short settle avoids racing the status query.
 */
export declare const POWER_SETTLE_MS = 1500;
/** How many settle+query attempts after a missing set ack. */
export declare const POWER_VERIFY_ATTEMPTS = 2;
/**
 * Extra state-query attempts after a ConnectionError.
 * XR units occasionally accept TCP then stay silent for one request.
 * Used for both power and volume queries.
 */
export declare const POWER_QUERY_RETRIES = 1;
/** Delay before retrying a timed-out / closed state query. */
export declare const POWER_QUERY_RETRY_MS = 500;
/** Maximum time allowed for establishing a TCP connection. */
export declare const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
/**
 * Cap on how many bytes a single TCP response may buffer before we abort.
 * Automation frames are a handful of bytes; this guards against a misbehaving peer.
 */
export declare const MAX_RESPONSE_BUFFER_BYTES = 4096;
/**
 * Installed plugin version, used for HomeKit Accessory Information.
 *
 * Resolved via `require` rather than a static `import`: `package.json` lives
 * outside the TypeScript `rootDir` (`src/`), so importing it would alter the
 * emitted `dist/` layout.
 */
export declare function readPluginVersion(): string;
//# sourceMappingURL=settings.d.ts.map