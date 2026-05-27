import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Config } from './config-types.js';

interface PackageJson {
    engines:        Record<string, string>;
    name:           string;
    displayName:    string;
    version:        string;
    homepage:       string;
}

const PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const PACKAGE = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as PackageJson;

export const ENGINES        = PACKAGE.engines;
export const PLUGIN_NAME    = PACKAGE.name;
export const PLATFORM_NAME  = 'AEGRobotMatter';
export const DISPLAY_NAME   = PACKAGE.displayName;
export const PLUGIN_VERSION = PACKAGE.version;
export const PLUGIN_URL     = PACKAGE.homepage;

export const API_DAILY_LIMIT = 5000;
export const API_DAILY_POLL_LIMIT = API_DAILY_LIMIT * 0.9;

export const DEFAULT_CONFIG: Partial<Config> = {
    name:                   DISPLAY_NAME,
    whiteList:              [],
    blackList:              [],
    accessToken:            '',
    refreshToken:           '',
    pollIntervalSeconds:    30,
    exposeMode:             'auto',
    switchOffAction:        'dock',
    logMapStyle:            'Off',
    debug:                  false,
    debugFeatures:          []
};

if (process.env.ELECTROLUX_API_KEY) {
    DEFAULT_CONFIG.apiKey = process.env.ELECTROLUX_API_KEY;
}
if (process.env.ELECTROLUX_ACCESS_TOKEN_URL) {
    Object.assign(DEFAULT_CONFIG, {
        accessTokenURL: process.env.ELECTROLUX_ACCESS_TOKEN_URL,
        accessToken:    '',
        refreshToken:   ''
    });
}
