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
 * Registers a single Switch accessory for the configured Concert receiver
 * and polls its power state on a timer.
 */
export default class ConcertPlatform implements DynamicPlatformPlugin {
    readonly log: Logging;
    private readonly api;
    readonly Service: typeof ServiceClass;
    readonly Characteristic: typeof CharacteristicClass;
    readonly accessories: PlatformAccessory[];
    private readonly config;
    private handler?;
    private client?;
    private pollTimer?;
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
     * Create or update the Switch accessory for the configured receiver and start
     * polling power state.
     */
    private discoverDevices;
    /** Unregister cached accessories that no longer match the configured target. */
    private removeStaleAccessories;
    private startPolling;
}
//# sourceMappingURL=platform.d.ts.map