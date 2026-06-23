// Matter RVC implementation for AEG RX9 / Electrolux Pure i9 robot vacuum
// Based on proven logic from Matterbridge implementation and Homebridge 2.0 requirements
// Copyright © 2026 Niklas31

import * as settings from './settings.js';
import { AEGApplianceRX9 } from './aeg-appliance-rx9.js';
import { AEGRobotPlatform } from './platform.js';
import { RX9BatteryStatus, RX9RobotStatus } from './aegapi-rx9-types.js';

export class AEGMatterRobot {
    private readonly matter: NonNullable<AEGRobotPlatform['api']['matter']>;
    private readonly uuid: string;
    private readonly areaMap = new Map<string, number>();
    private readonly reverseAreaMap = new Map<number, { persistentMapId: string, zoneId: string }>();

    constructor(
        private readonly platform: AEGRobotPlatform,
        private readonly appliance: AEGApplianceRX9,
    ) {
        this.matter = this.platform.api.matter!;
        this.uuid = this.matter.uuid.generate(`${settings.PLUGIN_NAME}:${this.appliance.serialNumber}:matter`);
        void this.register();
        this.appliance.on('changed', () => {
            void this.updateState();
        });
    }

    private async register(): Promise<void> {
        const { deviceTypes, clusterNames } = this.matter;

        try {
            // Map rooms from the appliance's interactive maps
            this.areaMap.clear();
            this.reverseAreaMap.clear();
            const supportedAreas = this.appliance.maps.flatMap((map, mapIdx) => 
                (map.zones ?? []).map((zone, zoneIdx) => {
                    const areaId = (mapIdx * 100) + zoneIdx + 1;
                    this.areaMap.set(zone.id, areaId);
                    this.reverseAreaMap.set(areaId, { persistentMapId: map.id, zoneId: zone.id });
                    return {
                        areaId,
                        mapId: mapIdx + 1,
                        areaInfo: {
                            locationInfo: { 
                                locationName: zone.name,
                                floorNumber: null,
                                areaType: 1 // Room
                            },
                            landmarkInfo: null
                        }
                    };
                })
            );

            await this.matter.registerPlatformAccessories(settings.PLUGIN_NAME, this.platform.config.name, [{
                UUID: this.uuid,
                displayName: this.appliance.applianceName,
                deviceType: deviceTypes.RoboticVacuumCleaner,
                serialNumber: this.appliance.serialNumber,
                manufacturer: this.appliance.brand || 'AEG',
                model: this.appliance.model || 'RX9',
                firmwareRevision: this.appliance.state.firmwareVersion || 'unknown',
                context: {
                    serialNumber: this.appliance.serialNumber,
                },
                clusters: {
                    [clusterNames.BasicInformation]: {
                        vendorName: this.appliance.brand || 'AEG',
                        vendorId: 0xFFF1,
                        productName: 'AEG ' + (this.appliance.model || 'RX9'),
                        productId: 0x8001,
                        nodeLabel: this.appliance.applianceName,
                        hardwareVersion: 1,
                        hardwareVersionString: '1.0',
                        softwareVersion: 2,
                        softwareVersionString: settings.PLUGIN_VERSION,
                    },
                    // Use bridgedDeviceBasicInformation for bridged accessories to show correct manufacturer
                    [clusterNames.BridgedDeviceBasicInformation]: {
                        vendorName: this.appliance.brand || 'AEG',
                        vendorId: 0xFFF1,
                        productName: 'AEG ' + (this.appliance.model || 'RX9'),
                        productId: 0x8001,
                        nodeLabel: this.appliance.applianceName,
                        hardwareVersion: 1,
                        hardwareVersionString: '1.0',
                        softwareVersion: 2,
                        softwareVersionString: settings.PLUGIN_VERSION,
                        manufacturerName: this.appliance.brand || 'AEG',
                        modelName: this.appliance.model || 'RX9',
                        serialNumber: this.appliance.serialNumber,
                        reachable: true,
                    },
                    [clusterNames.PowerSource]: this.mapPowerSource(),
                    [clusterNames.RvcOperationalState]: {
                        operationalState: this.mapOperationalState(),
                        operationalError: { errorStateId: 0x00 },
                        operationalStateList: [
                            { operationalStateId: 0x00 }, // Stopped
                            { operationalStateId: 0x01 }, // Running
                            { operationalStateId: 0x02 }, // Paused
                            { operationalStateId: 0x03 }, // Error
                            { operationalStateId: 0x40 }, // SeekingCharger
                            { operationalStateId: 0x41 }, // Charging
                            { operationalStateId: 0x42 }, // Docked
                        ],
                        phaseList: [],
                    },
                    [clusterNames.RvcRunMode]: {
                        currentMode: this.mapRunMode(),
                        supportedModes: [
                            { label: 'Idle', mode: 0, modeTags: [{ value: 0x4000 }] },
                            { label: 'Cleaning', mode: 1, modeTags: [{ value: 0x4001 }] },
                        ],
                    } as any,
                    [clusterNames.RvcCleanMode]: {
                        currentMode: this.mapCleanMode(),
                        supportedModes: [
                            { label: 'Quiet', mode: 0, modeTags: [{ value: 0x4001 }, { value: 0x2 }] }, // 0x2: Quiet
                            { label: 'Smart', mode: 1, modeTags: [{ value: 0x4001 }, { value: 0x0 }] }, // 0x0: Auto
                            { label: 'Power', mode: 2, modeTags: [{ value: 0x4001 }, { value: 0x7 }] }, // 0x7: Max
                        ],
                    } as any,
                    [clusterNames.ServiceArea]: {
                        featureMap: { selectAreas: true, maps: true, progressReporting: true },
                        supportedAreas,
                        supportedMaps: this.appliance.maps.map((map, index) => ({
                            mapId: index + 1,
                            name: map.name || `Map ${index + 1}`
                        })),
                        selectedAreas: [],
                        currentArea: null,
                        progress: [],
                    } as any,
                    [clusterNames.OnOff]: {
                        onOff: this.isCleaning(),
                    }
                },
                handlers: {
                    [clusterNames.RvcOperationalState]: {
                        pause: async () => { await this.appliance.setActivity('Pause'); },
                        resume: async () => { await this.appliance.setActivity('Resume'); },
                        goHome: async () => { await this.appliance.setActivity('Home'); },
                    },
                    [clusterNames.RvcRunMode]: {
                        changeToMode: async (args: { newMode: number }) => {
                            if (args.newMode === 1) await this.appliance.setActivity('Clean');
                            else if (args.newMode === 0) await this.appliance.setActivity('Stop');
                        }
                    },
                    [clusterNames.RvcCleanMode]: {
                        changeToMode: async () => {
                            this.platform.logger.info('Power mode change requested but not supported by API');
                        }
                    },
                    [clusterNames.ServiceArea]: {
                        selectAreas: async (args: any) => {
                            const newAreas = args?.newAreas as number[] | undefined;
                            if (newAreas && newAreas.length > 0) {
                                this.platform.logger.info(`Cleaning areas: ${newAreas.join(', ')}`);
                                
                                // Group by map (robot can only clean one map at a time)
                                const area = this.reverseAreaMap.get(newAreas[0]);
                                if (area) {
                                    const zones = newAreas.map(id => this.reverseAreaMap.get(id))
                                        .filter(a => a?.persistentMapId === area.persistentMapId)
                                        .map(a => ({ zoneId: a!.zoneId, powerMode: this.appliance.state.powerMode || 2 }));

                                    this.appliance.customPlay = {
                                        persistentMapId: area.persistentMapId,
                                        zones
                                    };
                                    await this.appliance.setActivity('Clean');
                                }
                            } else {
                                await this.appliance.setActivity('Clean');
                            }
                        }
                    },
                    [clusterNames.OnOff]: {
                        on: async () => { await this.appliance.setActivity('Clean'); },
                        off: async () => { await this.appliance.setActivity('Home'); },
                    }
                }
            }]);
            this.platform.logger.info(`Registered ${this.appliance.applianceName} (v${settings.PLUGIN_VERSION})`);
        } catch (err) {
            this.platform.logger.error(`Failed to register Matter accessory: ${err}`);
        }
    }

