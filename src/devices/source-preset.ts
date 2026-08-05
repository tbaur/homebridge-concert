/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured receiver input / source.
 */

import type { PlatformAccessory } from 'homebridge'

import type { ConcertClient } from '../api'
import { resolveSourceDefinition, type SourceId } from '../api/protocol'
import { PresetSwitchAccessory } from './preset-accessory'
import type { StateObservation } from './switch-accessory'
import type ConcertPlatform from '../platform'

/**
 * Exposes an input source as a HomeKit Switch:
 * On → current source equals the target; set On → select that source.
 * Set Off is a no-op (Off only means "not on this input").
 */
export class SourcePresetAccessory extends PresetSwitchAccessory {
  private readonly targetSource: SourceId
  private readonly targetSourceLabel: string

  constructor(
    platform: ConcertPlatform,
    accessory: PlatformAccessory,
    private readonly client: ConcertClient,
  ) {
    super(platform, accessory)
    const { source } = this.context
    if (typeof source !== 'string') {
      throw new Error(`${accessory.displayName}: sourcePreset context is missing source`)
    }
    const definition = resolveSourceDefinition(source)
    if (!definition) {
      throw new Error(
        `${accessory.displayName}: sourcePreset context has unknown source "${source}"`,
      )
    }
    this.targetSource = definition.id
    this.targetSourceLabel = definition.label
  }

  protected get targetLabel(): string {
    return this.targetSourceLabel
  }

  protected get presetKind(): string {
    return 'source'
  }

  protected async applyPresetNow(timeoutMs: number): Promise<void> {
    await this.client.setSource(this.targetSource, this.zone, { timeoutMs })
  }

  protected async applyPresetWhenReady(): Promise<void> {
    // Retries politely while the XR finishes waking so Shortcuts need no Wait.
    await this.client.setSourceWhenReady(this.targetSource, this.zone)
  }

  protected async observeState(): Promise<StateObservation> {
    const current = await this.client.getSource(this.zone)
    return {
      on: current === this.targetSource,
      detail: `source ${resolveSourceDefinition(current)?.label ?? current}`,
    }
  }

  protected isZoneInStandby(): boolean {
    return this.client.getLastPowerState(this.zone) === false
  }
}
