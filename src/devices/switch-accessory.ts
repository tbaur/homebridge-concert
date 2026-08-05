/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Shared behavior for the plugin's HomeKit Switch accessories:
 * Accessory Information, the Switch service, cached On state with set/poll race
 * protection, single-flight polling, and the warn-once poll failure ratchet.
 */

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge'

import {
  MANUFACTURER,
  POLL_FAILURES_BEFORE_UNKNOWN,
  POLL_FAILURE_REWARN_MS,
  STATE_FRESHNESS_MS,
  readPluginVersion,
} from '../settings'
import type { AccessoryContext, RefreshReason, RefreshableAccessory } from '../types'
import {
  describeError,
  describeErrorStack,
  ensureAccessorySerialNumber,
  parseAccessoryContext,
} from '../utils'
import type ConcertPlatform from '../platform'

/** One reading of receiver state for a switch. */
export interface StateObservation {
  /** What the switch should show. */
  on: boolean
  /** Extra context for the change log, e.g. `level 40`. */
  detail?: string
}

/**
 * Base for the receiver switches. Subclasses decide how to read state and how
 * to handle a HomeKit write; everything else is shared.
 */
export abstract class SwitchAccessory implements RefreshableAccessory {
  protected readonly switchService: Service
  /** Validated cache context; subclasses read their own fields from it. */
  protected readonly context: AccessoryContext
  protected readonly zone: number
  /** Cached value served to HomeKit gets. */
  protected isOn = false
  /** False until a query or set has revealed the receiver's real state. */
  private hasObservedState = false
  /** When {@link isOn} was last confirmed against the receiver. */
  private stateConfirmedAt = 0
  /** Consecutive failed polls; state becomes unknown once it reaches the limit. */
  private consecutivePollFailures = 0
  /** When the current failure streak was last reported at warn level. */
  private lastPollFailureWarnAt = 0
  /** A set that outlived its HomeKit write and is still completing. */
  private backgroundSet?: Promise<void>
  /**
   * Bumped only by HomeKit sets. A refresh that started before a set must not
   * overwrite that set; a set is only discarded by a newer set.
   */
  private setGeneration = 0
  /** In-flight refresh so overlapping poll ticks share one request. */
  private refreshInFlight?: Promise<void>
  /** True after the first consecutive poll failure has been logged at warn. */
  private pollFailureActive = false

  constructor(
    protected readonly platform: ConcertPlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = this.platform
    // Cache content is deserialized from disk and may predate the current
    // version, so it is validated rather than asserted.
    const context = parseAccessoryContext(this.accessory)
    this.context = context
    this.zone = context.zone

    const displayName = this.accessory.displayName

    const information = this.accessory.getService(Service.AccessoryInformation)
    if (information) {
      information
        .setCharacteristic(Characteristic.Name, displayName)
        .setCharacteristic(Characteristic.Manufacturer, MANUFACTURER)
        .setCharacteristic(Characteristic.Model, context.model)
        .setCharacteristic(
          Characteristic.SerialNumber,
          ensureAccessorySerialNumber(this.accessory),
        )
        .setCharacteristic(Characteristic.FirmwareRevision, readPluginVersion(this.platform.log))
    } else {
      this.platform.log.debug(`${displayName}: no AccessoryInformation service to populate`)
    }

    this.switchService = this.accessory.getService(Service.Switch)
      ?? this.accessory.addService(Service.Switch, displayName)

    // Keep cached service.displayName in sync so the next deserialize uses the
    // configured name (HAP validates service displayName independently).
    ;(this.switchService as Service & { displayName?: string }).displayName = displayName
    this.switchService.setCharacteristic(Characteristic.Name, displayName)

    this.switchService.getCharacteristic(Characteristic.On)
      .onGet(this.handleGetOn.bind(this))
      .onSet(this.handleSetOn.bind(this))

    // The Home app's Identify button is otherwise silent. The receiver has no
    // identify command, so acknowledge in the log rather than doing nothing.
    this.accessory.on('identify', () => {
      this.platform.log.info(`${this.displayName}: identify requested (zone ${this.zone})`)
    })
  }

  /** Name shown in HomeKit and used to prefix this accessory's log lines. */
  protected get displayName(): string {
    return this.accessory.displayName
  }

  /** Word used when reporting the On state. */
  protected get onLabel(): string {
    return 'ON'
  }

  /** Word used when reporting the Off state. */
  protected get offLabel(): string {
    return 'OFF'
  }

  /** Read the receiver state this switch reflects. */
  protected abstract observeState(): Promise<StateObservation>

  /** Handle a HomeKit write. Semantics differ between power and presets. */
  protected abstract handleSetOn(value: CharacteristicValue): Promise<void>

