/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Configuration validation. Validates the Homebridge platform
 * config at startup so misconfiguration fails fast with an actionable message.
 */

import {
  DEFAULT_CONTROL_PORT,
  DEFAULT_REFRESH_RATE_SEC,
  DEFAULT_ZONE,
  MAX_REFRESH_RATE_SEC,
  MAX_VOLUME,
  MIN_REFRESH_RATE_SEC,
  MIN_VOLUME,
} from '../settings'
import type {
  AccessoryKind,
  ConcertAccessoryConfig,
  ConcertPlatformConfig,
  ResolvedAccessory,
} from '../types'

/**
 * Outcome of validating the platform config.
 *
 * `errors` are fatal — the plugin cannot start. `warnings` are non-fatal — the
 * plugin starts but a value was missing/out of range and a default/clamp was applied.
 */
export interface ConfigValidationResult {
  errors: string[]
  warnings: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * True when `value` looks like a usable hostname or IPv4/IPv6 address.
 *
 * Rejects `host:port` forms (except bracketed IPv6) so a combined target cannot
 * silently fail later in `net.createConnection`.
 */
export function isValidHost(value: string): boolean {
  const host = value.trim()
  if (host.length === 0 || host.length > 253) {
    return false
  }
  // Reject characters that would make a TCP target ambiguous or unsafe.
  if (/[\s/\\?#]/.test(host)) {
    return false
  }
  // Bare IPv6 may contain colons; require brackets when using that form.
  if (host.includes(':')) {
    if (!(host.startsWith('[') && host.includes(']'))) {
      return false
    }
  }
  return true
}

function isAccessoryKind(value: unknown): value is AccessoryKind {
  return value === 'power' || value === 'volumePreset'
}

/** Stable identity key used for duplicate detection and UUID generation. */
export function accessoryIdentityKey(accessory: ResolvedAccessory): string {
  if (accessory.kind === 'volumePreset') {
    return `z${accessory.zone}:vol:${accessory.volume}`
  }
  return `z${accessory.zone}:power`
}

/**
 * Validate the platform config.
 *
 * Fatal: missing/invalid `host`, missing/invalid `accessories`.
 * Non-fatal: out-of-range `port` or `refreshRate` — those produce warnings and
 * fall back/clamp via the resolvers.
 */
export function validateConfig(config: ConcertPlatformConfig | undefined): ConfigValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config || typeof config !== 'object') {
    return { errors: ['Platform configuration is missing.'], warnings }
  }

  if (!isNonEmptyString(config.host)) {
    errors.push('host is required (IP address or hostname of the AudioControl Concert receiver).')
  } else if (!isValidHost(config.host)) {
    errors.push(
      `host "${config.host}" is not a valid hostname or IP address `
      + '(do not include a port; use the port option instead).',
    )
  }

  if (config.port !== undefined) {
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
      warnings.push(`port ${String(config.port)} is invalid; using default ${DEFAULT_CONTROL_PORT}.`)
    }
  }

  const refreshRate = config.options?.refreshRate
  if (refreshRate !== undefined) {
    if (typeof refreshRate !== 'number' || !Number.isInteger(refreshRate) || Number.isNaN(refreshRate)) {
      warnings.push(
        `options.refreshRate ${String(refreshRate)} is invalid; using default ${DEFAULT_REFRESH_RATE_SEC}.`,
      )
    } else if (refreshRate < MIN_REFRESH_RATE_SEC) {
      warnings.push(
        `options.refreshRate ${refreshRate}s is below the ${MIN_REFRESH_RATE_SEC}s minimum; `
        + `using default ${DEFAULT_REFRESH_RATE_SEC}.`,
      )
    } else if (refreshRate > MAX_REFRESH_RATE_SEC) {
      warnings.push(
        `options.refreshRate ${refreshRate}s is above the ${MAX_REFRESH_RATE_SEC}s maximum; it will be clamped.`,
      )
    }
  }

  if (!Array.isArray(config.accessories) || config.accessories.length === 0) {
    errors.push('accessories is required and must contain at least one entry.')
  } else {
    const seen = new Set<string>()
    config.accessories.forEach((entry, index) => {
      const label = `accessories[${index}]`
      const resolved = tryResolveAccessory(entry, label, errors)
      if (!resolved) {
        return
      }
      const key = accessoryIdentityKey(resolved)
      if (seen.has(key)) {
        errors.push(`${label} duplicates another accessory (${key}).`)
      } else {
        seen.add(key)
      }
    })
  }

  return { errors, warnings }
}

