/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared behavior for "preset" switches (volume level, input
 * source): On means the zone already matches the configured target, setting On
 * applies it, and setting Off is a no-op.
 */

import type { CharacteristicValue } from 'homebridge'

import { isReceiverNotReadyError } from '../api'
import { HOMEKIT_WRITE_BUDGET_MS, WAKE_RETRY_TIMEOUT_SEC } from '../settings'
import { SwitchAccessory } from './switch-accessory'

/**
 * A Switch that reports whether the zone matches one configured target value.
 *
 * Off carries no instruction — it only means "not at this preset" — so a HomeKit
 * Off write snaps the characteristic back instead of changing the receiver.
 */
export abstract class PresetSwitchAccessory extends SwitchAccessory {
  /** In-flight On write so HomeKit write storms share one command. */
  private setInFlight?: Promise<void>

  /** Human-readable target, used in the `SET …` log line. */
  protected abstract get targetLabel(): string

  /** What this preset polls (`volume`, `source`), used in skip logs. */
  protected abstract get presetKind(): string

  /** One bounded attempt, sized to answer inside HAP's write budget. */
  protected abstract applyPresetNow(timeoutMs: number): Promise<void>

  /** Apply the preset, waiting out a cold wake. May run far longer than a write. */
  protected abstract applyPresetWhenReady(): Promise<void>

  /**
   * Set On applies the preset; set Off is a no-op.
   *
   * HomeKit repeats On writes (Shortcuts, Control Center, retries), so skip
   * when already at the preset and coalesce concurrent sets into one command.
   */
  protected async handleSetOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value)
    if (!on) {
      // Off carries no instruction; put the characteristic back where it was.
      this.snapCharacteristic(this.isOn)
      return
    }

    // Only skip on a reading recent enough to trust. A stale "already at
    // target" would silently drop the write when someone has since changed the
    // level or input at the front panel.
    if (this.isOn && this.isStateFresh()) {
      this.snapCharacteristic(true)
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

  private runSetOn(): Promise<void> {
    return this.runTrackedSet(
      () => this.attemptPreset(),
      () => this.notePresetApplied(),
    )
  }

  /**
   * Try once within HAP's write budget; hand a still-waking receiver to the
   * background so HomeKit gets a timely answer either way.
   *
   * @returns whether the preset is confirmed applied
   */
  private async attemptPreset(): Promise<boolean> {
    try {
      await this.applyPresetNow(HOMEKIT_WRITE_BUDGET_MS)
      return true
    } catch (error) {
      if (!isReceiverNotReadyError(error)) {
        throw error
      }
      this.platform.log.info(
        `${this.displayName}: receiver is not ready (check power); `
        + `retrying in the background for up to ${WAKE_RETRY_TIMEOUT_SEC}s`,
      )
      this.completeInBackground(
        `SET ${this.targetLabel}`,
        () => this.applyPresetWhenReady(),
        () => this.notePresetApplied(),
      )
      return false
    }
  }

  private notePresetApplied(): void {
    this.recordState(true)
    this.pushCharacteristic(true)
    this.platform.log.info(`${this.displayName}: SET ${this.targetLabel}`)
    // Sibling presets on this zone are now wrong (only one level or input can be
    // active) and the receiver is necessarily awake, so power may be wrong too.
    this.platform.requestRefresh()
  }

  /**
   * Skip while a set is waiting on the receiver, and while the zone is in
   * standby — queries are flaky there.
   *
   * Standby is reported as Off rather than merely skipped. A preset means "the
   * zone is at this level / on this input", which cannot be true of a receiver
   * that is off; skipping without correcting the value left the switch stuck
   * On for the entire time the receiver stayed in standby.
   */
  protected override shouldSkipPoll(): boolean {
    if (super.shouldSkipPoll() || this.setInFlight) {
      return true
    }
    if (this.isZoneInStandby()) {
      this.reportStandbyAsOff()
      return true
    }
    return false
  }

  private reportStandbyAsOff(): void {
    if (this.isOn) {
      this.platform.log.info(`${this.displayName}: OFF (zone in standby)`)
    }
    this.recordState(false)
    this.pushCharacteristic(false)
    this.platform.log.debug(
      `${this.displayName}: skipping ${this.presetKind} poll (zone in standby)`,
    )
  }

  /** True when the client last saw this zone in standby. */
  protected abstract isZoneInStandby(): boolean

  /** A set that started mid-poll also invalidates the poll result. */
  protected override isSupersededSince(generation: number): boolean {
    return super.isSupersededSince(generation) || this.setInFlight !== undefined
  }
}
