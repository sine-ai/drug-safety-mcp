# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Email**: Send details to security@sineai.com
2. **GitHub**: Open a private security advisory at https://github.com/sine-ai/drug-safety-mcp/security/advisories/new

### What to Include

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Any suggested fixes (optional)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 5 business days
- **Resolution Target**: Within 30 days for critical issues

### What to Expect

1. We will acknowledge receipt of your report
2. We will investigate and validate the issue
3. We will work on a fix and coordinate disclosure
4. We will credit you in the security advisory (unless you prefer anonymity)

### Scope

This security policy covers:
- The drug-safety-mcp server code
- Dependencies used by the server
- Configuration and deployment guidance

### Out of Scope

- The OpenFDA API (report to FDA)
- Third-party services or infrastructure
- Social engineering attacks

## Security Best Practices

When deploying this MCP server:

1. **API Keys**: Store `OPENFDA_API_KEY` securely, never commit to version control
2. **Network**: In remote mode, deploy behind HTTPS with valid certificates
3. **Access**: Limit access to the MCP endpoint to authorized clients only
4. **Updates**: Keep dependencies updated with `npm audit` and `npm update`

## Disclosure Policy

We follow responsible disclosure practices:
- We will not take legal action against security researchers acting in good faith
- We ask that you give us reasonable time to address issues before public disclosure
- We will publicly acknowledge your contribution (with your permission)
