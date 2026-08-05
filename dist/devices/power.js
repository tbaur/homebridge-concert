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
exports.PowerAccessory = void 0;
const api_1 = require("../api");
const settings_1 = require("../settings");
const switch_accessory_1 = require("./switch-accessory");
/**
 * Exposes the receiver as a HomeKit Switch: On → power on, Off → standby.
 */
class PowerAccessory extends switch_accessory_1.SwitchAccessory {
    client;
    constructor(platform, accessory, client) {
        super(platform, accessory);
        this.client = client;
    }
    get offLabel() {
        return 'STANDBY';
    }
    /** Power the receiver on or put it into standby. */
    async handleSetOn(value) {
        const on = Boolean(value);
        return this.runTrackedSet(() => this.attemptPower(on), () => this.notePowerApplied(on));
    }
    /**
     * Try the RC5 command within HAP's write budget.
     *
     * XR units sometimes apply a power command without echoing a frame, and
     * confirming that takes a settle plus one or more state queries — far longer
     * than HomeKit will wait. Acknowledge the write and confirm out of band.
     *
     * @returns whether the new power state is confirmed
     */
    async attemptPower(on) {
        try {
            await this.client.setPower(on, this.zone, { timeoutMs: settings_1.POWER_SET_TIMEOUT_MS });
            return true;
        }
        catch (error) {
            if (!(0, api_1.isReceiverNotReadyError)(error)) {
                throw error;
            }
            const label = on ? this.onLabel : this.offLabel;
            this.platform.log.info(`${this.displayName}: confirming ${label} in the background`);
            this.completeInBackground(label, () => this.client.setPower(on, this.zone), () => this.notePowerApplied(on));
            return false;
        }
    }
    notePowerApplied(on) {
        this.recordState(on);
        this.pushCharacteristic(on);
        this.platform.log.info(`${this.displayName}: ${on ? this.onLabel : this.offLabel}`);
        // Volume and source presets report differently once power changes.
        this.platform.requestRefresh();
    }
    async observeState() {
        return { on: await this.client.getPowerState(this.zone) };
    }
}
exports.PowerAccessory = PowerAccessory;
//# sourceMappingURL=power.js.map