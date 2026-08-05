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
import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { AccessoryContext, RefreshReason, RefreshableAccessory } from '../types';
import type ConcertPlatform from '../platform';
/** One reading of receiver state for a switch. */
export interface StateObservation {
    /** What the switch should show. */
    on: boolean;
    /** Extra context for the change log, e.g. `level 40`. */
    detail?: string;
}
/**
 * Base for the receiver switches. Subclasses decide how to read state and how
 * to handle a HomeKit write; everything else is shared.
 */
export declare abstract class SwitchAccessory implements RefreshableAccessory {
    protected readonly platform: ConcertPlatform;
    protected readonly accessory: PlatformAccessory;
    protected readonly switchService: Service;
    /** Validated cache context; subclasses read their own fields from it. */
    protected readonly context: AccessoryContext;
    protected readonly zone: number;
    /** Cached value served to HomeKit gets. */
    protected isOn: boolean;
    /** False until a query or set has revealed the receiver's real state. */
    private hasObservedState;
    /** When {@link isOn} was last confirmed against the receiver. */
    private stateConfirmedAt;
    /** Consecutive failed polls; state becomes unknown once it reaches the limit. */
    private consecutivePollFailures;
    /** When the current failure streak was last reported at warn level. */
    private lastPollFailureWarnAt;
    /** A set that outlived its HomeKit write and is still completing. */
    private backgroundSet?;
    /**
     * Bumped only by HomeKit sets. A refresh that started before a set must not
     * overwrite that set; a set is only discarded by a newer set.
     */
    private setGeneration;
    /** In-flight refresh so overlapping poll ticks share one request. */
    private refreshInFlight?;
    /** True after the first consecutive poll failure has been logged at warn. */
    private pollFailureActive;
    constructor(platform: ConcertPlatform, accessory: PlatformAccessory);
    /** Name shown in HomeKit and used to prefix this accessory's log lines. */
    protected get displayName(): string;
    /** Word used when reporting the On state. */
    protected get onLabel(): string;
    /** Word used when reporting the Off state. */
    protected get offLabel(): string;
    /** Read the receiver state this switch reflects. */
    protected abstract observeState(): Promise<StateObservation>;
    /** Handle a HomeKit write. Semantics differ between power and presets. */
    protected abstract handleSetOn(value: CharacteristicValue): Promise<void>;
    /** True when this tick should not query the receiver at all. */
    protected shouldSkipPoll(): boolean;
    /**
     * True when a set has started or finished since `generation` was captured,
     * meaning a poll result in hand is already stale.
     */
    protected isSupersededSince(generation: number): boolean;
    /**
     * Poll the receiver and push the result into HomeKit. Safe to call on a timer.
     * Concurrent callers share a single in-flight request (single-flight).
     *
     * `(external)` means the change was observed by polling — remote, front panel,
     * HDMI-CEC, etc. — not a HomeKit write handled by this plugin.
     */
    refresh(reason?: RefreshReason): Promise<void>;
    private runRefresh;
    private applyObservation;
    /** Remember confirmed state so HomeKit gets stop reporting "No Response". */
    protected recordState(on: boolean): void;
    /**
     * True when the cached value is recent enough to act on without re-reading.
     *
     * Anything older may have been changed at the front panel or by a remote
     * since the last poll.
     */
    protected isStateFresh(): boolean;
    /**
     * Run a HomeKit-initiated write with set/poll race protection.
     *
     * `apply` returns whether the change is confirmed applied; returning `false`
     * means it was handed to {@link completeInBackground} and `onApplied` must
     * wait for that. `onApplied` runs only when no newer set superseded this one,
     * so a concurrent poll cannot invalidate a successful plugin-driven set.
     */
    protected runTrackedSet(apply: () => Promise<boolean>, onApplied: () => void): Promise<void>;
    /**
     * Correct the characteristic to the value the receiver actually holds, for a
     * write we chose not to act on.
     *
     * Deferred to the next macrotask on purpose: HAP assigns the *written* value
     * to the characteristic after the set handler resolves, so anything pushed
     * synchronously from inside `onSet` is overwritten and the Home app keeps
     * showing the value the user tapped.
     */
    protected snapCharacteristic(on: boolean): void;
    /** Push confirmed state to HomeKit immediately (poll path, no HAP write pending). */
    protected pushCharacteristic(on: boolean): void;
    /** True while a set that outlived its HomeKit write is still running. */
    protected get hasPendingSet(): boolean;
    /**
     * Finish a set that cannot complete inside HAP's write budget.
     *
     * HAP abandons a write handler after {@link HOMEKIT_WRITE_BUDGET_MS} plus its
     * own grace period and discards whatever the handler eventually returns, so a
     * receiver that needs ~20s to wake can never be waited out inside the write.
     * The write is acknowledged and the real outcome pushed to HomeKit when known.
     */
    protected completeInBackground(describe: string, run: () => Promise<void>, onApplied: () => void): void;
    private handleGetOn;
    /**
     * Map a failure onto a HomeKit status.
     *
     * A RangeError is a permanent configuration fault (bad volume or unknown
     * source), so it must not be reported as a retryable comms problem.
     * HapStatusError, rather than a raw Error, keeps Homebridge from logging
     * "Unhandled error thrown inside write handler".
     */
    private hapError;
    private noteRefreshFailed;
    private notePollRecovered;
}
//# sourceMappingURL=switch-accessory.d.ts.map