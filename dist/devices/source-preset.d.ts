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
import type { RefreshableAccessory } from '../types';
import type ConcertPlatform from '../platform';
/**
 * Exposes an input source as a HomeKit Switch:
 * On → current source equals the target; set On → select that source.
 * Set Off is a no-op (Off only means "not on this input").
 */
export declare class SourcePresetAccessory implements RefreshableAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly client;
    private readonly switchService;
    private readonly zone;
    private readonly targetSource;
    private readonly targetLabel;
    private isAtTarget;
    /**
     * Bumped only by HomeKit sets. A refresh that started before a set
     * must not overwrite that set; a set is only discarded by a newer set.
     */
    private setGeneration;
    /** In-flight refresh promise so overlapping poll ticks share one request. */
    private refreshInFlight?;
    /** In-flight On→setSource so HomeKit write storms share one command. */
    private setInFlight?;
    /** True after the first consecutive poll failure has been logged at warn. */
    private pollFailureActive;
    constructor(platform: ConcertPlatform, accessory: PlatformAccessory, client: ConcertClient);
    /** Cached On value for HomeKit get requests. */
    private handleGetOn;
    /**
     * Set On → select the configured source. Set Off → no source change; snap the
     * characteristic back to whether the zone is currently on the target.
     *
     * HomeKit often repeats On writes (Shortcuts, Control Center, retries). Skip
     * when already at the preset, and coalesce concurrent sets into one command.
     */
    private handleSetOn;
    private runSetOn;
    /**
     * Poll source and push On iff it matches the target. Concurrent callers share
     * a single in-flight request (single-flight). Skipped while a HomeKit set is
     * waiting for the receiver, and while the zone is last known to be in standby
     * (source queries are flaky there and the input is unchanged).
     */
    refresh(): Promise<void>;
    private runRefresh;
}
//# sourceMappingURL=source-preset.d.ts.map