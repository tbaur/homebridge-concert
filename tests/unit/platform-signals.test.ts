/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview The setting opens the signal store, and a bad config does not.
 */

import type { API, Logging } from 'homebridge'

import { PAGERDUTY_STARTUP_LOG } from '../../src/concert-signals'
import { PagerDutySignals } from '../../src/pagerduty-signals'
import ConcertPlatform from '../../src/platform'
import type { ConcertPlatformConfig } from '../../src/types'

function createLog(): Logging {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
  } as unknown as Logging
}

function createApi(storagePath: jest.Mock): API {
  const handlers = new Map<string, () => void>()
  return {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: (value: string) => `uuid-${value}` },
    },
    on: jest.fn((event: string, handler: () => void) => {
      handlers.set(event, handler)
    }),
    emit(event: string) {
      handlers.get(event)?.()
    },
    user: { storagePath },
  } as unknown as API
}

function validConfig(pagerdutySignals?: boolean): ConcertPlatformConfig {
  return {
    platform: 'Concert',
    name: 'Concert',
    host: '192.0.2.50',
    accessories: [{ type: 'power', name: 'Power', zone: 1 }],
    options: pagerdutySignals === undefined ? undefined : { pagerdutySignals },
  }
}

describe('PagerDuty signal wiring', () => {
  it('does not open the store when the setting is off or startup validation failed', () => {
    const storagePath = jest.fn(() => 'hb-storage')
    const log = createLog()
    new ConcertPlatform(log, validConfig(), createApi(storagePath))
    new ConcertPlatform(log, validConfig(false), createApi(storagePath))
    new ConcertPlatform(
      log,
      { platform: 'Concert', options: { pagerdutySignals: true } } as ConcertPlatformConfig,
      createApi(storagePath),
    )

    expect(storagePath).not.toHaveBeenCalled()
    expect(log.info).not.toHaveBeenCalledWith(PAGERDUTY_STARTUP_LOG)
  })

  it('opens the store from the Homebridge storage path and closes it on shutdown', () => {
    const storagePath = jest.fn(() => 'hb-storage')
    const close = jest.spyOn(PagerDutySignals.prototype, 'close').mockImplementation(() => undefined)
    const log = createLog()
    const api = createApi(storagePath)
    new ConcertPlatform(log, validConfig(true), api)

    expect(storagePath).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(PAGERDUTY_STARTUP_LOG)

    ;(api as unknown as { emit: (event: string) => void }).emit('shutdown')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
