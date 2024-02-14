import axios from 'axios';
import logger from './logger.js';

const CHANNEL_NICKNAME = 'demo';

const log = logger.instance();

/**
 * Creates a web socket notification channel.
 *
 * Note: a single notification channel can have multiple subscriptions
 * attached to it. In a real application, it is recommended that you
 * reuse a channel for multiple subscriptions where possible rather than
 * create a pair of (channel, subscription) for each.
 */
async function createNotificationChannel() {
    return axios.request({
        method: 'POST',
        url: `https://webrtc.jive.com/notification-channel/v1/channels/${CHANNEL_NICKNAME}`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.state.tokenFetcher.getBearerAccessToken()
        },
        data: {
            channelType: 'WebSocket'
        },
        validateStatus: status => status == 201
    });
}

/**
 * Refreshes a web socket notification channel.
 *
 * Note: this must be performed after receiving a WEBSOCKET_REFRESH_REQUIRED type message.
 */
async function refreshNotificationChannel(channelId) {
    return axios.request({
        method: 'PUT',
        url: `https://webrtc.jive.com/notification-channel/v1/channels/${CHANNEL_NICKNAME}/${channelId}`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.state.tokenFetcher.getBearerAccessToken()
        },
        data: {
            channelType: 'WebSocket'
        },
        validateStatus: status => status == 200
    });
}

/**
 * Deletes a notification channel
 */
async function deleteNotificationChannel(channelId) {
    return axios.request({
        method: 'DELETE',
        url: `https://webrtc.jive.com/notification-channel/v1/channels/${CHANNEL_NICKNAME}/${channelId}`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.state.tokenFetcher.getBearerAccessToken()
        },
        validateStatus: status => status == 204 || status == 404
    });
}


export default {
    createNotificationChannel,
    refreshNotificationChannel,
    deleteNotificationChannel
}
