/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for AudioControl Concert XR receivers.
 */
import type { API, Characteristic as CharacteristicClass, DynamicPlatformPlugin, Logging, PlatformAccessory, Service as ServiceClass } from 'homebridge';
import type { ConcertPlatformConfig } from './types';
/**
 * Registers configured Switch accessories for a Concert receiver and polls
 * their state on a shared timer.
 */
export default class ConcertPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    readonly api: API;
    readonly Service: typeof ServiceClass;
    readonly Characteristic: typeof CharacteristicClass;
    readonly accessories: PlatformAccessory[];
    private readonly config;
    private readonly handlers;
    private client?;
    private pollTimer?;
    /** In-flight shared poll; overlapping timer ticks join/skip instead of stacking. */
    private refreshAllInFlight?;
    private stopped;
    /** True when startup validation failed; the platform stays inert. */
    private disabled;
    constructor(log: Logging, config: ConcertPlatformConfig, api: API);
    /**
     * Restore a cached accessory from disk. Handlers are attached later during
     * discovery so we only keep a reference here.
     */
    configureAccessory(accessory: PlatformAccessory): void;
    /** Clear the poll timer and mark the platform stopped. */
    private stopPolling;
    /**
     * Unregister every cached accessory. Used when config is invalid so HomeKit
     * does not keep zombie switches with no handlers.
     */
    private clearCachedAccessories;
    /**
     * Create or update Switch accessories for each configured entry and start
     * polling their state.
     */
    private discoverDevices;
    private createHandler;
    private uuidFor;
    /**
     * Sync the accessory display name onto the PlatformAccessory wrapper and the
     * underlying HAP accessory. Assigning `displayName` alone does not update what
     * Homebridge serializes / publishes after cache restore — use `updateDisplayName`
     * when available (Homebridge ≥1.8).
     */
    private applyAccessoryDisplayName;
    /** Unregister cached accessories that are no longer in the configured set. */
    private removeStaleAccessories;
    private startPolling;
    /**
     * Refresh handlers sequentially (power before volume). Awaits each so volume
     * sees an updated last-known power state before deciding whether to skip.
     *
     * Single-flight: a timer tick that fires while a previous refresh is still
     * running joins that promise instead of starting a second walk (important when
     * refreshRate is low and a standby timeout makes one tick last several seconds).
     */
    private refreshAll;
    private runRefreshAll;
}
//# sourceMappingURL=platform.d.ts.map