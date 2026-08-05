/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch accessory for an AudioControl Concert receiver power state.
 */
import type { CharacteristicValue, PlatformAccessory } from 'homebridge';
import { type ConcertClient } from '../api';
import { SwitchAccessory, type StateObservation } from './switch-accessory';
import type ConcertPlatform from '../platform';
/**
 * Exposes the receiver as a HomeKit Switch: On → power on, Off → standby.
 */
export declare class PowerAccessory extends SwitchAccessory {
    private readonly client;
    constructor(platform: ConcertPlatform, accessory: PlatformAccessory, client: ConcertClient);
    protected get offLabel(): string;
    /** Power the receiver on or put it into standby. */
    protected handleSetOn(value: CharacteristicValue): Promise<void>;
    /**
     * Try the RC5 command within HAP's write budget.
     *
     * XR units sometimes apply a power command without echoing a frame, and
     * confirming that takes a settle plus one or more state queries — far longer
     * than HomeKit will wait. Acknowledge the write and confirm out of band.
     *
     * @returns whether the new power state is confirmed
     */
    private attemptPower;
    private notePowerApplied;
    protected observeState(): Promise<StateObservation>;
}
//# sourceMappingURL=power.d.ts.map