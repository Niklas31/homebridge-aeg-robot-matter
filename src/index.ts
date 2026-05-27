import type { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { AEGRobotPlatform } from './platform.js';

export default function(api: API): void {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, AEGRobotPlatform);
}
