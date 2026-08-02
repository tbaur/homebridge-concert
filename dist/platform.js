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
const devices_1 = require("./devices");
const settings_1 = require("./settings");
const utils_1 = require("./utils");
/**
 * Registers configured Switch accessories for a Concert receiver and polls
 * their state on a shared timer.
 */
class ConcertPlatform {
    log;
    api;
    Service;
    Characteristic;
    accessories = [];
    config;
    handlers = [];
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
     * Create or update Switch accessories for each configured entry and start
     * polling their state.
     */
    discoverDevices() {
        const host = this.config.host.trim();
        const port = (0, utils_1.resolvePort)(this.config.port);
        const model = (this.config.model?.trim() || settings_1.DEFAULT_MODEL);
        const resolved = (0, utils_1.resolveAccessories)(this.config);
        const keepUuids = new Set(resolved.map((accessory) => this.uuidFor(host, port, accessory)));
        this.removeStaleAccessories(keepUuids);
        this.client = new api_1.ConcertClient({
            host,
            port,
            logger: this.log,
        });
        this.handlers.length = 0;
        for (const accessoryConfig of resolved) {
            const uuid = this.uuidFor(host, port, accessoryConfig);
            const context = {
                kind: accessoryConfig.kind,
                host,
                port,
                zone: accessoryConfig.zone,
                model,
                volume: accessoryConfig.volume,
            };
            let accessory = this.accessories.find((cached) => cached.UUID === uuid);
            if (!accessory) {
                this.log.info(`Registering accessory "${accessoryConfig.name}" `
                    + `(${(0, utils_1.accessoryIdentityKey)(accessoryConfig)}) at ${host}:${port}`);
                accessory = new this.api.platformAccessory(accessoryConfig.name, uuid);
                accessory.context = context;
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                this.accessories.push(accessory);
            }
            else {
                accessory.context = context;
                this.applyAccessoryDisplayName(accessory, accessoryConfig.name);
                this.api.updatePlatformAccessories([accessory]);
                this.log.info(`Restored accessory "${accessoryConfig.name}" `
                    + `(${(0, utils_1.accessoryIdentityKey)(accessoryConfig)}) at ${host}:${port}`);
            }
            this.handlers.push(this.createHandler(accessoryConfig, accessory, this.client));
        }
        this.startPolling();
        for (const handler of this.handlers) {
            void handler.refresh();
        }
    }
    createHandler(config, accessory, client) {
        if (config.kind === 'power') {
            return new devices_1.PowerAccessory(this, accessory, client);
        }
        return new devices_1.VolumePresetAccessory(this, accessory, client);
    }
    uuidFor(host, port, accessory) {
        return this.api.hap.uuid.generate(`${settings_1.UUID_PREFIX}${host}:${port}:${(0, utils_1.accessoryIdentityKey)(accessory)}`);
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
    /** Unregister cached accessories that are no longer in the configured set. */
    removeStaleAccessories(keepUuids) {
        const stale = this.accessories.filter((accessory) => !keepUuids.has(accessory.UUID));
        if (stale.length === 0) {
            return;
        }
        for (const accessory of stale) {
            this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        }
        this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, stale);
        this.accessories.splice(0, this.accessories.length, ...this.accessories.filter((accessory) => keepUuids.has(accessory.UUID)));
    }
    startPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        const refreshSec = (0, utils_1.resolveRefreshRateSec)(this.config.options?.refreshRate, settings_1.DEFAULT_REFRESH_RATE_SEC);
        this.log.info(`Polling accessory state every ${refreshSec}s`);
        this.pollTimer = setInterval(() => {
            if (this.stopped || this.handlers.length === 0) {
                return;
            }
            for (const handler of this.handlers) {
                void handler.refresh();
            }
        }, refreshSec * 1000);
    }
}
exports.default = ConcertPlatform;
//# sourceMappingURL=platform.js.map