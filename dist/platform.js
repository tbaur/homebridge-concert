"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Homebridge dynamic platform for AudioControl Concert XR receivers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("./api");
const receiver_1 = require("./devices/receiver");
const settings_1 = require("./settings");
const utils_1 = require("./utils");
/**
 * Registers a single Switch accessory for the configured Concert receiver
 * and polls its power state on a timer.
 */
class ConcertPlatform {
    log;
    api;
    Service;
    Characteristic;
    accessories = [];
    config;
    handler;
    client;
    pollTimer;
    stopped = false;
    /** True when startup validation failed; the platform stays inert. */
    disabled = false;
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.config = config;
        const { errors, warnings } = (0, utils_1.validateConfig)(config);
        for (const warning of warnings) {
            this.log.warn(warning);
        }
        if (errors.length > 0) {
            for (const error of errors) {
                this.log.error(error);
            }
            this.log.error('Invalid configuration; plugin will not start until it is corrected.');
            this.disabled = true;
        }
        else {
            this.log.info(`Initializing ${this.config.name ?? settings_1.PLATFORM_NAME} platform`);
        }
        // Always register lifecycle handlers so a disabled platform can still clear
        // orphaned cached accessories and shut down cleanly.
        this.api.on('didFinishLaunching', () => {
            if (this.stopped) {
                return;
            }
            if (this.disabled) {
                this.clearCachedAccessories();
                return;
            }
            this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            this.stopPolling();
        });
    }
    /**
     * Restore a cached accessory from disk. Handlers are attached later during
     * discovery so we only keep a reference here.
     */
    configureAccessory(accessory) {
        this.log.info(`Loading cached accessory: ${accessory.displayName}`);
        this.accessories.push(accessory);
    }
    /** Clear the poll timer and mark the platform stopped. */
    stopPolling() {
        this.stopped = true;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    /**
     * Unregister every cached accessory. Used when config is invalid so HomeKit
     * does not keep zombie switches with no handlers.
     */
    clearCachedAccessories() {
        if (this.accessories.length === 0) {
            return;
        }
        this.log.warn(`Unregistering ${this.accessories.length} cached accessory(ies) because configuration is invalid.`);
        this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [...this.accessories]);
        this.accessories.length = 0;
    }
    /**
     * Create or update the Switch accessory for the configured receiver and start
     * polling power state.
     */
    discoverDevices() {
        const host = this.config.host.trim();
        const port = (0, utils_1.resolvePort)(this.config.port);
        const zone = (0, utils_1.resolveZone)(this.config.zone);
        const model = (this.config.model?.trim() || 'Concert XR-8S');
        const displayName = (this.config.accessoryName?.trim() || this.config.name?.trim() || settings_1.PLATFORM_NAME);
        const context = { host, port, zone, model };
        const uuid = this.api.hap.uuid.generate(`${settings_1.UUID_PREFIX}${host}:${port}:z${zone}`);
        // Always drop accessories that no longer match the configured target.
        this.removeStaleAccessories(uuid);
        let accessory = this.accessories.find((cached) => cached.UUID === uuid);
        if (!accessory) {
            this.log.info(`Registering accessory "${displayName}" at ${host}:${port} (zone ${zone})`);
            accessory = new this.api.platformAccessory(displayName, uuid);
            accessory.context = context;
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }
        else {
            accessory.context = context;
            this.applyAccessoryDisplayName(accessory, displayName);
            this.api.updatePlatformAccessories([accessory]);
            this.log.info(`Restored accessory "${displayName}" at ${host}:${port} (zone ${zone})`);
        }
        this.client = new api_1.ConcertClient({
            host,
            port,
            zone,
            logger: this.log,
        });
        this.handler = new receiver_1.ReceiverAccessory(this, accessory, this.client);
        this.startPolling();
        // Immediate refresh so HomeKit has a real value shortly after launch.
        void this.handler.refresh();
    }
    /**
     * Sync the accessory display name onto the PlatformAccessory wrapper and the
     * underlying HAP accessory. Assigning `displayName` alone does not update what
     * Homebridge serializes / publishes after cache restore — use `updateDisplayName`
     * when available (Homebridge ≥1.8).
     */
    applyAccessoryDisplayName(accessory, name) {
        if (accessory.displayName === name) {
            return;
        }
        const previous = accessory.displayName;
        if (typeof accessory.updateDisplayName === 'function') {
            accessory.updateDisplayName(name);
        }
        else {
            accessory.displayName = name;
            const hapAccessory = accessory._associatedHAPAccessory;
            if (hapAccessory) {
                hapAccessory.displayName = name;
            }
        }
        this.log.info(`Renamed accessory "${previous}" → "${name}"`);
    }
    /** Unregister cached accessories that no longer match the configured target. */
    removeStaleAccessories(keepUuid) {
        const stale = this.accessories.filter((accessory) => accessory.UUID !== keepUuid);
        if (stale.length === 0) {
            return;
        }
        for (const accessory of stale) {
            this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        }
        this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        this.accessories.splice(0, this.accessories.length, ...this.accessories.filter((a) => a.UUID === keepUuid));
    }
    startPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        const refreshSec = (0, utils_1.resolveRefreshRateSec)(this.config.options?.refreshRate, settings_1.DEFAULT_REFRESH_RATE_SEC);
        this.log.info(`Polling power state every ${refreshSec}s`);
        this.pollTimer = setInterval(() => {
            if (this.stopped || !this.handler) {
                return;
            }
            void this.handler.refresh();
        }, refreshSec * 1000);
    }
}
exports.default = ConcertPlatform;
//# sourceMappingURL=platform.js.map