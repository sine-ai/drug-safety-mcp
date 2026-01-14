# Drug Safety MCP Server

MCP server for FDA Adverse Event Reporting System (FAERS) data via the OpenFDA API. A complete pharmacovigilance toolkit for drug safety analysis.

## Features

- Search adverse event reports by drug, reaction, date range
- Get aggregated event counts grouped by reaction, outcome, demographics
- Compare safety profiles across multiple drugs
- Analyze serious events (deaths, hospitalizations, etc.)
- View reporting trends over time
- Find drugs associated with specific reactions
- Identify commonly co-reported drugs
- Get FDA drug label information (warnings, contraindications, boxed warnings)
- Search FDA drug recalls and enforcement actions
- Search by indication to compare drugs in the same therapeutic class
- Search by drug class (e.g., all TNF inhibitors, GLP-1 agonists)
- Compare label to FAERS reports - identify emerging safety signals
- **Pediatric safety analysis** with adult comparison
- **Geriatric safety analysis** with younger adult comparison
- **Executive safety summary** - quick due diligence
- **Pregnancy & lactation info** - critical for protocol exclusion criteria

## Installation

```bash
npm install drug-safety-mcp
```

Or clone and build from source:

```bash
git clone https://github.com/sine-ai/drug-safety-mcp.git
cd drug-safety-mcp
npm install
npm run build
```

## Configuration

### Claude Desktop / Claude.ai

