"use strict";
/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview HomeKit Switch for a configured receiver input / source.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourcePresetAccessory = void 0;
const protocol_1 = require("../api/protocol");
const preset_accessory_1 = require("./preset-accessory");
/**
 * Exposes an input source as a HomeKit Switch:
 * On → current source equals the target; set On → select that source.
 * Set Off is a no-op (Off only means "not on this input").
 */
class SourcePresetAccessory extends preset_accessory_1.PresetSwitchAccessory {
    client;
    targetSource;
    targetSourceLabel;
    constructor(platform, accessory, client) {
        super(platform, accessory);
        this.client = client;
        const { source } = this.context;
        if (typeof source !== 'string') {
            throw new Error(`${accessory.displayName}: sourcePreset context is missing source`);
        }
        const definition = (0, protocol_1.resolveSourceDefinition)(source);
        if (!definition) {
            throw new Error(`${accessory.displayName}: sourcePreset context has unknown source "${source}"`);
        }
        this.targetSource = definition.id;
        this.targetSourceLabel = definition.label;
    }
    get targetLabel() {
        return this.targetSourceLabel;
    }
    get presetKind() {
        return 'source';
    }
    async applyPresetNow(timeoutMs) {
        await this.client.setSource(this.targetSource, this.zone, { timeoutMs });
    }
    async applyPresetWhenReady() {
        // Retries politely while the XR finishes waking so Shortcuts need no Wait.
        await this.client.setSourceWhenReady(this.targetSource, this.zone);
    }
    async observeState() {
        const current = await this.client.getSource(this.zone);
        return {
            on: current === this.targetSource,
            detail: `source ${(0, protocol_1.resolveSourceDefinition)(current)?.label ?? current}`,
        };
    }
    isZoneInStandby() {
        return this.client.getLastPowerState(this.zone) === false;
    }
}
exports.SourcePresetAccessory = SourcePresetAccessory;
//# sourceMappingURL=source-preset.js.map