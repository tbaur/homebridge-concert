/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for AudioControl Concert XR receivers.
 */
import type { API, Characteristic as CharacteristicClass, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service as ServiceClass } from 'homebridge';
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
    /** Polled first so presets see a fresh power state before deciding to skip. */
    private readonly powerHandlers;
    /** Volume/source presets, polled together so same-zone queries coalesce. */
    private readonly presetHandlers;
    private client?;
    private pollTimer?;
    /** In-flight shared poll; overlapping timer ticks join/skip instead of stacking. */
    private refreshAllInFlight?;
    /** Reason governing the in-flight walk; a joining poll upgrades it. */
    private refreshAllReason;
    /** A post-set refresh arrived mid-walk and needs a pass of its own. */
    private refreshAgainWhenDone;
    private stopped;
    /** True when startup validation failed; the platform stays inert. */
    private disabled;
    /**
     * @param config - Whatever Homebridge read from `config.json`. Typed as the
     *   generic `PlatformConfig` rather than {@link ConcertPlatformConfig} because
     *   nothing has validated it yet, and because a narrower parameter type does
     *   not satisfy Homebridge's `PlatformPluginConstructor`.
     */
    constructor(log: Logging, config: PlatformConfig, api: API);
    /**
     * Restore a cached accessory from disk. Handlers are attached later during
     * discovery so we only keep a reference here.
     */
    configureAccessory(accessory: PlatformAccessory): void;
    /** Stop the poll timer, release client resources, and mark the platform stopped. */
    private stopPolling;
    /**
     * Explain that cached accessories are present but unusable.
     *
     * They are deliberately left registered: unregistering makes HomeKit discard
     * room assignments, scene membership, and automations, which the user cannot
     * recover by fixing the config. Leaving them registered means they report
     * "No Response" until the configuration is valid again.
     */
    private reportInactiveAccessories;
    /**
     * Create or update Switch accessories for each configured entry and start
     * polling their state.
     */
    private discoverDevices;
    /**
     * Pair each configured accessory with the cached accessory it should reuse.
     *
     * Exact UUID matches are claimed first, then any remaining entry falls back to
     * the identity recorded in the cached context. That fallback is a migration
     * path: UUIDs used to be seeded with `host:port`, so an accessory cached by an
     * earlier version has a different UUID for the same switch. Adopting it keeps
     * the user's room assignment, scenes, and automations across the upgrade
     * instead of silently replacing every switch.
     */
    private pairWithCached;
    /**
     * Register a new accessory or bring a cached one up to date.
     *
     * @param target - Current receiver address and model from config
     * @param existing - Cached accessory this entry was paired with, if any
     * @returns the live PlatformAccessory for this configured entry
     */
    private syncAccessory;
    /**
     * Make an accessory read as "No Response" in the Home app.
     *
     * An accessory with no handler still answers reads: HAP falls back to the value
     * deserialized from its cache (`Characteristic.handleGetRequest`), so the switch
     * would show a stale state that an automation could act on. Handlers that fail
     * turn that into an honest no-response.
     */
    private markAccessoryUnavailable;
    private createHandler;
    /**
     * Stable HomeKit identity for a configured accessory.
     *
     * Deliberately excludes host and port. Seeding the UUID with the address meant
     * a DHCP lease change produced entirely new accessories, so `removeStaleAccessories`
     * unregistered the old ones and the user lost every room assignment, scene, and
     * automation — for a receiver that had simply moved. Identity is what the switch
     * *does*; the address is configuration.
     */
    private uuidFor;
    /**
     * Sync the accessory display name onto the PlatformAccessory wrapper and the
     * underlying HAP accessory. Assigning `displayName` alone does not update what
     * Homebridge serializes / publishes after cache restore — use `updateDisplayName`
     * when available (Homebridge ≥1.8).
     */
    private applyAccessoryDisplayName;
    /**
     * Note when a cached accessory's receiver address has changed.
     *
     * The previous target is the only reason the cache records host and port; a
     * DHCP lease that moved is a common cause of "everything stopped working".
     */
    private logHostChange;
    /** Unregister cached accessories that are no longer in the configured set. */
    private removeStaleAccessories;
    private startPolling;
    /**
     * Re-read every accessory now.
     *
     * Called after a successful set, because one accessory's write changes what
     * its siblings should report: only one volume level or input can be active,
     * and a preset set implies the receiver is awake.
     */
    requestRefresh(): void;
    /**
     * Kick off a refresh without awaiting it.
     *
     * An unhandled rejection here would terminate the whole Homebridge process
     * under Node's default `--unhandled-rejections=throw`, so the promise always
     * gets a handler.
     */
    private startRefreshAll;
    /**
     * Refresh power first, then the presets. Power is awaited so presets see an
     * updated last-known power state before deciding whether to skip.
     *
     * Single-flight: a timer tick that fires while a previous refresh is still
     * running joins that promise instead of starting a second walk (important when
     * refreshRate is low and a standby timeout makes one tick last several seconds).
     */
    private refreshAll;
    private runRefreshAll;
    /**
     * Refresh one handler; a handler that throws must not abort the whole walk.
     *
     * The reason is read here rather than passed down so a poll that coalesced onto
     * an in-flight walk still gets poll-strength failure reporting.
     */
    private refreshOne;
}
//# sourceMappingURL=platform.d.ts.map