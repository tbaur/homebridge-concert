/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured receiver input / source.
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'
import { HAPStatus } from 'homebridge'

import type { ConcertClient } from '../api'
import { resolveSourceDefinition, type SourceId } from '../api/protocol'
import { DEFAULT_MODEL, SOURCE_READY_TIMEOUT_MS, readPluginVersion } from '../settings'
import type { AccessoryContext, RefreshableAccessory } from '../types'
import { ensureAccessorySerialNumber } from '../utils'
import type ConcertPlatform from '../platform'

/**
 * Exposes an input source as a HomeKit Switch:
 * On → current source equals the target; set On → select that source.
 * Set Off is a no-op (Off only means "not on this input").
 */
export class SourcePresetAccessory implements RefreshableAccessory {
  private readonly switchService: Service
  private readonly zone: number
  private readonly targetSource: SourceId
  private readonly targetLabel: string
  private isAtTarget = false
  /**
   * Bumped only by HomeKit sets. A refresh that started before a set
   * must not overwrite that set; a set is only discarded by a newer set.
   */
  private setGeneration = 0
  /** In-flight refresh promise so overlapping poll ticks share one request. */
  private refreshInFlight?: Promise<void>
  /** In-flight On→setSource so HomeKit write storms share one command. */
  private setInFlight?: Promise<void>
  /** True after the first consecutive poll failure has been logged at warn. */
  private pollFailureActive = false

  constructor(
    private readonly platform: ConcertPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: ConcertClient,
  ) {
    const { Service, Characteristic } = this.platform
    const context = this.accessory.context as AccessoryContext
    this.zone = context.zone
    if (typeof context.source !== 'string') {
      throw new Error(`${accessory.displayName}: sourcePreset context is missing source`)
    }
    const definition = resolveSourceDefinition(context.source)
    if (!definition) {
      throw new Error(
        `${accessory.displayName}: sourcePreset context has unknown source "${context.source}"`,
      )
    }
    this.targetSource = definition.id
    this.targetLabel = definition.label

    const displayName = this.accessory.displayName

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Name, displayName)
      .setCharacteristic(Characteristic.Manufacturer, 'AudioControl')
      .setCharacteristic(Characteristic.Model, context.model || DEFAULT_MODEL)
      .setCharacteristic(
        Characteristic.SerialNumber,
        ensureAccessorySerialNumber(this.accessory),
      )
      .setCharacteristic(Characteristic.FirmwareRevision, readPluginVersion())

    this.switchService = this.accessory.getService(Service.Switch)
      ?? this.accessory.addService(Service.Switch, displayName)

    ;(this.switchService as Service & { displayName?: string }).displayName = displayName
    this.switchService.setCharacteristic(Characteristic.Name, displayName)

    this.switchService.getCharacteristic(Characteristic.On)
      .onGet(this.handleGetOn.bind(this))
      .onSet(this.handleSetOn.bind(this))
  }

  /** Cached On value for HomeKit get requests. */
  private handleGetOn(): CharacteristicValue {
    return this.isAtTarget
  }

  /**
   * Set On → select the configured source. Set Off → no source change; snap the
   * characteristic back to whether the zone is currently on the target.
   *
   * HomeKit often repeats On writes (Shortcuts, Control Center, retries). Skip
   * when already at the preset, and coalesce concurrent sets into one command.
   */
  private async handleSetOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value)
    if (!on) {
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, this.isAtTarget)
      return
    }

    if (this.isAtTarget) {
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, true)
      return
    }

    if (this.setInFlight) {
      return this.setInFlight
    }

    this.setInFlight = this.runSetOn().finally(() => {
      this.setInFlight = undefined
    })
    return this.setInFlight
  }

  private async runSetOn(): Promise<void> {
    const mySet = ++this.setGeneration
    try {
      // Retries politely while the XR finishes waking so Shortcuts need no Wait.
      await this.client.setSourceWhenReady(this.targetSource, this.zone, {
        onWaiting: () => {
          this.platform.log.info(
            `${this.accessory.displayName}: device is not ready (check power); `
            + `retrying for up to ${Math.round(SOURCE_READY_TIMEOUT_MS / 1000)}s`,
          )
        },
      })
      if (mySet !== this.setGeneration) {
        return
      }
      this.isAtTarget = true
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, true)
      this.platform.log.info(`${this.accessory.displayName}: SET ${this.targetLabel}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.platform.log.error(`${this.accessory.displayName}: set failed: ${message}`)
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, this.isAtTarget)
      throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  /**
   * Poll source and push On iff it matches the target. Concurrent callers share
   * a single in-flight request (single-flight). Skipped while a HomeKit set is
   * waiting for the receiver, and while the zone is last known to be in standby
   * (source queries are flaky there and the input is unchanged).
   */
  async refresh(): Promise<void> {
    if (this.setInFlight) {
      return
    }
    if (this.client.getLastPowerState(this.zone) === false) {
      this.platform.log.debug?.(
        `${this.accessory.displayName}: skipping source poll (zone in standby)`,
      )
      return
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    this.refreshInFlight = this.runRefresh().finally(() => {
      this.refreshInFlight = undefined
    })
    return this.refreshInFlight
  }

  private async runRefresh(): Promise<void> {
    const setGenerationAtStart = this.setGeneration
    try {
      const current = await this.client.getSource(this.zone)
      if (setGenerationAtStart !== this.setGeneration || this.setInFlight) {
        return
      }
      const atTarget = current === this.targetSource
      if (atTarget !== this.isAtTarget) {
        this.platform.log.info(
          `${this.accessory.displayName}: ${atTarget ? 'ON' : 'OFF'} `
          + `(source ${current}, external)`,
        )
      }
      this.isAtTarget = atTarget
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, atTarget)
      if (this.pollFailureActive) {
        this.pollFailureActive = false
        this.platform.log.info(`${this.accessory.displayName}: poll recovered`)
      }
    } catch (error) {
      if (setGenerationAtStart !== this.setGeneration || this.setInFlight) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      if (!this.pollFailureActive) {
        this.pollFailureActive = true
        this.platform.log.warn(
          `${this.accessory.displayName}: poll failed: ${message}`,
        )
      } else {
        this.platform.log.debug?.(
          `${this.accessory.displayName}: poll failed: ${message}`,
        )
      }
    }
  }
}
