"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured absolute volume preset.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VolumePresetAccessory = void 0;
const preset_accessory_1 = require("./preset-accessory");
/**
 * Exposes a volume level as a HomeKit Switch:
 * On → current volume equals the target; set On → set that volume.
 * Set Off is a no-op (Off only means "not at this level").
 */
class VolumePresetAccessory extends preset_accessory_1.PresetSwitchAccessory {
    client;
    targetVolume;
    constructor(platform, accessory, client) {
        super(platform, accessory);
        this.client = client;
        const { volume } = this.context;
        if (typeof volume !== 'number') {
            throw new Error(`${accessory.displayName}: volumePreset context is missing volume`);
        }
        this.targetVolume = volume;
    }
    get targetLabel() {
        return String(this.targetVolume);
    }
    get presetKind() {
        return 'volume';
    }
    async applyPresetNow(timeoutMs) {
        await this.client.setVolume(this.targetVolume, this.zone, { timeoutMs });
    }
    async applyPresetWhenReady() {
        // Retries politely while the XR finishes waking so Shortcuts need no Wait.
        await this.client.setVolumeWhenReady(this.targetVolume, this.zone);
    }
    async observeState() {
        const level = await this.client.getVolume(this.zone);
        return { on: level === this.targetVolume, detail: `level ${level}` };
    }
    isZoneInStandby() {
        return this.client.getLastPowerState(this.zone) === false;
    }
}
exports.VolumePresetAccessory = VolumePresetAccessory;
//# sourceMappingURL=volume-preset.js.map