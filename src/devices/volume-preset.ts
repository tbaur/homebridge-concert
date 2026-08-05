/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured absolute volume preset.
 */

import type { PlatformAccessory } from 'homebridge'

import type { ConcertClient } from '../api'
import { PresetSwitchAccessory } from './preset-accessory'
import type { StateObservation } from './switch-accessory'
import type ConcertPlatform from '../platform'

/**
 * Exposes a volume level as a HomeKit Switch:
 * On → current volume equals the target; set On → set that volume.
 * Set Off is a no-op (Off only means "not at this level").
 */
export class VolumePresetAccessory extends PresetSwitchAccessory {
  private readonly targetVolume: number

  constructor(
    platform: ConcertPlatform,
    accessory: PlatformAccessory,
    private readonly client: ConcertClient,
  ) {
    super(platform, accessory)
    const { volume } = this.context
    if (typeof volume !== 'number') {
      throw new Error(`${accessory.displayName}: volumePreset context is missing volume`)
    }
    this.targetVolume = volume
  }

  protected get targetLabel(): string {
    return String(this.targetVolume)
  }

  protected get presetKind(): string {
    return 'volume'
  }

  protected async applyPresetNow(timeoutMs: number): Promise<void> {
    await this.client.setVolume(this.targetVolume, this.zone, { timeoutMs })
  }

  protected async applyPresetWhenReady(): Promise<void> {
    // Retries politely while the XR finishes waking so Shortcuts need no Wait.
    await this.client.setVolumeWhenReady(this.targetVolume, this.zone)
  }

  protected async observeState(): Promise<StateObservation> {
    const level = await this.client.getVolume(this.zone)
    return { on: level === this.targetVolume, detail: `level ${level}` }
  }

  protected isZoneInStandby(): boolean {
    return this.client.getLastPowerState(this.zone) === false
  }
}
