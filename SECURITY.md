# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | ✅ Active support  |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email the maintainer directly or use GitHub's [private vulnerability reporting](https://github.com/tbaur/homebridge-concert/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

## Security Measures

This plugin implements:

- **LAN-only control** - The plugin opens short-lived TCP connections only to the host/port you configure; it does not call any cloud API
- **No credential storage** - There are no passwords, tokens, or API keys to store or refresh
- **Input validation** - Configuration is validated at startup against an allowlist. Missing/invalid `host` or `accessories` is fatal (the plugin does not start; cached accessories stay registered and report "No Response"). Invalid accessory entries (type, name, zone, volume, source) and duplicate accessory identities are fatal. Out-of-range `port` and `refreshRate` values produce a warning and fall back to a safe default or clamp
- **Log injection resistance** - Config and accessory-cache values echoed into log messages have control characters replaced and are length-limited, and `name`/`model` containing control characters are rejected outright, so neither a `config.json` value nor a tampered accessory cache can forge log lines attributed to other components
- **Request timeouts** - Connect and command waits are bounded so a stalled receiver cannot hang the event loop
- **Response size cap** - TCP response buffers are capped to avoid unbounded memory growth from a misbehaving peer
- **Wire data is never trusted** - Response frames are bounds-checked before every read, answer codes are looked up through a `Map` rather than a plain object, and unknown or out-of-range payloads raise a typed `ProtocolError`
- **Dependency auditing** - The Tests workflow runs `npm audit --omit=dev --audit-level=moderate` and fails on any runtime advisory (trivially clean, since there are none, and it must stay that way), and reports development dependency advisories without failing. Tests is not a required status check, so the audit is advisory at merge time. OSV-Scanner covers the full tree on pull requests, merge groups, pushes to `main`, and a weekly schedule
- **Pinned supply chain** - GitHub Actions and reusable workflows are pinned to commit SHAs, the npm CLI used by the publish job (which holds OIDC publish authority) is pinned to an explicit version, and that job installs with `--ignore-scripts` so no dependency install script runs where publishing credentials are available

## Best Practices for Users

1. Prefer a static IP / DHCP reservation for the receiver so the configured host does not drift
2. Keep Homebridge and this plugin updated
3. Run Homebridge with minimal system privileges
4. Use Homebridge's secure remote access features rather than exposing it directly to the internet
5. Remember that anyone on your LAN who can reach TCP port 50000 can send the same automation commands (power, volume, and anything else the protocol accepts)
6. Choose volume-preset levels carefully — turning a preset On sets an absolute level on the receiver

## Configuration Handling

- `host`, `port`, `accessories`, and related options are read from the Homebridge platform config. Homebridge stores this config in plain text on the host, so host hardening is the primary mitigation.
- No credentials or personally identifying information are written to logs. Debug logs may include hex dumps of automation frames (power, volume, and source query and set), which contain no secrets.

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release
