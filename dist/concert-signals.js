"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConcertSignals = exports.RECEIVER_OFFLINE_SUMMARY = exports.SIGNAL_RECEIVER_OFFLINE = exports.PAGERDUTY_STARTUP_LOG = void 0;
exports.createConcertSignals = createConcertSignals;
const pagerduty_signals_1 = require("./pagerduty-signals");
const settings_1 = require("./settings");
/** Logged once, when the setting is on, before the first request. */
exports.PAGERDUTY_STARTUP_LOG = 'homebridge-pagerduty support is enabled (receiver-offline)';
exports.SIGNAL_RECEIVER_OFFLINE = 'receiver-offline';
exports.RECEIVER_OFFLINE_SUMMARY = 'Homebridge has not reached the Concert receiver. Its switches may show No Response.';
/**
 * `receiver-offline` for this plugin.
 *
 * Three poll cycles that tried to reach the receiver and got no reply turn it
 * on. A reply, including a rejected command, turns it off. A cycle that never
 * dialed because polling was already paused does not count.
 */
class ConcertSignals {
    #writer;
    #pollsBeforePage;
    #streak = 0;
    #cycleSawReply = false;
    #cycleSawUnreachable = false;
    #isClosed = false;
    constructor(writer, pollsBeforePage = settings_1.UNREACHABLE_POLLS_BEFORE_PAGE) {
        this.#writer = writer;
        this.#pollsBeforePage = pollsBeforePage;
    }
    /** Start a refresh. Does not change the streak. */
    beginCycle() {
        if (this.#isClosed) {
            return;
        }
        this.#cycleSawReply = false;
        this.#cycleSawUnreachable = false;
    }
    /**
     * The receiver sent a frame, or a command completed.
     *
     * Clears the page immediately. Standby and a rejected command both count.
     */
    noteReply() {
        if (this.#isClosed) {
            return;
        }
        this.#cycleSawReply = true;
        this.#streak = 0;
        this.#write(false);
    }
    /**
     * A poll or command tried to reach the receiver and the connection failed.
     *
     * Does not by itself turn the page on. The poll cycle is counted in
     * {@link finishPollCycle}.
     */
    noteUnreachable() {
        if (this.#isClosed) {
            return;
        }
        this.#cycleSawUnreachable = true;
    }
    /**
     * End a poll cycle.
     *
     * Counts one unreachable cycle when this refresh dialed and got no reply.
     * A reply in the same cycle, or a cycle that only failed because polling
     * was already paused, leaves the streak where it was.
     */
    finishPollCycle() {
        if (this.#isClosed || this.#cycleSawReply || !this.#cycleSawUnreachable) {
            return;
        }
        this.#streak += 1;
        if (this.#streak >= this.#pollsBeforePage) {
            this.#write(true);
        }
    }
    /** Close the store. Does not clear the signal. */
    close() {
        if (this.#isClosed) {
            return;
        }
        this.#isClosed = true;
        this.#writer.close();
    }
    #write(active) {
        this.#writer.write(exports.SIGNAL_RECEIVER_OFFLINE, {
            active,
            severity: 'error',
            summary: exports.RECEIVER_OFFLINE_SUMMARY,
        });
    }
}
exports.ConcertSignals = ConcertSignals;
/** Build the signals for this plugin, backed by the homebridge-pagerduty store. */
function createConcertSignals(options) {
    return new ConcertSignals(new pagerduty_signals_1.PagerDutySignals(options));
}
//# sourceMappingURL=concert-signals.js.map