  /** True when this tick should not query the receiver at all. */
  protected shouldSkipPoll(): boolean {
    return this.hasPendingSet
  }

  /**
   * True when a set has started or finished since `generation` was captured,
   * meaning a poll result in hand is already stale.
   */
  protected isSupersededSince(generation: number): boolean {
    return generation !== this.setGeneration || this.hasPendingSet
  }

  /**
   * Poll the receiver and push the result into HomeKit. Safe to call on a timer.
   * Concurrent callers share a single in-flight request (single-flight).
   *
   * `(external)` means the change was observed by polling — remote, front panel,
   * HDMI-CEC, etc. — not a HomeKit write handled by this plugin.
   */
  async refresh(reason: RefreshReason = 'poll'): Promise<void> {
    if (this.shouldSkipPoll()) {
      return
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    this.refreshInFlight = this.runRefresh(reason).finally(() => {
      this.refreshInFlight = undefined
    })
    return this.refreshInFlight
  }

  private async runRefresh(reason: RefreshReason): Promise<void> {
    const setGenerationAtStart = this.setGeneration
    try {
      const observation = await this.observeState()
      if (this.isSupersededSince(setGenerationAtStart)) {
        return
      }
      this.applyObservation(observation)
    } catch (error) {
      if (this.isSupersededSince(setGenerationAtStart)) {
        return
      }
      // Keep the last known On value: a transient timeout must not flip the
      // switch and then log a fake "(external)" change when the poll recovers.
      this.noteRefreshFailed(error, reason)
    }
  }

  private applyObservation({ on, detail }: StateObservation): void {
    if (on !== this.isOn || !this.hasObservedState) {
      // `(external)` means something else changed it — remote, front panel,
      // HDMI-CEC. The first read after a restart is discovery, not a change, so
      // reporting it as external sent operators looking for a cause that was
      // never there.
      const cause = this.hasObservedState ? 'external' : 'initial'
      const suffix = detail === undefined ? `(${cause})` : `(${detail}, ${cause})`
      this.platform.log.info(
        `${this.displayName}: ${on ? this.onLabel : this.offLabel} ${suffix}`,
      )
    }
    this.recordState(on)
    this.pushCharacteristic(on)
  }

  /** Remember confirmed state so HomeKit gets stop reporting "No Response". */
  protected recordState(on: boolean): void {
    this.isOn = on
    this.hasObservedState = true
    this.stateConfirmedAt = Date.now()
    this.consecutivePollFailures = 0
    // Clears the warn ratchet too. Resetting only the counter meant a recovery
    // silently ended a failure streak without saying so, and demoted the *next*
    // streak's first failure to debug for up to an hour.
    this.notePollRecovered()
  }

  /**
   * True when the cached value is recent enough to act on without re-reading.
   *
   * Anything older may have been changed at the front panel or by a remote
   * since the last poll.
   */
  protected isStateFresh(): boolean {
    return this.hasObservedState
      && Date.now() - this.stateConfirmedAt < STATE_FRESHNESS_MS
  }

  /**
   * Run a HomeKit-initiated write with set/poll race protection.
   *
   * `apply` returns whether the change is confirmed applied; returning `false`
   * means it was handed to {@link completeInBackground} and `onApplied` must
   * wait for that. `onApplied` runs only when no newer set superseded this one,
   * so a concurrent poll cannot invalidate a successful plugin-driven set.
   */
  protected async runTrackedSet(
    apply: () => Promise<boolean>,
    onApplied: () => void,
  ): Promise<void> {
    const mySet = ++this.setGeneration
    try {
      const applied = await apply()
      if (mySet !== this.setGeneration || !applied) {
        return
      }
      onApplied()
    } catch (error) {
      this.platform.log.error(`${this.displayName}: set failed: ${describeError(error)}`)
      this.platform.log.debug(describeErrorStack(error))
      // Revert the characteristic so HomeKit does not show a lying state. HAP
      // skips its own write-back when the handler throws, so this one sticks.
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, this.isOn)
      throw this.hapError(error)
    }
  }

  /**
   * Correct the characteristic to the value the receiver actually holds, for a
   * write we chose not to act on.
   *
   * Deferred to the next macrotask on purpose: HAP assigns the *written* value
   * to the characteristic after the set handler resolves, so anything pushed
   * synchronously from inside `onSet` is overwritten and the Home app keeps
   * showing the value the user tapped.
   */
  protected snapCharacteristic(on: boolean): void {
    setImmediate(() => {
      this.switchService.updateCharacteristic(this.platform.Characteristic.On, on)
    })
  }

  /** Push confirmed state to HomeKit immediately (poll path, no HAP write pending). */
  protected pushCharacteristic(on: boolean): void {
    this.switchService.updateCharacteristic(this.platform.Characteristic.On, on)
  }

