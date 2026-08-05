/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch accessory for an AudioControl Concert receiver power state.
 */

import type { CharacteristicValue, PlatformAccessory } from 'homebridge'

import { isReceiverNotReadyError, type ConcertClient } from '../api'
import { POWER_SET_TIMEOUT_MS } from '../settings'
import { SwitchAccessory, type StateObservation } from './switch-accessory'
import type ConcertPlatform from '../platform'

/**
 * Exposes the receiver as a HomeKit Switch: On → power on, Off → standby.
 */
export class PowerAccessory extends SwitchAccessory {
  constructor(
    platform: ConcertPlatform,
    accessory: PlatformAccessory,
    private readonly client: ConcertClient,
  ) {
    super(platform, accessory)
  }

  protected override get offLabel(): string {
    return 'STANDBY'
  }

  /** Power the receiver on or put it into standby. */
  protected async handleSetOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value)
    return this.runTrackedSet(
      () => this.attemptPower(on),
      () => this.notePowerApplied(on),
    )
  }

  /**
   * Try the RC5 command within HAP's write budget.
   *
   * XR units sometimes apply a power command without echoing a frame, and
   * confirming that takes a settle plus one or more state queries — far longer
   * than HomeKit will wait. Acknowledge the write and confirm out of band.
   *
   * @returns whether the new power state is confirmed
   */
  private async attemptPower(on: boolean): Promise<boolean> {
    try {
      await this.client.setPower(on, this.zone, { timeoutMs: POWER_SET_TIMEOUT_MS })
      return true
    } catch (error) {
      if (!isReceiverNotReadyError(error)) {
        throw error
      }
      const label = on ? this.onLabel : this.offLabel
      this.platform.log.info(`${this.displayName}: confirming ${label} in the background`)
      this.completeInBackground(
        label,
        () => this.client.setPower(on, this.zone),
        () => this.notePowerApplied(on),
      )
      return false
    }
  }

  private notePowerApplied(on: boolean): void {
    this.recordState(on)
    this.pushCharacteristic(on)
    this.platform.log.info(`${this.displayName}: ${on ? this.onLabel : this.offLabel}`)
    // Volume and source presets report differently once power changes.
    this.platform.requestRefresh()
  }

  protected async observeState(): Promise<StateObservation> {
    return { on: await this.client.getPowerState(this.zone) }
  }
}
