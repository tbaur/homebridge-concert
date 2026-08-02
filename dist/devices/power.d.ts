/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch accessory for an AudioControl Concert receiver power state.
 */
import type { PlatformAccessory } from 'homebridge';
import type { ConcertClient } from '../api';
import type { RefreshableAccessory } from '../types';
import type ConcertPlatform from '../platform';
/**
 * Exposes the receiver as a HomeKit Switch: On → power on, Off → standby.
 */
export declare class PowerAccessory implements RefreshableAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly client;
    private readonly switchService;
    private readonly zone;
    private isOn;
    /**
     * Bumped only by HomeKit power sets. A refresh that started before a set
     * must not overwrite that set; a set is only discarded by a newer set.
     */
    private setGeneration;
    /** In-flight refresh promise so overlapping poll ticks share one request. */
    private refreshInFlight?;
    /** True after the first consecutive poll failure has been logged at warn. */
    private pollFailureActive;
    constructor(platform: ConcertPlatform, accessory: PlatformAccessory, client: ConcertClient);
    /** Cached On value for HomeKit get requests. */
    private handleGetOn;
    /** Power the receiver on or put it into standby. */
    private handleSetOn;
    /**
     * Poll the receiver and push the result into HomeKit. Safe to call on a timer.
     * Concurrent callers share a single in-flight request (single-flight).
     *
     * `(external)` means the On/Off change was observed by polling — remote, front
     * panel, HDMI-CEC, etc. — not a HomeKit write handled by this plugin.
     */
    refresh(): Promise<void>;
    private runRefresh;
}
//# sourceMappingURL=power.d.ts.map