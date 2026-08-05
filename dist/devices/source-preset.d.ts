/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured receiver input / source.
 */
import type { PlatformAccessory } from 'homebridge';
import type { ConcertClient } from '../api';
import { PresetSwitchAccessory } from './preset-accessory';
import type { StateObservation } from './switch-accessory';
import type ConcertPlatform from '../platform';
/**
 * Exposes an input source as a HomeKit Switch:
 * On → current source equals the target; set On → select that source.
 * Set Off is a no-op (Off only means "not on this input").
 */
export declare class SourcePresetAccessory extends PresetSwitchAccessory {
    private readonly client;
    private readonly targetSource;
    private readonly targetSourceLabel;
    constructor(platform: ConcertPlatform, accessory: PlatformAccessory, client: ConcertClient);
    protected get targetLabel(): string;
    protected get presetKind(): string;
    protected applyPresetNow(timeoutMs: number): Promise<void>;
    protected applyPresetWhenReady(): Promise<void>;
    protected observeState(): Promise<StateObservation>;
    protected isZoneInStandby(): boolean;
}
//# sourceMappingURL=source-preset.d.ts.map