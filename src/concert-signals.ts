/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview When the Concert receiver is unreachable enough to page.
 *
 * One signal for the whole receiver. A poll cycle counts once, however many
 * accessories failed in it. The store writer is the copied module.
 */

import { PagerDutySignals } from './pagerduty-signals'
import type { PagerDutySignalsOptions, SignalState } from './pagerduty-signals'
import { UNREACHABLE_POLLS_BEFORE_PAGE } from './settings'

/** Logged once, when the setting is on, before the first request. */
export const PAGERDUTY_STARTUP_LOG = 'homebridge-pagerduty support is enabled (receiver-offline)'

export const SIGNAL_RECEIVER_OFFLINE = 'receiver-offline'

export const RECEIVER_OFFLINE_SUMMARY =
  'Homebridge has not reached the Concert receiver. Its switches may show No Response.'

/** The subset of the store writer this class uses. */
export interface SignalWriter {
  write(signal: string, state: SignalState): void
  close(): void
}

/**
 * `receiver-offline` for this plugin.
 *
 * Three poll cycles that tried to reach the receiver and got no reply turn it
 * on. A reply, including a rejected command, turns it off. A cycle that never
 * dialed because polling was already paused does not count.
 */
export class ConcertSignals {
  readonly #writer: SignalWriter
  readonly #pollsBeforePage: number
  #streak = 0
  #cycleSawReply = false
  #cycleSawUnreachable = false
  #isClosed = false

  constructor(writer: SignalWriter, pollsBeforePage = UNREACHABLE_POLLS_BEFORE_PAGE) {
    this.#writer = writer
    this.#pollsBeforePage = pollsBeforePage
  }

  /** Start a refresh. Does not change the streak. */
  beginCycle(): void {
    if (this.#isClosed) {
      return
    }
    this.#cycleSawReply = false
    this.#cycleSawUnreachable = false
  }

  /**
   * The receiver sent a frame, or a command completed.
   *
   * Clears the page immediately. Standby and a rejected command both count.
   */
  noteReply(): void {
    if (this.#isClosed) {
      return
    }
    this.#cycleSawReply = true
    this.#streak = 0
    this.#write(false)
  }

  /**
   * A poll or command tried to reach the receiver and the connection failed.
   *
   * Does not by itself turn the page on. The poll cycle is counted in
   * {@link finishPollCycle}.
   */
  noteUnreachable(): void {
    if (this.#isClosed) {
      return
    }
    this.#cycleSawUnreachable = true
  }

  /**
   * End a poll cycle.
   *
   * Counts one unreachable cycle when this refresh dialed and got no reply.
   * A reply in the same cycle, or a cycle that only failed because polling
   * was already paused, leaves the streak where it was.
   */
  finishPollCycle(): void {
    if (this.#isClosed || this.#cycleSawReply || !this.#cycleSawUnreachable) {
      return
    }
    this.#streak += 1
    if (this.#streak >= this.#pollsBeforePage) {
      this.#write(true)
    }
  }

  /** Close the store. Does not clear the signal. */
  close(): void {
    if (this.#isClosed) {
      return
    }
    this.#isClosed = true
    this.#writer.close()
  }

  #write(active: boolean): void {
    this.#writer.write(SIGNAL_RECEIVER_OFFLINE, {
      active,
      severity: 'error',
      summary: RECEIVER_OFFLINE_SUMMARY,
    })
  }
}

/** Build the signals for this plugin, backed by the homebridge-pagerduty store. */
export function createConcertSignals(options: PagerDutySignalsOptions): ConcertSignals {
  return new ConcertSignals(new PagerDutySignals(options))
}
