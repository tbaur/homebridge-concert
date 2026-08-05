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
import type { CharacteristicValue } from 'homebridge';
import { SwitchAccessory } from './switch-accessory';
/**
 * A Switch that reports whether the zone matches one configured target value.
 *
 * Off carries no instruction — it only means "not at this preset" — so a HomeKit
 * Off write snaps the characteristic back instead of changing the receiver.
 */
export declare abstract class PresetSwitchAccessory extends SwitchAccessory {
    /** In-flight On write so HomeKit write storms share one command. */
    private setInFlight?;
    /** Human-readable target, used in the `SET …` log line. */
    protected abstract get targetLabel(): string;
    /** What this preset polls (`volume`, `source`), used in skip logs. */
    protected abstract get presetKind(): string;
    /** One bounded attempt, sized to answer inside HAP's write budget. */
    protected abstract applyPresetNow(timeoutMs: number): Promise<void>;
    /** Apply the preset, waiting out a cold wake. May run far longer than a write. */
    protected abstract applyPresetWhenReady(): Promise<void>;
    /**
     * Set On applies the preset; set Off is a no-op.
     *
     * HomeKit repeats On writes (Shortcuts, Control Center, retries), so skip
     * when already at the preset and coalesce concurrent sets into one command.
     */
    protected handleSetOn(value: CharacteristicValue): Promise<void>;
    private runSetOn;
    /**
     * Try once within HAP's write budget; hand a still-waking receiver to the
     * background so HomeKit gets a timely answer either way.
     *
     * @returns whether the preset is confirmed applied
     */
    private attemptPreset;
    private notePresetApplied;
    /**
     * Skip while a set is waiting on the receiver, and while the zone is in
     * standby — queries are flaky there.
     *
     * Standby is reported as Off rather than merely skipped. A preset means "the
     * zone is at this level / on this input", which cannot be true of a receiver
     * that is off; skipping without correcting the value left the switch stuck
     * On for the entire time the receiver stayed in standby.
     */
    protected shouldSkipPoll(): boolean;
    private reportStandbyAsOff;
    /** True when the client last saw this zone in standby. */
    protected abstract isZoneInStandby(): boolean;
    /** A set that started mid-poll also invalidates the poll result. */
    protected isSupersededSince(generation: number): boolean;
}
//# sourceMappingURL=preset-accessory.d.ts.map