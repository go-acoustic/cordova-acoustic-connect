# Acoustic Connect - Cordova Plugin

Cordova plugin for integrating [Acoustic Connect](https://acoustic.com/connect/) into hybrid mobile applications.

## About

`cordova-acoustic-connect` exposes the Acoustic Connect SDK capabilities (CDP + engagement) to Cordova-based mobile apps. The plugin wraps the native iOS and Android Connect SDKs and surfaces a unified JavaScript API.

## Repository structure

```
.
├── applications/Demo/    Sample Cordova app that consumes the plugin
├── plugins/              Cordova plugins (push, etc.) with native iOS + Android sources
├── docs/                 Project documentation
├── Jenkinsfile           CI pipeline
└── .github/workflows/    GitHub Actions (npm publish on release)
```

## How to use

Install the plugin into your Cordova app:

```sh
cordova plugin add cordova-acoustic-connect
```

Plugin configuration and platform-specific setup are documented in [/docs/local-setup.md](/docs/local-setup.md).

## Building the demo app

The demo app lives at [`applications/Demo`](applications/Demo). From the repo root:

```sh
cd applications/Demo
npm install
cordova platform add android
cordova platform add ios
cordova build android
cordova build ios
```

See [`applications/Demo/README.md`](applications/Demo) for additional run instructions.

## License

Licensed under the Acoustic License for Non-Warranted Programs. See [LICENSE](LICENSE) for full terms.
