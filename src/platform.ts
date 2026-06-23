import type {
    API,
    Characteristic,
    DynamicPlatformPlugin,
    Logger,
    PlatformAccessory,
    PlatformConfig,
    Service
} from 'homebridge';
import NodePersist from 'node-persist';
import Path from 'node:path';
import { AEGAccount, AEGPendingRX9 } from './aeg-account.js';
import { AEGApplianceRX9 } from './aeg-appliance-rx9.js';
import { ActivityRX9 } from './aeg-appliance-rx9-ctrl-activity.js';
import { Config, ExposeMode, SwitchOffAction } from './config-types.js';
import { PrefixLogger } from './logger.js';
import { logError } from './log-error.js';
import { DEFAULT_CONFIG, PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { RX9RobotStatus } from './aegapi-rx9-types.js';

import { AEGMatterRobot } from './aeg-appliance-matter-rx9.js';

interface AccessoryContext {
    serialNumber: string;
    applianceName: string;
}

const ACTIVE_STATUSES = new Set<RX9RobotStatus>([
    RX9RobotStatus.Cleaning,
    RX9RobotStatus.PausedCleaning,
    RX9RobotStatus.SpotCleaning,
    RX9RobotStatus.PausedSpotCleaning,
    RX9RobotStatus.ReturnForPitstop,
    RX9RobotStatus.PausedReturnForPitstop,
    RX9RobotStatus.Pitstop
]);

const OFF_ACTION: Record<SwitchOffAction, ActivityRX9> = {
    pause: 'Pause',
    stop:  'Stop',
    dock:  'Home'
};

export class AEGRobotPlatform implements DynamicPlatformPlugin {
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly config: Config;
    readonly logger: PrefixLogger;
    readonly accessories = new Map<string, PlatformAccessory<AccessoryContext>>();
    readonly robots = new Map<string, AEGApplianceRX9>();
    persist?: NodePersist.LocalStorage;

    constructor(
        readonly log: Logger,
        rawConfig: PlatformConfig,
        readonly api: API
    ) {
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.config = normalizeConfig(rawConfig);
        this.logger = new PrefixLogger(log);
        if (this.config.debugFeatures.includes('Log Debug as Info')) this.logger.logDebugAsInfo();

        this.api.on('didFinishLaunching', () => {
            void this.discoverRobots();
        });
        this.api.on('shutdown', () => {
            void this.shutdown();
        });
    }

    configureAccessory(accessory: PlatformAccessory): void {
        const context = accessory.context as Partial<AccessoryContext>;
        if (context.serialNumber) {
            this.accessories.set(context.serialNumber, accessory as PlatformAccessory<AccessoryContext>);
        }
    }

    private async discoverRobots(): Promise<void> {
        try {
            this.persist = NodePersist.create({
                dir: Path.join(this.api.user.storagePath(), PLUGIN_NAME)
            });
            await this.persist.init();

            const account = new AEGAccount(this.logger, this.config, this.persist);
            const pending = await account.getAllRX9();
            this.logger.info(`Found ${pending.length} robot vacuum cleaner candidate(s)`);

            const registered: AEGApplianceRX9[] = [];
            for (const robot of pending) {
                const appliance = await robot.appliancePromise;
                if (!this.isSelected(appliance)) continue;
                registered.push(appliance);
                await this.registerRobot(robot);
            }

            this.unregisterMissingAccessories(registered);
        } catch (err) {
            logError(this.logger, 'Discovering robots', err);
        }
    }

    private async registerRobot(pending: AEGPendingRX9): Promise<void> {
        const appliance = await pending.appliancePromise;
        this.robots.set(appliance.serialNumber, appliance);
        const exposeMode = this.getEffectiveExposeMode();

        if (exposeMode === 'switch' || exposeMode === 'both') {
            this.registerSwitch(appliance);
        }

        if ((exposeMode === 'matter-rvc' || exposeMode === 'both') && this.api.isMatterEnabled?.()) {
            new AEGMatterRobot(this, appliance);
        }

        await appliance.start();
        appliance.on('changed', () => this.updateSwitchState(appliance));
    }

    private registerSwitch(appliance: AEGApplianceRX9): void {
        const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${appliance.serialNumber}:switch`);
        let accessory = this.accessories.get(appliance.serialNumber);

        if (!accessory) {
            accessory = new this.api.platformAccessory<AccessoryContext>(appliance.applianceName, uuid);
            accessory.context.serialNumber = appliance.serialNumber;
            accessory.context.applianceName = appliance.applianceName;
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.accessories.set(appliance.serialNumber, accessory);
        }

        const info = accessory.getService(this.Service.AccessoryInformation)
            ?? accessory.addService(this.Service.AccessoryInformation);
        info.setCharacteristic(this.Characteristic.Manufacturer, appliance.brand || 'AEG')
            .setCharacteristic(this.Characteristic.Model, appliance.model || 'RX9')
            .setCharacteristic(this.Characteristic.SerialNumber, appliance.serialNumber)
            .setCharacteristic(this.Characteristic.FirmwareRevision, appliance.state.firmwareVersion || 'unknown');

        const service = accessory.getService(this.Service.Switch)
            ?? accessory.addService(this.Service.Switch, appliance.applianceName);
        service.setCharacteristic(this.Characteristic.Name, appliance.applianceName);
        service.getCharacteristic(this.Characteristic.On)
            .onSet(value => this.setSwitchState(appliance, Boolean(value)))
            .onGet(() => this.isCleaning(appliance));

        this.updateSwitchState(appliance);
    }

    private async setSwitchState(appliance: AEGApplianceRX9, on: boolean): Promise<void> {
        const activity = on ? 'Clean' : OFF_ACTION[this.config.switchOffAction];
        this.logger.info(`${on ? 'Starting' : 'Stopping'} ${appliance.applianceName} via ${activity}`);
        const allowed = await appliance.setActivity(activity);
        if (!allowed) {
            throw new Error(`Robot cannot switch ${on ? 'on' : 'off'} from current state`);
        }
    }

    private updateSwitchState(appliance: AEGApplianceRX9): void {
        const accessory = this.accessories.get(appliance.serialNumber);
        const service = accessory?.getService(this.Service.Switch);
        service?.updateCharacteristic(this.Characteristic.On, this.isCleaning(appliance));
    }

    private isCleaning(appliance: AEGApplianceRX9): boolean {
        return ACTIVE_STATUSES.has(appliance.state.fauxStatus);
    }

    private getEffectiveExposeMode(): ExposeMode {
        if (this.config.exposeMode !== 'auto') return this.config.exposeMode;
        if (this.api.isMatterEnabled?.()) {
            return 'matter-rvc';
        }
        return 'switch';
    }

    private isSelected(robot: AEGApplianceRX9): boolean {
        const { serialNumber } = robot;
        if (this.config.blackList.includes(serialNumber)) return false;
        if (this.config.whiteList.length && !this.config.whiteList.includes(serialNumber)) return false;
        return true;
    }

    private unregisterMissingAccessories(robots: AEGApplianceRX9[]): void {
        const serials = new Set(robots.map(robot => robot.serialNumber));
        const stale = [...this.accessories.values()].filter(accessory => !serials.has(accessory.context.serialNumber));
        if (stale.length) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
        }
    }

    private async shutdown(): Promise<void> {
        await Promise.all([...this.robots.values()].map(async robot => robot.stop()));
    }
}

function normalizeConfig(raw: PlatformConfig): Config {
    const config = { ...DEFAULT_CONFIG, ...raw } as Config;
    config.name ??= 'AEG Robot';
    config.whiteList ??= [];
    config.blackList ??= [];
    config.accessToken ??= '';
    config.refreshToken ??= '';
    config.pollIntervalSeconds ??= 30;
    config.exposeMode ??= 'auto';
    config.switchOffAction ??= 'dock';
    config.logMapStyle ??= 'Off';
    config.debug ??= false;
    config.debugFeatures ??= [];

    if (!config.apiKey) {
        throw new Error('Missing required Electrolux apiKey');
    }
    return config;
}
