import axios from 'axios';
import logger from './logger.js';
import { URLSearchParams } from 'url';;

const log = logger.instance();

/**
 * Creates a Call Events Report subscription for the configured account keys.
 */
async function createSubscription(channelId) {
    log.debug(`Creating subscription for channel ${channelId}`);

    var subscription = {
        channelId: channelId,
        accountKeys: [ process.env.ACCOUNT_KEY.trim() ]
    };

    return axios.request({
        method: 'POST',
        url: `https://api.goto.com/call-events-report/v1/subscriptions`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.state.tokenFetcher.getBearerAccessToken()
        },
        data: subscription,
        validateStatus: status => status == 201
    });
}

/**
 * Delete a Call Events Report subscription.
 */
async function deleteSubscription(channelId) {
    log.debug(`Deleting all subscriptions bound to channel ${channelId}`);

    const parameters = new URLSearchParams();
    parameters.append('channelId', channelId);
    parameters.append('accountKey', process.env.ACCOUNT_KEY.trim());

    return axios.request({
        method: 'DELETE',
        url: `https://api.goto.com/call-events-report/v1/subscriptions`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.state.tokenFetcher.getBearerAccessToken()
        },
        params: parameters,
        validateStatus: status => status == 204 || status == 404
    });
}

/**
 * Fetches events associated to a completed conversation
 */
async function fetchCallEvents(conversationSpaceId) {
    log.debug(`Fetching call events for conversation ${conversationSpaceId}`);

    return axios.request({
        method: 'GET',
        url: `https://api.goto.com/call-events-report/v1/reports/${conversationSpaceId}`,
        headers: {
            'Authorization': global.state.tokenFetcher.getBearerAccessToken()
        },
        validateStatus: status => status == 200
    });
}

export default {
    createSubscription,
    deleteSubscription,
    fetchCallEvents
}