  /** True while a set that outlived its HomeKit write is still running. */
  protected get hasPendingSet(): boolean {
    return this.backgroundSet !== undefined
  }

  /**
   * Finish a set that cannot complete inside HAP's write budget.
   *
   * HAP abandons a write handler after {@link HOMEKIT_WRITE_BUDGET_MS} plus its
   * own grace period and discards whatever the handler eventually returns, so a
   * receiver that needs ~20s to wake can never be waited out inside the write.
   * The write is acknowledged and the real outcome pushed to HomeKit when known.
   */
  protected completeInBackground(
    describe: string,
    run: () => Promise<void>,
    onApplied: () => void,
  ): void {
    const mySet = this.setGeneration
    const settle = async (): Promise<void> => {
      try {
        await run()
        if (mySet === this.setGeneration) {
          onApplied()
        }
      } catch (error) {
        if (mySet !== this.setGeneration) {
          return
        }
        this.platform.log.error(
          `${this.displayName}: ${describe} did not complete: ${describeError(error)}`,
        )
        // HomeKit was told the write succeeded; put the real value back.
        this.pushCharacteristic(this.isOn)
      }
    }

    // Nothing above is expected to throw, but this promise is deliberately not
    // awaited by anyone, so an escaping rejection would be unhandled and would
    // terminate the Homebridge process.
    const pending = settle()
      .catch((error: unknown) => {
        this.platform.log.error(
          `${this.displayName}: background completion failed: ${describeError(error)}`,
        )
      })
      .finally(() => {
        if (this.backgroundSet === pending) {
          this.backgroundSet = undefined
        }
      })
    this.backgroundSet = pending
  }

  private handleGetOn(): CharacteristicValue {
    if (!this.hasObservedState) {
      // Reporting "No Response" beats answering with a fabricated Off that an
      // automation might act on before the first poll completes.
      throw this.hapError(new Error('receiver state not observed yet'))
    }
    return this.isOn
  }

  /**
   * Map a failure onto a HomeKit status.
   *
   * A RangeError is a permanent configuration fault (bad volume or unknown
   * source), so it must not be reported as a retryable comms problem.
   * HapStatusError, rather than a raw Error, keeps Homebridge from logging
   * "Unhandled error thrown inside write handler".
   */
  private hapError(error: unknown): Error {
    // Taken from the injected HAP namespace rather than imported from
    // `homebridge`: the host module is ESM-only, and a CommonJS plugin should
    // not depend on being able to `require` it.
    const { HAPStatus, HapStatusError } = this.platform.api.hap
    const status = error instanceof RangeError
      ? HAPStatus.INVALID_VALUE_IN_REQUEST
      : HAPStatus.SERVICE_COMMUNICATION_FAILURE
    return new HapStatusError(status)
  }

  private noteRefreshFailed(error: unknown, reason: RefreshReason): void {
    const message = describeError(error)

    if (reason === 'post-set') {
      // The receiver routinely rejects reads for ~20s after waking, so a failure
      // on this opportunistic re-read is expected. Reporting it at warn — or
      // counting it toward the "No Response" streak — would raise a false alarm
      // every time the user powers on.
      this.platform.log.debug(`${this.displayName}: post-set re-read failed: ${message}`)
      return
    }

    this.consecutivePollFailures += 1
    const now = Date.now()
    // Re-warn periodically: a receiver that has been offline for days should not
    // be represented by a single warn line that has long since rotated away.
    const shouldWarn = !this.pollFailureActive
      || now - this.lastPollFailureWarnAt >= POLL_FAILURE_REWARN_MS
    if (shouldWarn) {
      this.pollFailureActive = true
      this.lastPollFailureWarnAt = now
      this.platform.log.warn(`${this.displayName}: poll failed: ${message}`)
    } else {
      this.platform.log.debug(`${this.displayName}: poll failed: ${message}`)
    }

    // Reported after the failure itself so the log reads in causal order.
    // Keep the last known value for a brief streak so one timeout does not flip
    // the switch, but stop asserting it once the receiver is plainly gone.
    if (this.consecutivePollFailures >= POLL_FAILURES_BEFORE_UNKNOWN && this.hasObservedState) {
      this.hasObservedState = false
      this.platform.log.warn(
        `${this.displayName}: state unknown after ${this.consecutivePollFailures} `
        + 'failed polls; reporting No Response',
      )
    }
  }

  private notePollRecovered(): void {
    if (!this.pollFailureActive) {
      return
    }
    this.pollFailureActive = false
    this.lastPollFailureWarnAt = 0
    this.platform.log.info(`${this.displayName}: poll recovered`)
  }
}
