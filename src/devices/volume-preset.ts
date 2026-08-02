/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured absolute volume preset.
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'
import { HAPStatus } from 'homebridge'

import type { ConcertClient } from '../api'
import { DEFAULT_MODEL, readPluginVersion } from '../settings'
import type { AccessoryContext, RefreshableAccessory } from '../types'
import type ConcertPlatform from '../platform'

/**
 * Exposes a volume level as a HomeKit Switch:
 * On → current volume equals the target; set On → set that volume.
 * Set Off is a no-op (Off only means "not at this level").
 */
export class VolumePresetAccessory implements RefreshableAccessory {
  private readonly switchService: Service
  private readonly zone: number
  private readonly targetVolume: number
  private isAtTarget = false
  /**
   * Bumped only by HomeKit sets. A refresh that started before a set
   * must not overwrite that set; a set is only discarded by a newer set.
   */
  private setGeneration = 0
  /** In-flight refresh promise so overlapping poll ticks share one request. */
  private refreshInFlight?: Promise<void>
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
    if (typeof context.volume !== 'number') {
      throw new Error(`${accessory.displayName}: volumePreset context is missing volume`)
    }
    this.targetVolume = context.volume

    const displayName = this.accessory.displayName

    this.accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Name, displayName)
      .setCharacteristic(Characteristic.Manufacturer, 'AudioControl')
      .setCharacteristic(Characteristic.Model, context.model || DEFAULT_MODEL)
      .setCharacteristic(
        Characteristic.SerialNumber,
        `${context.host}:${context.port}:z${context.zone}:vol:${context.volume}`,
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
   * Set On → set the configured volume. Set Off → no volume change; snap the
   * characteristic back to whether the zone is currently at the target.
   */
  private async handleSetOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value)
    if (!on) {
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, this.isAtTarget)
      return
    }

    const mySet = ++this.setGeneration
    try {
      await this.client.setVolume(this.targetVolume, this.zone)
      if (mySet === this.setGeneration) {
        this.isAtTarget = true
        this.platform.log.info(`${this.accessory.displayName}: volume ${this.targetVolume}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.platform.log.error(`${this.accessory.displayName} volume set failed: ${message}`)
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, this.isAtTarget)
      throw new this.platform.api.hap.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
    }
  }

  /**
   * Poll volume and push On iff it matches the target. Concurrent callers share
   * a single in-flight request (single-flight).
   */
  async refresh(): Promise<void> {
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
      const level = await this.client.getVolume(this.zone)
      if (setGenerationAtStart !== this.setGeneration) {
        return
      }
      const atTarget = level === this.targetVolume
      if (atTarget !== this.isAtTarget) {
        this.platform.log.info(
          `${this.accessory.displayName}: ${atTarget ? 'ON' : 'OFF'} `
          + `(volume ${level}, external)`,
        )
      }
      this.isAtTarget = atTarget
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, atTarget)
      if (this.pollFailureActive) {
        this.pollFailureActive = false
        this.platform.log.info(`${this.accessory.displayName} volume poll recovered`)
      }
    } catch (error) {
      if (setGenerationAtStart !== this.setGeneration) {
        return
      }
      // Standby / unreachable: treat as not-at-preset without tearing down.
      if (this.isAtTarget) {
        this.isAtTarget = false
        this.switchService.updateCharacteristic(this.platform.Characteristic.On, false)
      }
      const message = error instanceof Error ? error.message : String(error)
      if (!this.pollFailureActive) {
        this.pollFailureActive = true
        this.platform.log.warn(
          `${this.accessory.displayName} volume poll failed: ${message}`,
        )
      } else {
        this.platform.log.debug?.(
          `${this.accessory.displayName} volume poll failed: ${message}`,
        )
      }
    }
  }
}
