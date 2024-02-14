/**
 * Handles websocket notifications
 */
import WebSocket from 'ws';
import logger from './logger.js'
import ns from './ns.js'
import callEventsReport from './call-events-report.js'

const CALL_EVENTS_REPORT_NOTIFICATION_SOURCE = 'call-events-report'
const PING_INTERVAL_MS = 8000;
const RECONNECT_DELAY_MS = 10000;

const log = logger.instance();

function json(o) {
    return JSON.stringify(o, null, 2);
}

class Listener {
    #channel
    #subscription
    #ws
    #reconnectTimer
    #isShuttingDown

    constructor() {
        this.#channel = null;
        this.#subscription = null;
        this.#ws = null;
        this.#reconnectTimer = null;
        this.#isShuttingDown = false;
    }

    async connect() {
        try {
            this.#cancelReconnectAttempt();

            log.debug('Listener - connect(): creating notification');
            this.#channel = (await ns.createNotificationChannel()).data;
            log.info(`Listener - connect(): created notification channel ${this.#channel.channelId}`);

            log.debug('Listener - connect(): creating subscription');
            this.#subscription = (await callEventsReport.createSubscription(this.#channel.channelId)).data;
            log.info(`Listener - connect(): created subscription ${this.#subscription.items[0].id}`);

            this.#ws = new WebSocket(this.#channel.channelData.channelURL);
            this.#ws.pingSequence = 0;
            this.#ws.pongSequence = 0;
            this.#ws.on('open', this.#onSocketOpen.bind(this));
            this.#ws.on('pong', this.#onSocketPong.bind(this));
            this.#ws.on('close', this.#onSocketClose.bind(this));
            this.#ws.on('error', this.#onSocketError.bind(this));
            this.#ws.on('message', this.#onSocketMessage.bind(this));
        } catch (e) {
            log.error(`Listener - connect() failed: ${e}`);
            this.#scheduleReconnectAttempt();
        }
    }

    disconnect(isShuttingDown) {
        if (isShuttingDown) {
            this.#isShuttingDown = true;
            this.#cancelReconnectAttempt();
        }

        if (this.#ws) {
            log.info('Listener - disconnect(): closing websocket');
            this.#ws.removeAllListeners();
            if (this.#ws.pingInterval) {
                clearInterval(this.#ws.pingInterval);
            }
            try { this.#ws.close(); } catch (e) { /* ignore */ }
            this.#ws = null;
        }

        if (this.#subscription) {
            log.info('Listener - disconnect(): deleting subscription');
            callEventsReport.deleteSubscription(this.#channel.channelId).catch(() => {});
            this.#subscription = null;
        }

        if (this.#channel) {
            log.info('Listener - disconnect(): deleting notification channel');
            ns.deleteNotificationChannel(this.#channel.channelId).catch(() => {});
            this.#channel = null;
        }
    }

    #scheduleReconnectAttempt(immediateReconnect) {
        if (this.#reconnectTimer == null && !this.#isShuttingDown) {
            this.disconnect(false);
            this.#reconnectTimer = setTimeout(() => this.connect(), immediateReconnect ? 0 : RECONNECT_DELAY_MS);
        }
    }

    #cancelReconnectAttempt() {
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
    }

    #onSocketOpen() {
        log.info(`Listener - connected to ${this.#ws.url}`);

        // Regularly ping the websocket server peer...
        this.#ws.pingInterval = setInterval(() => {
            const ping = {
                sequence: ++this.#ws.pingSequence
            };
            this.#ws.ping(JSON.stringify(ping));

            // ... and reconnect after 3 missed pong responses from the websocket peer
            const pendingPongs = this.#ws.pingSequence - this.#ws.pongSequence;
            if (pendingPongs > 3) {
                log.error('Listener - websocket liveness check failed: will attempt to reconnect...');
                this.#scheduleReconnectAttempt();
            }
        }, PING_INTERVAL_MS);
    }

    #onSocketPong(data) {
        const pong = JSON.parse(data);
        this.#ws.pongSequence = pong.sequence;
    }

    #onSocketClose(code, reason) {
        log.info(`Listener - websocket closed with code=${code} and reason=[${reason}]`);
        this.#scheduleReconnectAttempt();
    }

    #onSocketError(e) {
        log.error(`Listener - websocket error: ${e}`);
        this.#scheduleReconnectAttempt();
    }

    async #onSocketMessage(data) {
        try {
            const msg = JSON.parse(data);

            log.debug(`Listener - got message: ${json(msg)}`);

            if (msg.data.type == 'WEBSOCKET_REFRESH_REQUIRED') {
                log.debug('WEBSOCKET_REFRESH_REQUIRED: Refreshing notification channel');
                ns.refreshNotificationChannel(this.#channel.channelId)
                    .then(_ => {
                        log.info('Listener - refreshed notification channel');
                    })
                    .catch(e => {
                        log.error(`Listener - failed to refresh notification (${e}): will reconnect...`);
                        this.#scheduleReconnectAttempt();
                    });
            } else if (msg.data.type == 'WEBSOCKET_TO_BE_CLOSED') {
                log.info('WEBSOCKET_TO_BE_CLOSED: Recreating connection');
                this.#scheduleReconnectAttempt(true);
            } else if (msg.data.source == CALL_EVENTS_REPORT_NOTIFICATION_SOURCE) {
                callEventsReport.fetchCallEvents(msg.data.content.conversationSpaceId)
                    .then(response => {
                        log.info(`Listener - call events report: ${json(response.data)}`);
                    })
                    .catch(e => {
                        log.error(`Listener - failed to fetch call events report ${msg.data.content.conversationSpaceId}: ${e}`);
                    })
            }
        } catch (e) {
            log.error(`Listener - message handler got error ${e}`);
        }
    }
}


export {
    Listener
}
