# homebridge-aeg-robot-matter

Homebridge plugin for AEG RX9 / Electrolux Pure i9 robot vacuums.

This is an early Homebridge port of `matterbridge-aeg-robot-niklas`. The first working target is a HomeKit switch:

- switch on: start cleaning
- switch off: configurable `dock`, `pause`, or `stop`
- state follows whether the robot is actively cleaning

Matter RVC support is planned. For now, `exposeMode: "auto"` exposes the HomeKit switch even when Matter is enabled, so the plugin remains usable while the Matter accessory implementation is added.

## Configuration

```json
{
  "platform": "AEGRobotMatter",
  "name": "AEG Robot",
  "apiKey": "YOUR_ELECTROLUX_API_KEY",
  "accessToken": "",
  "refreshToken": "",
  "exposeMode": "auto",
  "switchOffAction": "dock",
  "pollIntervalSeconds": 30
}
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | required | Electrolux Group API key. |
| `accessToken` | `""` | Initial access token, if not using `accessTokenURL`. |
| `refreshToken` | `""` | Initial refresh token, if not using `accessTokenURL`. |
| `accessTokenURL` | unset | Optional URL returning token JSON for refresh/bootstrap. |
| `exposeMode` | `"auto"` | `auto`, `switch`, `matter-rvc`, or `both`. Matter RVC is not implemented yet. |
| `switchOffAction` | `"dock"` | Action when the HomeKit switch is turned off: `dock`, `pause`, or `stop`. |
| `pollIntervalSeconds` | `30` | Poll interval for Electrolux state. |
| `whiteList` | `[]` | Optional robot serial numbers to include. |
| `blackList` | `[]` | Optional robot serial numbers to exclude. |

## Development

```bash
npm install
npm run build
```
