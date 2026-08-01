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
- **Input validation** - Configuration is validated at startup. A missing or invalid `host` is fatal (the plugin does not start and clears cached accessories). Out-of-range `port`, `zone`, and `refreshRate` values produce a warning and fall back to a safe default or clamp
- **Request timeouts** - Connect and command waits are bounded so a stalled receiver cannot hang the event loop
- **Response size cap** - TCP response buffers are capped to avoid unbounded memory growth from a misbehaving peer
- **Dependency auditing** - `npm audit` runs in CI on every push and pull request

## Best Practices for Users

1. Prefer a static IP / DHCP reservation for the receiver so the configured host does not drift
2. Keep Homebridge and this plugin updated
3. Run Homebridge with minimal system privileges
4. Use Homebridge's secure remote access features rather than exposing it directly to the internet
5. Remember that anyone on your LAN who can reach TCP port 50000 can send the same power commands

## Configuration Handling

- `host`, `port`, and related options are read from the Homebridge platform config. Homebridge stores this config in plain text on the host, so host hardening is the primary mitigation.
- No credentials or personally identifying information are written to logs. Debug logs may include hex dumps of automation frames (power on/off/query), which contain no secrets.

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release
