"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch accessory for an AudioControl Concert receiver power state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiverAccessory = void 0;
const settings_1 = require("../settings");
/**
 * Exposes the receiver as a HomeKit Switch: On → power on, Off → standby.
 */
class ReceiverAccessory {
    platform;
    accessory;
    client;
    switchService;
    isOn = false;
    /**
     * Monotonic generation bumped on every set and refresh start. A refresh that
     * finishes after a later set (or a newer refresh) must not overwrite HomeKit.
     */
    generation = 0;
    /** In-flight refresh promise so overlapping poll ticks share one request. */
    refreshInFlight;
    /** True after the first consecutive poll failure has been logged at warn. */
    pollFailureActive = false;
    constructor(platform, accessory, client) {
        this.platform = platform;
        this.accessory = accessory;
        this.client = client;
        const { Service, Characteristic } = this.platform;
        const context = this.accessory.context;
        const displayName = this.accessory.displayName;
        this.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Name, displayName)
            .setCharacteristic(Characteristic.Manufacturer, 'AudioControl')
            .setCharacteristic(Characteristic.Model, context.model || 'Concert XR')
            .setCharacteristic(Characteristic.SerialNumber, `${context.host}:${context.port}`)
            .setCharacteristic(Characteristic.FirmwareRevision, (0, settings_1.readPluginVersion)());
        this.switchService = this.accessory.getService(Service.Switch)
            ?? this.accessory.addService(Service.Switch, displayName);
        this.switchService.displayName = displayName;
        this.switchService.setCharacteristic(Characteristic.Name, displayName);
        this.switchService.getCharacteristic(Characteristic.On)
            .onGet(this.handleGetOn.bind(this))
            .onSet(this.handleSetOn.bind(this));
    }
    /** Cached On value for HomeKit get requests. */
    handleGetOn() {
        return this.isOn;
    }
    /** Power the receiver on or put it into standby. */
    async handleSetOn(value) {
        const on = Boolean(value);
        const setGeneration = ++this.generation;
        try {
            await this.client.setPower(on);
            // Only apply if nothing newer (another set) landed while we awaited.
            if (setGeneration === this.generation) {
                this.isOn = on;
                this.platform.log.info(`${this.accessory.displayName}: ${on ? 'ON' : 'STANDBY'}`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.platform.log.error(`${this.accessory.displayName} power set failed: ${message}`);
            // Revert the characteristic so HomeKit does not show a lying state.
            this.switchService.updateCharacteristic(this.platform.Characteristic.On, this.isOn);
            // HapStatusError (not a raw Error) so Homebridge does not log an
            // "Unhandled error thrown inside write handler" warning.
            throw new this.platform.api.hap.HapStatusError(-70402 /* HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    /**
     * Poll the receiver and push the result into HomeKit. Safe to call on a timer.
     * Concurrent callers share a single in-flight request (single-flight).
     */
    async refresh() {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }
        this.refreshInFlight = this.runRefresh().finally(() => {
            this.refreshInFlight = undefined;
        });
        return this.refreshInFlight;
    }
    async runRefresh() {
        const refreshGeneration = ++this.generation;
        try {
            const on = await this.client.getPowerState();
            // Discard if a set (or a newer refresh) started while we were awaiting.
            if (refreshGeneration !== this.generation) {
                return;
            }
            if (on !== this.isOn) {
                this.platform.log.info(`${this.accessory.displayName}: ${on ? 'ON' : 'STANDBY'} (external)`);
            }
            this.isOn = on;
            this.switchService.updateCharacteristic(this.platform.Characteristic.On, on);
            if (this.pollFailureActive) {
                this.pollFailureActive = false;
                this.platform.log.info(`${this.accessory.displayName} power poll recovered`);
            }
        }
        catch (error) {
            if (refreshGeneration !== this.generation) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            if (!this.pollFailureActive) {
                this.pollFailureActive = true;
                this.platform.log.warn(`${this.accessory.displayName} power poll failed: ${message}`);
            }
            else {
                this.platform.log.debug?.(`${this.accessory.displayName} power poll failed: ${message}`);
            }
        }
    }
}
exports.ReceiverAccessory = ReceiverAccessory;
//# sourceMappingURL=receiver.js.map