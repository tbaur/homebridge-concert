# Changelog

All notable changes to this project are documented in this file. This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) based on [Conventional Commits](https://www.conventionalcommits.org).

## [1.0.2](https://github.com/tbaur/homebridge-concert/compare/v1.0.1...v1.0.2) (2026-08-05)


### Bug Fixes

* correct hardware verification claims for volume and source ([071c00b](https://github.com/tbaur/homebridge-concert/commit/071c00bb71120e4f0ad1198dbd90ad5f25bdd01e))

## [1.0.1](https://github.com/tbaur/homebridge-concert/compare/v1.0.0...v1.0.1) (2026-08-05)


### Bug Fixes

* publish supports-hap keyword for Homebridge UI ([9f2124b](https://github.com/tbaur/homebridge-concert/commit/9f2124beb7d78a7bc1990a209ef9e44863969b18))

## [1.0.0](https://github.com/tbaur/homebridge-concert/compare/v0.2.1...v1.0.0) (2026-08-05)


### Miscellaneous Chores

* release 1.0.0 ([a50e219](https://github.com/tbaur/homebridge-concert/commit/a50e2193bb791211b98675bedd9e1ded26dcde92))

## [0.2.1](https://github.com/tbaur/homebridge-concert/compare/v0.2.0...v0.2.1) (2026-08-05)


### Bug Fixes

* stop re-announcing accessory adoption on every restart ([744974e](https://github.com/tbaur/homebridge-concert/commit/744974ef06c9a5ae78f50c1ea95f55729310d53a))

## [0.2.0](https://github.com/tbaur/homebridge-concert/compare/v0.1.11...v0.2.0) (2026-08-05)


### ⚠ BREAKING CHANGES

* Config validation is stricter, so a configuration that previously started may now be rejected: `model` must be a string without control characters, and `accessories[].name` is limited to 64 characters. Switch behaviour also changes visibly — volume and source presets now report Off while the zone is in standby, a switch reports "No Response" until its state has been read and again after repeated poll failures, and a set is acknowledged to HomeKit before a slow wake finishes. Existing accessories are adopted across the identity change, so no re-pairing is required.

### Features

* harden state handling, HomeKit write timing, and supply chain ([87b9cbb](https://github.com/tbaur/homebridge-concert/commit/87b9cbb717c5fca60bf35f1414920f903bac2db1))

## [0.1.11](https://github.com/tbaur/homebridge-concert/compare/v0.1.10...v0.1.11) (2026-08-04)


### Bug Fixes

* log source presets with front-panel labels ([#23](https://github.com/tbaur/homebridge-concert/issues/23)) ([06ff1cb](https://github.com/tbaur/homebridge-concert/commit/06ff1cb4d573b1a6ad19fad36fbae15c6fb2a435))

## [0.1.10](https://github.com/tbaur/homebridge-concert/compare/v0.1.9...v0.1.10) (2026-08-04)


### Features

* add source/input preset HomeKit switches ([#21](https://github.com/tbaur/homebridge-concert/issues/21)) ([23713db](https://github.com/tbaur/homebridge-concert/commit/23713db117fd64fd9cfc7bd0ef8481714296264f))

## [0.1.9](https://github.com/tbaur/homebridge-concert/compare/v0.1.8...v0.1.9) (2026-08-03)


### Bug Fixes

* harden standby polling against XR timeouts ([#19](https://github.com/tbaur/homebridge-concert/issues/19)) ([6a6d9ac](https://github.com/tbaur/homebridge-concert/commit/6a6d9ac488fe316f9ad13204281ea08ac061ec5d))

## [0.1.8](https://github.com/tbaur/homebridge-concert/compare/v0.1.7...v0.1.8) (2026-08-02)


### Features

* retry volume preset set while receiver wakes ([#17](https://github.com/tbaur/homebridge-concert/issues/17)) ([47a894e](https://github.com/tbaur/homebridge-concert/commit/47a894ebe8cfeff8f7fee54175200f01d730ff48))

## [0.1.7](https://github.com/tbaur/homebridge-concert/compare/v0.1.6...v0.1.7) (2026-08-02)


### Bug Fixes

* coalesce repeated volume-preset On writes ([#15](https://github.com/tbaur/homebridge-concert/issues/15)) ([04ef74b](https://github.com/tbaur/homebridge-concert/commit/04ef74b6e415915fae5c45ce078dadc4408b45d3))

## [0.1.6](https://github.com/tbaur/homebridge-concert/compare/v0.1.5...v0.1.6) (2026-08-02)


### Bug Fixes

* repair accessories form binding and clarify logs ([#13](https://github.com/tbaur/homebridge-concert/issues/13)) ([b2fe8d8](https://github.com/tbaur/homebridge-concert/commit/b2fe8d8678660bf8109619069658cd91c9ef6b9c))

## [0.1.5](https://github.com/tbaur/homebridge-concert/compare/v0.1.4...v0.1.5) (2026-08-02)


### Features

* add multi-accessory volume presets ([#11](https://github.com/tbaur/homebridge-concert/issues/11)) ([406d187](https://github.com/tbaur/homebridge-concert/commit/406d1874ea8919f2d15c0c5f5e2b8b5e1dab37d8))

## [0.1.4](https://github.com/tbaur/homebridge-concert/compare/v0.1.3...v0.1.4) (2026-08-01)


### Bug Fixes

* stop labeling HomeKit power sets as external ([#9](https://github.com/tbaur/homebridge-concert/issues/9)) ([83ebacb](https://github.com/tbaur/homebridge-concert/commit/83ebacb5b011e93e45d4a908af1023d97ba84352))

## [0.1.3](https://github.com/tbaur/homebridge-concert/compare/v0.1.2...v0.1.3) (2026-08-01)


### Bug Fixes

* retry silent power queries and shorten poll logs ([#7](https://github.com/tbaur/homebridge-concert/issues/7)) ([ca23016](https://github.com/tbaur/homebridge-concert/commit/ca230160d1d32dccf37d2a05bfac39c8c79d428a))

## [0.1.2](https://github.com/tbaur/homebridge-concert/compare/v0.1.1...v0.1.2) (2026-08-01)


### Bug Fixes

* verify power after missing ack and polish config/logs ([#5](https://github.com/tbaur/homebridge-concert/issues/5)) ([b698706](https://github.com/tbaur/homebridge-concert/commit/b6987066ff8663e4b6c58f25672d83e66fbb133c))

## [0.1.1](https://github.com/tbaur/homebridge-concert/compare/v0.1.0...v0.1.1) (2026-08-01)


### Bug Fixes

* use RC5 discrete power on/off for X/XR control ([#3](https://github.com/tbaur/homebridge-concert/issues/3)) ([36cf150](https://github.com/tbaur/homebridge-concert/commit/36cf150ee97fd3702b8f11938593f10e3ed45406))

## [0.1.0](https://github.com/tbaur/homebridge-concert/releases/tag/v0.1.0) (2026-08-01)

### Features

* initial AudioControl Concert XR power-control plugin