/**
 * Resolve and validate accessories after `validateConfig` has reported no errors.
 *
 * Zone defaults to 1 when omitted or invalid (invalid zone already fatal when
 * validating entries that set an explicit bad zone).
 */
export function resolveAccessories(config: ConcertPlatformConfig): ResolvedAccessory[] {
  const errors: string[] = []
  const resolved: ResolvedAccessory[] = []
  for (const [index, entry] of (config.accessories ?? []).entries()) {
    const accessory = tryResolveAccessory(entry, `accessories[${index}]`, errors)
    if (accessory) {
      resolved.push(accessory)
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }
  return resolved
}

function tryResolveAccessory(
  entry: ConcertAccessoryConfig | undefined,
  label: string,
  errors: string[],
): ResolvedAccessory | undefined {
  if (!entry || typeof entry !== 'object') {
    errors.push(`${label} must be an object.`)
    return undefined
  }

  if (!isAccessoryKind(entry.type)) {
    errors.push(`${label}.type must be "power" or "volumePreset".`)
    return undefined
  }

  if (!isNonEmptyString(entry.name)) {
    errors.push(`${label}.name is required.`)
    return undefined
  }

  let zone = DEFAULT_ZONE
  if (entry.zone !== undefined) {
    if (entry.zone !== 1 && entry.zone !== 2) {
      errors.push(`${label}.zone must be 1 or 2.`)
      return undefined
    }
    zone = entry.zone
  }

  if (entry.type === 'power') {
    return {
      kind: 'power',
      name: entry.name.trim(),
      zone,
    }
  }

  if (
    typeof entry.volume !== 'number'
    || !Number.isInteger(entry.volume)
    || entry.volume < MIN_VOLUME
    || entry.volume > MAX_VOLUME
  ) {
    errors.push(
      `${label}.volume is required for volumePreset and must be an integer `
      + `${MIN_VOLUME}–${MAX_VOLUME}.`,
    )
    return undefined
  }

  return {
    kind: 'volumePreset',
    name: entry.name.trim(),
    zone,
    volume: entry.volume,
  }
}

/** Resolve a usable TCP port, falling back to the AudioControl default. */
export function resolvePort(port: number | undefined): number {
  if (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65_535) {
    return port
  }
  return DEFAULT_CONTROL_PORT
}

/** Resolve a usable zone number (1 or 2). */
export function resolveZone(zone: number | undefined): number {
  if (zone === 1 || zone === 2) {
    return zone
  }
  return DEFAULT_ZONE
}

/**
 * Resolve a usable refresh interval in seconds.
 *
 * Out-of-range values fall back to `fallback` (below minimum / non-integer) or
 * are clamped to {@link MAX_REFRESH_RATE_SEC} (above maximum).
 */
export function resolveRefreshRateSec(refreshRate: number | undefined, fallback: number): number {
  if (typeof refreshRate !== 'number' || !Number.isInteger(refreshRate) || Number.isNaN(refreshRate)) {
    return fallback
  }
  if (refreshRate < MIN_REFRESH_RATE_SEC) {
    return fallback
  }
  if (refreshRate > MAX_REFRESH_RATE_SEC) {
    return MAX_REFRESH_RATE_SEC
  }
  return refreshRate
}
