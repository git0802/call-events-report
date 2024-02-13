import axios from 'axios';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import deferred from './deferred.js';
import logger from './logger.js';
import qs from 'qs';

const OAUTH_AUTHORIZE_URI = 'https://authentication.logmeininc.com/oauth/authorize';
const OAUTH_TOKEN_URI = 'https://authentication.logmeininc.com/oauth/token';
const OAUTH_REDIRECT_URI = 'http://127.0.0.1:12021/app/redirect';

// Access tokens are refreshed after a third of their validity expired.
// Using a value less than 0.5 allow retrying temporarily failed refresh
// attempts before the token expires
const EXPIRATION_THRESHOLD = 1.0 / 3.0;

const html = {
    root: path.join(path.dirname(fileURLToPath(import.meta.url)), 'html')
};

const log = logger.instance();

/**
 * Handle OAuth authorization and performs background token refreshing
 */
class TokenFetcher {
    #requiredOauthScopes
    #serverReadyPromise
    #oauthTokenPromise
    #authorizationNonce
    #app
    #server
    #done
    #refreshHandle
    #token

    constructor(requiredOauthScopes) {
        this.#requiredOauthScopes = requiredOauthScopes;

        const serverReadyPromise = deferred.promise();
        this.#serverReadyPromise = serverReadyPromise;
        this.#oauthTokenPromise = deferred.promise();
        this.#authorizationNonce = crypto.randomBytes(15).toString('hex');
        this.#app = new express();
        this.#app.get('/app/redirect', async (req, res) => this.#redirectHandler(req, res));
        this.#server = this.#app.listen(12021);
        this.#server.on('listening', () => serverReadyPromise.resolve());
        this.#server.on('error', e => serverReadyPromise.reject(e));
        this.#server.on('close', () => log.debug('Token handler server is shutting down'));
        this.#done = false;
        this.#refreshHandle = null;
        this.#token = null;
    }

    /**
     * Begins authentication flow
     *
     * A console prompt will request that you open an URL to complete the authorization code flow.
     */
    async fetch() {
        const params = new URLSearchParams();
        params.append('response_type', 'code');
        params.append('client_id', process.env.OAUTH_CLIENT_ID);
        params.append('redirect_uri', OAUTH_REDIRECT_URI);
        params.append('scope', this.#requiredOauthScopes);
        params.append('state', this.#authorizationNonce);

        await this.#serverReadyPromise;

        axios.request({
            method: 'GET',
            url: OAUTH_AUTHORIZE_URI,
            params: params,
            maxRedirects: 0,
            validateStatus: status => status == 302
        }).then(response => {
            console.log('');
            console.log('Open this URL in a browser to authenticate:');
            console.log('-------------------------------------------');
            console.log(response.headers.location);
            console.log('-------------------------------------------');
            console.log();
        })
        .catch(e => {
            log.error('Could not fetch OAuth token');
            if (e.response) {
                log.error('OAuth server error response:\n' + e.response.data);
            }
            this.#oauthTokenPromise.reject();
        });

        return this.#oauthTokenPromise;
    }

    /**
     * Forces the internal server to shutdown cleanly
     */
    shutdown() {
        if (this.#done) {
            return;
        }
        this.#done = true;

        if (this.#server.listening) {
            this.#server.close();
        }

        if (this.#refreshHandle) {
            clearInterval(this.#refreshHandle);
        }

        this.#serverReadyPromise.resolve();
        this.#oauthTokenPromise.resolve();
    }

    async performTokenRefresh() {
        try {
            log.debug('Refreshing auth token');

            const refreshToken = this.#token.refresh_token;
            const response = await axios.request({
                method: 'POST',
                url: OAUTH_TOKEN_URI,
                headers: {
                    'Authorization': this.#getBasicAuth(),
                    'Accept': 'application/json'
                },
                data: qs.stringify({
                    'grant_type': 'refresh_token',
                    'refresh_token': refreshToken
                })
            })

            // Reuse the current refresh token if response doesn't provide one
            this.#token = response.data;
            this.#token.refresh_token = this.#token.refresh_token || refreshToken;

            log.info('Refreshed auth token');

            // Adjust for potentially changing expiration
            this.#configureBackgroundTokenRefresh();
        } catch (e) {
            log.error(`Failed to refresh auth token ${e}`);
        }
    }

    /**
     * Returns the current token
     *
     * Note: token is subject to refresh so should not be cached
     */
    getBearerAccessToken() {
        if (this.#token) {
            return `Bearer ${this.#token.access_token}`;
        }
        return null;
    }

    #getBasicAuth() {
        const creds = process.env.OAUTH_CLIENT_ID + ':' + process.env.OAUTH_CLIENT_SECRET;
        return 'Basic ' + Buffer.from(creds).toString('base64');
    }

    /**
     * Exchange an authorization code for a token, resolving the returned returned when the token is available
     */
    async #redirectHandler(req, res) {
        log.info('Handling auth redirection');
        try {
            res.set("Connection", "close")
            if (req.query.state == this.#authorizationNonce) {
                const response = await axios.request({
                    method: 'POST',
                    url: OAUTH_TOKEN_URI,
                    headers: {
                        'Authorization': this.#getBasicAuth(),
                        'Accept': 'application/json'
                    },
                    data: qs.stringify({
                        'grant_type': 'authorization_code',
                        'code': req.query.code,
                        'redirect_uri': OAUTH_REDIRECT_URI,
                        'client_id': process.env.OAUTH_CLIENT_ID
                    })
                })

                log.info(`Authorized principal is ${response.data.principal}`);

                res.status(200);
                res.sendFile('authorized.html', html);

                this.#token = response.data;
                this.#configureBackgroundTokenRefresh();
                this.#oauthTokenPromise.resolve();
            } else {
                res.status(403);
                res.sendFile('not_authorized.html', html);
                this.#oauthTokenPromise.reject('Ignoring authorization code with unexpected state');
            }
        } catch (error) {
            log.error(error);
            res.status(403);
            res.sendFile('not_authorized.html', html);
            this.#oauthTokenPromise.reject('Failed to exchange code for token: ' + error.message);
        }

        setTimeout(() => this.#server.close(), 0);
    }

    #configureBackgroundTokenRefresh() {
        if (this.#refreshHandle) {
            clearInterval(this.#refreshHandle);
            this.#refreshHandle = null;
        }

        const refreshToken = this.#token.refresh_token;
        const expiresIn = this.#token.expires_in;
        if (refreshToken && expiresIn > 0) {
            this.#refreshHandle = setInterval(this.performTokenRefresh.bind(this), (1000 * expiresIn) * EXPIRATION_THRESHOLD);
        } else {
            log.warn('Background token refresh cannot be enabled')
        }
    }
};


export {
    TokenFetcher
}
