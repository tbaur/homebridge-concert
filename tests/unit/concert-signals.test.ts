/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview When three unreachable polls become one page.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ConcertSignals,
  PAGERDUTY_STARTUP_LOG,
  RECEIVER_OFFLINE_SUMMARY,
  SIGNAL_RECEIVER_OFFLINE,
  createConcertSignals,
} from '../../src/concert-signals'
import type { SignalWriter } from '../../src/concert-signals'
import type { SignalState } from '../../src/pagerduty-signals'
import { PLUGIN_NAME, UNREACHABLE_POLLS_BEFORE_PAGE } from '../../src/settings'

class MemoryWriter implements SignalWriter {
  readonly writes: Array<{ signal: string, state: SignalState }> = []
  closed = false

  write(signal: string, state: SignalState): void {
    this.writes.push({ signal, state: { ...state } })
  }

  close(): void {
    this.closed = true
  }

  last(): SignalState | undefined {
    return this.writes.at(-1)?.state
  }
}

function unreachablePoll(signals: ConcertSignals, attemptsInCycle = 1): void {
  signals.beginCycle()
  for (let attempt = 0; attempt < attemptsInCycle; attempt++) {
    signals.noteUnreachable()
  }
  signals.finishPollCycle()
}

describe('ConcertSignals', () => {
  let writer: MemoryWriter
  let signals: ConcertSignals

  beforeEach(() => {
    writer = new MemoryWriter()
    signals = new ConcertSignals(writer)
  })

  it('pages on the third unreachable poll and not before', () => {
    expect(UNREACHABLE_POLLS_BEFORE_PAGE).toBe(3)

    unreachablePoll(signals)
    unreachablePoll(signals)
    expect(writer.writes).toEqual([])

    unreachablePoll(signals)
    expect(writer.last()).toEqual({
      active: true,
      severity: 'error',
      summary: RECEIVER_OFFLINE_SUMMARY,
    })
    expect(writer.writes[0]?.signal).toBe(SIGNAL_RECEIVER_OFFLINE)
  })

  it('counts several failures in one poll as one cycle', () => {
    unreachablePoll(signals, 3)
    unreachablePoll(signals, 2)
    expect(writer.writes).toEqual([])

    unreachablePoll(signals, 1)
    expect(writer.last()?.active).toBe(true)
  })

  it('does not count a poll that never dialed', () => {
    unreachablePoll(signals)
    unreachablePoll(signals)
    signals.beginCycle()
    signals.finishPollCycle()

    expect(writer.writes).toEqual([])
  })

  it('clears on a reply, including one that shares a cycle with a failed dial', () => {
    unreachablePoll(signals)
    unreachablePoll(signals)
    unreachablePoll(signals)
    expect(writer.last()?.active).toBe(true)

    signals.beginCycle()
    signals.noteUnreachable()
    signals.noteReply()
    signals.finishPollCycle()

    expect(writer.last()?.active).toBe(false)
    expect(JSON.stringify(writer.writes)).not.toContain('192.0.2.')
    expect(JSON.stringify(writer.writes)).not.toContain('XR-8S')
  })

  it('starts the three cycles over after a reply', () => {
    unreachablePoll(signals)
    unreachablePoll(signals)
    signals.noteReply()
    unreachablePoll(signals)
    unreachablePoll(signals)

    expect(writer.last()?.active).toBe(false)
  })

  it('closes without clearing an active signal', () => {
    unreachablePoll(signals)
    unreachablePoll(signals)
    unreachablePoll(signals)
    const written = writer.writes.length
    signals.close()
    signals.noteReply()
    signals.finishPollCycle()

    expect(writer.closed).toBe(true)
    expect(writer.writes).toHaveLength(written)
    expect(writer.last()?.active).toBe(true)
  })

  it('creates no store file until a signal is written', () => {
    const storagePath = mkdtempSync(join(tmpdir(), 'concert-signals-'))
    try {
      const created = createConcertSignals({
        plugin: PLUGIN_NAME,
        storagePath,
        log: { warn: jest.fn() },
      })
      created.close()
      expect(existsSync(join(storagePath, 'homebridge-pagerduty'))).toBe(false)
      expect(PAGERDUTY_STARTUP_LOG).toBe(
        'homebridge-pagerduty support is enabled (receiver-offline)',
      )
    } finally {
      rmSync(storagePath, { recursive: true, force: true })
    }
  })
})
