/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview Input / source catalog for AudioControl Concert XR (family protocol).
 *
 * Source *query* uses command 0x1D. Source *set* uses Simulate RC5 IR (0x08)
 * with discrete source keys — matching power on/off.
 *
 * Codes come from the shared Arcam/AudioControl X/XR automation family and
 * should be verified on Concert XR before treating as production-proven.
 */
/** Config / HomeKit identity id for a selectable input (lowercase). */
export type SourceId = 'cd' | 'bd' | 'av' | 'sat' | 'pvr' | 'uhd' | 'aux' | 'display' | 'fm' | 'dab' | 'net' | 'stb' | 'game' | 'bt';
/** One selectable receiver input. */
export interface SourceDefinition {
    /** Stable config key (`accessories[].source`). */
    id: SourceId;
    /** Front-panel style label (CD, BD, …). */
    label: string;
    /** Byte returned by / compared against Request Current Source (0x1D). */
    queryCode: number;
    /** RC5 command byte for Zone 1 (system 0x10). */
    rc5Zone1: number;
    /**
     * RC5 command byte for Zone 2 (system 0x17), when the family table lists one.
     * Absent when Zone 2 cannot select this input via discrete RC5.
     */
    rc5Zone2?: number;
}
/**
 * Supported inputs for `sourcePreset` accessories.
 *
 * Query codes: 0x1D response Data. RC5: system 16 (Z1) / 23 (Z2).
 */
export declare const SOURCE_DEFINITIONS: readonly SourceDefinition[];
/** Labels for Homebridge UI / docs (uppercase front-panel names). */
export declare const SOURCE_LABELS: readonly string[];
/**
 * Resolve a config source string (case-insensitive id or label) to a definition.
 *
 * Accepts `"cd"`, `"CD"`, `"Cd"`, etc.
 */
export declare function resolveSourceDefinition(value: string): SourceDefinition | undefined;
/** Look up a source by its 0x1D query/response byte. */
export declare function sourceFromQueryCode(code: number): SourceDefinition | undefined;
/**
 * RC5 command byte for selecting `source` in the given automation zone.
 *
 * @throws {RangeError} when the source has no discrete RC5 for that zone
 */
export declare function rc5CommandForSource(source: SourceDefinition, zone: number): number;
/** True when `source` can be selected in the given zone via discrete RC5. */
export declare function sourceSupportsZone(source: SourceDefinition, zone: number): boolean;
//# sourceMappingURL=sources.d.ts.map