    private async updateState(): Promise<void> {
        if (!this.platform.api.isMatterEnabled()) return;
        const { clusterNames } = this.matter;
        
        try {
            await this.matter.updateAccessoryState(this.uuid, clusterNames.RvcOperationalState, {
                operationalState: this.mapOperationalState(),
                operationalError: { errorStateId: 0x00 }
            });
            await this.matter.updateAccessoryState(this.uuid, clusterNames.OnOff, {
                onOff: this.isCleaning(),
            });
            await this.matter.updateAccessoryState(this.uuid, clusterNames.RvcRunMode, {
                currentMode: this.mapRunMode(),
            });
            await this.matter.updateAccessoryState(this.uuid, clusterNames.RvcCleanMode, {
                currentMode: this.mapCleanMode(),
            });
            await this.matter.updateAccessoryState(this.uuid, clusterNames.PowerSource, this.mapPowerSource());
            
            // Update ServiceArea progress
            const progress = this.appliance.state.zoneStatus.map(zs => ({
                areaId: this.areaMap.get(zs.id) || 0,
                status: this.mapZoneStatus(zs.status),
            })).filter(p => p.areaId !== 0);

            await this.matter.updateAccessoryState(this.uuid, clusterNames.ServiceArea, {
                progress,
            });
        } catch (err) {
            this.platform.logger.debug(`Matter state update skipped: ${err}`);
        }
    }

