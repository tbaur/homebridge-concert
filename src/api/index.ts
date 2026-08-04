/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 */

export { ConcertClient } from './client'
export type {
  ConcertClientOptions,
  SetSourceWhenReadyOptions,
  SetVolumeWhenReadyOptions,
} from './client'
export {
  ANSWER_INVALID_STATE,
  ANSWER_OK,
  COMMAND_POWER,
  COMMAND_RC5,
  COMMAND_SOURCE,
  COMMAND_VOLUME,
  FRAME_END,
  FRAME_START,
  MAX_VOLUME,
  MIN_VOLUME,
  POWER_ON,
  POWER_QUERY,
  POWER_STANDBY,
  RC5_POWER_OFF,
  RC5_POWER_ON,
  RC5_SYSTEM_ZONE1,
  RC5_SYSTEM_ZONE2,
  SOURCE_DEFINITIONS,
  SOURCE_FOLLOW_ZONE1,
  SOURCE_IDS,
  SOURCE_LABELS,
  SOURCE_QUERY,
  VOLUME_QUERY,
  buildPowerOn,
  buildPowerQuery,
  buildPowerStandby,
  buildRc5,
  buildRequest,
  buildSourceQuery,
  buildSourceSet,
  buildVolumeQuery,
  buildVolumeSet,
  describeAnswerCode,
  formatFrame,
  isPowerOn,
  isSourceFollowZone1,
  parseSource,
  parseVolume,
  rc5CommandForSource,
  rc5SystemForZone,
  resolveSourceDefinition,
  sourceFromQueryCode,
  sourceSupportsZone,
  tryParseResponse,
} from './protocol'
export type { ProtocolResponse, SourceDefinition, SourceId } from './protocol'
