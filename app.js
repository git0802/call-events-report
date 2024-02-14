// Emit logs in UTC timezone to make it easier to compare log timestamp with timestamp embedded in responses (which are in UTC)
process.env.TZ='UTC';
import {} from 'dotenv/config';
import logger from './logger.js';
import { TokenFetcher } from './token.js';
import { Listener } from './listener.js';

/**
 * Verify configuration
 */
const configured = process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET && process.env.OAUTH_CLIENT_ID && process.env.ACCOUNT_KEY && process.env.LOG_LEVEL;
if (!configured) {
    console.error('You must create a valid .env configuration file. Refer to our Call Events Report developer guide on https://developer.goto.com/ for more information');
    process.exit(1);
}

const log = logger.instance();

log.info('Starting demo. Press Ctrl-C to exit...');

/**
 * Share stateful context accross modules through global.
 */
global.state = {
    tokenFetcher: null,
}

var listener = null;
var shutdownInProgress = false;

/**
 * Configures signal handlers to initiate orderly termination.
 */
process.on('SIGINT', shutdownHandler);
process.on('SIGTERM', shutdownHandler);
process.on('exit', code => log.info(`Terminating with exit code ${code}`))
function shutdownHandler(sig) {
    // filter duplicate SIGINT which can happen if running with 'npm start'
    if (shutdownInProgress) {
        return;
    }
    shutdownInProgress = true;

    console.log('');
    log.info(`Received signal ${sig}: shutting down...`);

    shutdown();
}

function shutdown() {
    if (global.state.tokenFetcher) {
        global.state.tokenFetcher.shutdown();
        global.state.tokenFetcher = null;
    }

    if (listener) {
        listener.disconnect(true);
        listener = null;
    }
}

/**
 * Start the token fetcher, waiting until an access token available.
 * The argument are the OAuth scopes required for the demo to work.
 */
global.state.tokenFetcher = new TokenFetcher('cr.v1.read call-events.v1.notifications.manage');

/**
 * Start the listener unless token fetcher failed or user triggered shutdown with Ctrl-C
 *
 * node.js will exit once the event loop has nothing to process after processing SIGINT/SIGTERM.
 */
try {
    await global.state.tokenFetcher.fetch();
    if (!shutdownInProgress && global.state.tokenFetcher.getBearerAccessToken() != null) {
        listener = new Listener(global.state.tokenFetcher);
        listener.connect();
    }
} catch (e) {
    shutdown();
}