    private mapPowerSource(): any {
        const { batteryStatus, isCharging } = this.appliance.state;
        // batPercentRemaining is 0-200 (double the percentage). 
        // AEG levels 1-6: 1=Dead, 2=Crit, 3=Low, 4=Med, 5=High, 6=Full
        const percentMap: Record<number, number> = { 1: 0, 2: 20, 3: 60, 4: 120, 5: 180, 6: 200 };
        const chargeLevel = batteryStatus <= 2 ? 2 : (batteryStatus === 3 ? 1 : 0);
        
        return {
            batPercentRemaining: percentMap[batteryStatus] ?? 0,
            batChargeLevel: chargeLevel,
            batChargeState: isCharging ? 1 : 2, // 1: Charging, 2: Discharging
            batPresent: true,
            status: 0,
        };
    }

    private mapZoneStatus(status: string): number {
        switch (status) {
            case 'idle':        return 0; // Pending
            case 'approaching': return 1; // Operating
            case 'started':     return 1; // Operating
            case 'finished':    return 2; // Finished
            default:            return 0;
        }
    }

    private mapOperationalState(): number {
        const status = this.appliance.state.fauxStatus;
        switch (status) {
            case RX9RobotStatus.Cleaning:
            case RX9RobotStatus.SpotCleaning:
                return 0x01; // Running
            case RX9RobotStatus.PausedCleaning:
            case RX9RobotStatus.PausedSpotCleaning:
            case RX9RobotStatus.PausedReturn:
            case RX9RobotStatus.PausedReturnForPitstop:
                return 0x02; // Paused
            case RX9RobotStatus.Return:
            case RX9RobotStatus.ReturnForPitstop:
                return 0x40; // SeekingCharger
            case RX9RobotStatus.Charging:
            case RX9RobotStatus.Pitstop:
                return 0x41; // Charging
            case RX9RobotStatus.Sleeping:
                return 0x42; // Docked
            case RX9RobotStatus.Error:
                return 0x03; // Error
            default:
                return 0x00; // Stopped
        }
    }

    private mapRunMode(): number { return this.isCleaning() ? 1 : 0; }

    private mapCleanMode(): number {
        const powerMode = this.appliance.state.powerMode;
        const powerModes: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
        return powerMode ? (powerModes[powerMode] ?? 1) : 1;
    }

    private isCleaning(): boolean {
        const status = this.appliance.state.fauxStatus;
        return [RX9RobotStatus.Cleaning, RX9RobotStatus.SpotCleaning, RX9RobotStatus.Return, RX9RobotStatus.ReturnForPitstop].includes(status);
    }
}
