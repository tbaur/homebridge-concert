/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Plugin-wide constants for AudioControl Concert IP control.
 */

/** Name used to register the plugin with Homebridge (must match package.json name). */
export const PLUGIN_NAME = 'homebridge-concert'

/** Platform identifier referenced in the user's Homebridge config. */
export const PLATFORM_NAME = 'Concert'

/** Prefix used when generating stable HAP accessory UUIDs. */
export const UUID_PREFIX = 'concert-'

/**
 * Default TCP port for AudioControl X/XR series IP automation control.
 *
 * @see AudioControl X/XR Series user manual — Automation Integration
 */
export const DEFAULT_CONTROL_PORT = 50_000

/** Default zone for power commands (Zone 1 / master). */
export const DEFAULT_ZONE = 1

/** Default polling interval (seconds) for refreshing power state. */
export const DEFAULT_REFRESH_RATE_SEC = 30

/** Minimum allowed polling interval (seconds). */
export const MIN_REFRESH_RATE_SEC = 5

/**
 * Maximum allowed polling interval (seconds).
 *
 * Values above this are clamped. Node collapses `setInterval` delays larger than
 * `2^31 - 1` ms to 1 ms, so an unbounded refreshRate can become a poll storm.
 */
export const MAX_REFRESH_RATE_SEC = 86_400

/**
 * How long to wait for a command response before failing the request.
 * AudioControl docs say the unit answers within 3 seconds.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

/** Maximum time allowed for establishing a TCP connection. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000

/**
 * Cap on how many bytes a single TCP response may buffer before we abort.
 * Power frames are a handful of bytes; this guards against a misbehaving peer.
 */
export const MAX_RESPONSE_BUFFER_BYTES = 4_096

/**
 * Installed plugin version, used for HomeKit Accessory Information.
 *
 * Resolved via `require` rather than a static `import`: `package.json` lives
 * outside the TypeScript `rootDir` (`src/`), so importing it would alter the
 * emitted `dist/` layout.
 */
export function readPluginVersion(): string {
  try {
    return (require('../package.json').version as string) || '0.0.0'
  } catch {
    return '0.0.0'
  }
}
