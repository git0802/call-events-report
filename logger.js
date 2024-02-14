import winston from 'winston';
import axios from 'axios';
import * as axioslog from 'axios-logger';

// Configure axios using axios-logger to emit to winston
axios.interceptors.request.use(axioslog.requestLogger, axioslog.errorLogger);
axios.interceptors.response.use(axioslog.responseLogger, axioslog.errorLogger);
axioslog.setGlobalConfig({
    prefixText: false,
    dateFormat: false,
    method: true,
    url: true,
    params: process.env.LOG_LEVEL == 'debug',
    data: process.env.LOG_LEVEL == 'debug',
    status: true,
    statusText: false,
    headers: false,
    logger: instance().debug.bind(this)
});

function instance() {
    const { combine, timestamp, printf, colorize, align } = winston.format;
    return winston.createLogger({
        level: process.env.LOG_LEVEL,
        format: combine(
            colorize(),
            timestamp({ format: 'HH:mm:ss.SSS' }),
            printf(log => `[${log.timestamp}] ${log.level} - ${log.message}`)
        ),
        transports: [
            new winston.transports.Console()
        ]
    });
}

export default {
    instance
}
