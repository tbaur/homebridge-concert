/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured absolute volume preset.
 */
import type { PlatformAccessory } from 'homebridge';
import type { ConcertClient } from '../api';
import { PresetSwitchAccessory } from './preset-accessory';
import type { StateObservation } from './switch-accessory';
import type ConcertPlatform from '../platform';
/**
 * Exposes a volume level as a HomeKit Switch:
 * On → current volume equals the target; set On → set that volume.
 * Set Off is a no-op (Off only means "not at this level").
 */
export declare class VolumePresetAccessory extends PresetSwitchAccessory {
    private readonly client;
    private readonly targetVolume;
    constructor(platform: ConcertPlatform, accessory: PlatformAccessory, client: ConcertClient);
    protected get targetLabel(): string;
    protected get presetKind(): string;
    protected applyPresetNow(timeoutMs: number): Promise<void>;
    protected applyPresetWhenReady(): Promise<void>;
    protected observeState(): Promise<StateObservation>;
    protected isZoneInStandby(): boolean;
}
//# sourceMappingURL=volume-preset.d.ts.map