Add to your Claude configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "drug-safety": {
      "command": "node",
      "args": ["/path/to/drug-safety-mcp/dist/index.js"],
      "env": {
        "OPENFDA_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Cursor IDE

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "drug-safety": {
      "command": "node",
      "args": ["/path/to/drug-safety-mcp/dist/index.js"],
      "env": {
        "OPENFDA_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Remote Mode (Streamable HTTP)

For remote/cloud deployments, the server supports Streamable HTTP transport:

```bash
# Start in remote mode
MCP_MODE=remote PORT=3000 npm start

# Or use the script
npm run start:remote
```

Connect to the remote server:
```json
{
  "mcpServers": {
    "drug-safety": {
      "url": "https://your-server.com/mcp"
    }
  }
}
```

**Endpoints:**
- `GET /health` - Health check
- `POST /mcp` - MCP Streamable HTTP endpoint

### OAuth 2.0 Authentication (via MCP Gateway)

Remote mode uses **MCP Gateway** for OAuth 2.0 authentication. Users sign in with their **Microsoft account**:
- ✅ Microsoft work/school accounts (Azure AD / Microsoft 365)
- ✅ Microsoft personal accounts (Outlook, Hotmail, Xbox, Skype)

#### How It Works

```
User → drug-safety-mcp → MCP Gateway → Azure AD → User signs in
                              ↓
                    Token returned to client
```

1. MCP client discovers OAuth endpoints via `/.well-known/oauth-authorization-server`
2. Client redirects user to MCP Gateway's authorization endpoint
3. User signs in with Microsoft account via Gateway
4. Gateway returns access token
5. Client uses token for MCP requests

#### Configuration

```bash
OAUTH_ENABLED=true
MCP_GATEWAY_URL=https://your-mcp-gateway.example.com
BASE_URL=https://your-server.com
```

**Security Notes:**
- Always use HTTPS in production
- Set `CORS_ORIGIN` to specific origins in production
- MCP Gateway handles Azure AD integration and token management

### Docker Deployment

Build and run with Docker:

```bash
# Build the image
docker build -t drug-safety-mcp .

# Run the container
docker run -p 3000:3000 -e OPENFDA_API_KEY=your_key drug-safety-mcp
```

Or with Docker Compose:

```yaml
version: '3.8'
services:
  drug-safety-mcp:
    build: .
    ports:
      - "3000:3000"
    environment:
      - MCP_MODE=remote
      - PORT=3000
      - OPENFDA_API_KEY=${OPENFDA_API_KEY:-}
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

Deploy to cloud platforms:
- **Azure Container Apps**: `az containerapp up --source .`
- **Google Cloud Run**: `gcloud run deploy --source .`
- **AWS App Runner**: Connect your GitHub repo

## OpenFDA API Key (Optional)

The OpenFDA API works without an API key, but with limits:
- **Without key (free mode):** 240 requests/min, 1,000 requests/day per IP
- **With key:** 240 requests/min, 120,000 requests/day per key

**To get a free API key:**
1. Go to https://open.fda.gov/apis/authentication/
2. Enter your email address
3. Check your email for the API key

## Example Prompts

Here are working examples that demonstrate core functionality:

### 1. Basic Drug Safety Search
```
What are the most common adverse events reported for Ozempic?
```
This uses `get_event_counts` to show top reactions grouped by frequency.

### 2. Safety Profile Comparison
```
Compare the safety profiles of Humira, Enbrel, and Remicade for rheumatoid arthritis treatment.
```
This uses `compare_safety_profiles` to show side-by-side adverse event data for TNF inhibitors.

### 3. Executive Safety Summary
```
Give me a quick safety summary for metformin including any recalls or boxed warnings.
```
This uses `get_safety_summary` to provide a comprehensive overview with total reports, top reactions, trends, recalls, and label warnings.

### 4. Pediatric Safety Analysis
```
What adverse events are reported for Adderall in children aged 6-12?
```
This uses `get_pediatric_safety` with age group filtering to show pediatric-specific safety data.

### 5. Signal Detection
```
Are there any adverse events being reported for Keytruda that aren't on the FDA label?
```
This uses `compare_label_to_reports` to identify potential emerging safety signals.

### 6. Drug Class Analysis
```
What are the common side effects across all GLP-1 receptor agonists?
```
This uses `search_by_drug_class` to analyze the entire drug class.

### 7. Pregnancy Safety
```
What is the pregnancy and lactation safety information for methotrexate?
```
This uses `get_pregnancy_lactation_info` to retrieve FDA label guidance for reproductive safety.

### 8. Serious Events Only
```
Show me only the fatal adverse events reported for warfarin.
```
This uses `get_serious_events` with outcome_type="death" to filter to the most serious outcomes.

## Available Tools (17 Total)

### Core Adverse Event Tools
| Tool | Description |
|------|-------------|
| `search_adverse_events` | Search AE reports by drug, reaction, date |
| `get_event_counts` | Aggregated counts by reaction, outcome, demographics |
| `compare_safety_profiles` | Compare AE profiles across 2-5 drugs |
| `get_serious_events` | Filter to serious outcomes only |
| `get_reporting_trends` | AE volume over time by year/quarter/month |
| `search_by_reaction` | Find drugs associated with a reaction |
| `get_concomitant_drugs` | Find commonly co-reported drugs |

### Drug Class & Indication Tools
| Tool | Description |
|------|-------------|
| `search_by_indication` | Find AEs for drugs used for a specific condition |
| `search_by_drug_class` | Search AEs across entire drug class (TNF inhibitors, SSRIs, etc.) |

### Signal Detection Tools
| Tool | Description |
|------|-------------|
| `compare_label_to_reports` | Compare FDA label to FAERS - identify emerging signals |
| `get_pediatric_safety` | Pediatric-specific safety with adult comparison |
| `get_geriatric_safety` | Geriatric-specific safety (65+) with younger adult comparison |

### Executive & Protocol Tools
| Tool | Description |
|------|-------------|
| `get_safety_summary` | Executive summary: counts, top reactions, trends, recalls, warnings |
| `get_pregnancy_lactation_info` | Pregnancy/lactation info for protocol exclusion criteria |

### Drug Information Tools
| Tool | Description |
|------|-------------|
| `get_drug_label_info` | FDA drug label (warnings, contraindications, boxed warnings) |
| `get_recall_info` | FDA drug recalls and enforcement actions |
| `get_data_info` | Database info and limitations |

## User Personas

| User | Primary Tools |
|------|---------------|
| **Medical Monitor** | search_adverse_events, compare_safety_profiles, get_pediatric_safety, get_geriatric_safety |
| **Protocol Writer** | search_by_drug_class, get_drug_label_info, get_pregnancy_lactation_info, get_pediatric_safety |
| **Pharmacovigilance** | compare_label_to_reports, get_reporting_trends, get_serious_events, get_safety_summary |
| **Regulatory Affairs** | compare_label_to_reports, get_drug_label_info, get_recall_info, get_pregnancy_lactation_info |
| **BD / Competitive Intel** | compare_safety_profiles, search_by_drug_class, get_recall_info, get_safety_summary |
| **Medical Affairs** | get_event_counts, get_drug_label_info, search_by_reaction, get_safety_summary |

## Data Limitations

**IMPORTANT:** FAERS data has significant limitations:

- A report does **NOT** prove the drug caused the event
- Voluntary reporting means many events go unreported
- Cannot calculate incidence rates (no denominator)
- Reporting influenced by publicity and time on market
- Duplicate and incomplete reports exist

This data should be used for signal detection and hypothesis generation, not as the sole basis for clinical decisions.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_MODE` | `local` | `local` (stdio) or `remote` (Streamable HTTP) |
| `PORT` | `3000` | HTTP port for remote mode |
| `BASE_URL` | - | Server's public URL (required for remote mode) |
| `OPENFDA_API_KEY` | - | OpenFDA API key (optional, uses free tier if not set) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `OAUTH_ENABLED` | `false` | Enable OAuth 2.0 authentication for remote mode |
| `MCP_GATEWAY_URL` | - | MCP Gateway URL for OAuth (handles Azure AD) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin (set specific origin in production) |

## Privacy & Data

This MCP server:
- **Does not collect** any user data or conversation history
- **Only queries** public FDA databases via the OpenFDA API
- **Does not store** any data locally beyond runtime caching
- **Does not transmit** data to any third parties other than OpenFDA

All tools are read-only and query publicly available FDA safety data.

For details on how OpenFDA handles data, see: https://open.fda.gov/apis/

## Security

For security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## Support & Contact

**Developer**: SineAI

For issues, questions, or security concerns:
- **GitHub Issues**: https://github.com/sine-ai/drug-safety-mcp/issues
- **Security Issues**: security@sineai.com
- **General Inquiries**: mcp-support@sineai.com

## Troubleshooting

### Common Issues

**"No results found" errors**
- Check drug name spelling
- Try brand name instead of generic (or vice versa)
- Use simpler search terms

**Rate limit errors**
- Set `OPENFDA_API_KEY` environment variable for higher limits
- Get a free key at https://open.fda.gov/apis/authentication/

**Connection errors in remote mode**
- Verify `PORT` is not in use
- Check firewall settings
- Ensure the server is accessible from the client

## License

MIT License - see [LICENSE](LICENSE) file.

## Author

**SineAI**  
https://sineai.co

---

*This software is not affiliated with, endorsed by, or sponsored by Anthropic, PBC or the U.S. Food and Drug Administration. "Claude" and "Anthropic" are trademarks of Anthropic, PBC.*
