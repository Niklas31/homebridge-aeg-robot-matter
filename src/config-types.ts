export type DebugFeatures =
      'Run API Tests'
    | 'Run Unsafe API Tests'
    | 'Log API Headers'
    | 'Log API Bodies'
    | 'Log Appliance IDs'
    | 'Log Endpoint Debug'
    | 'Log Debug as Info';

export type LogMapStyle =
    'Off'
  | 'Monospaced'
  | 'Matterbridge';

export type ExposeMode =
    'auto'
  | 'switch'
  | 'matter-rvc'
  | 'both';

export type SwitchOffAction =
    'pause'
  | 'stop'
  | 'dock';

export interface Config {
    platform:                string;
    name:                    string;
    whiteList:               string[];
    blackList:               string[];
    apiKey:                  string;
    accessToken:             string;
    accessTokenURL?:         string;
    refreshToken:            string;
    pollIntervalSeconds:     number;
    exposeMode:              ExposeMode;
    switchOffAction:         SwitchOffAction;
    logMapStyle:             LogMapStyle;
    debug:                   boolean;
    debugFeatures:           DebugFeatures[];
}
