# SEC EDGAR Filing Fee Disclosure MCP Server

**MCP server for SEC EDGAR Exhibit 107 filing fee disclosure analysis.**

Parses ffd: XBRL from registration statements (S-1, S-3, 424B, F-1, etc.) and returns structured fee data through the Model Context Protocol. No API keys required — SEC EDGAR is a free, public API.

7 Tools &bull; 2 Resources &bull; 1 Prompt &bull; STDIO & Streamable HTTP

---

## Tools

| Tool | Description |
|:-----|:------------|
| `get_fee_exhibit` | Fetch and parse a specific Exhibit 107 by accession number + CIK. Returns every security class, fee amounts, fee rate, and net fee due. |
| `search_fee_filings` | Find a company's recent registration filings that contain Exhibit 107 fee disclosures. Resolves tickers, names, or CIKs automatically. |
| `get_company_fee_history` | Fetch and parse all Exhibit 107 fee exhibits for a company in one call. Returns per-filing fee tables plus grand totals. |
| `compare_fee_rates` | Compare filing fee data across 2-8 companies side by side — latest form, total offering, net fee due, and fee rate. |
| `search_filings_by_fee` | Full-text search across all EDGAR filings since 1993, scoped to registration statements. Supports phrases, boolean operators, and wildcards. |
| `get_ffd_concepts_by_company` | Get a company's complete ffd: filing fee history by merging the EDGAR companyfacts API (fast, no lag — covers 424B/S-3/S-8) with Exhibit 107 document parsing (covers S-1/F-1 filings that companyfacts doesn't index). |
| `export_fee_data` | Query fee data and save as CSV. Three modes: `fee_history` (one row per filing), `line_items` (one row per security class), `ffd_concepts` (one row per XBRL fact). |

### `get_fee_exhibit`

Parse a specific Exhibit 107 (EX-FILING FEES) from an SEC filing.

- Requires `accession_number` and `cik`
- Optionally provide the `exhibit_filename` for faster parsing, or let the server auto-detect it from the filing index
- Returns all ffd: XBRL concepts: every security class, max aggregate offering, fee amounts, fee rate, and net fee due
- Includes retry logic for filings within the 24-48h EDGAR indexing lag window

### `search_fee_filings`

Find a company's recent registration statement filings.

- Accepts ticker symbols (`RDDT`), company names (`Reddit`), or CIK numbers
- Defaults to all registration forms: S-1, S-3, S-4, F-1, F-3, F-4, F-6, 424B series, SC TO, PREM14A, DEFM14A, POS AM, S-8
- Returns accession numbers, form types, filing dates, and EDGAR URLs
- Surfaces a recency warning when results fall within the EDGAR indexing lag window

### `get_company_fee_history`

Batch-parse all fee exhibits for a company across multiple filings.

- Parses up to 10 filings in a single call (configurable via `limit`)
- Returns the full structured fee table for each filing plus grand totals
- Filterable by form type and start date

### `compare_fee_rates`

Side-by-side comparison of fee data for 2-8 companies.

- Shows the latest registration form, total offering, net fee due, and fee rate for each company
- Useful for benchmarking offering sizes across a peer set

### `search_filings_by_fee`

Full-text search across all EDGAR filing documents, scoped to registration statements.

- Find companies that registered a specific security type, used a specific fee rule (e.g. Rule 457(o)), or mentioned specific terms
- Supports exact phrases, boolean operators (AND/OR/NOT), and wildcards

### `get_ffd_concepts_by_company`

Complete fee history from two complementary data sources:

- **Phase 1 — companyfacts API** (fast, no indexing lag): Returns ffd: XBRL facts for 424B prospectus supplements, S-3/A, and S-8 employee plans
- **Phase 2 — Exhibit 107 parsing** (backfills the gap): Scans submissions for S-1/F-1 filings that the companyfacts API doesn't index, then fetches and parses each Exhibit 107
- Every entry is tagged with `source: "companyfacts"` or `source: "exhibit107"`
- Optionally filter by specific ffd concepts (`FeeAmt`, `NetFeeAmt`, etc.) or form types

### `export_fee_data`

Query SEC fee data and save the results as a CSV file.

- **`fee_history` mode** — one row per filing with summary totals: accession number, form type, filing date, total offering, total fee, net fee due, fee rate, security class count
- **`line_items` mode** — one row per security class across all filings: security type, class title, fee calculation rule, amount registered, price per unit, max aggregate offering, fee rate, fee amount
- **`ffd_concepts` mode** — one row per ffd: XBRL fact entry from the hybrid companyfacts + Exhibit 107 source: concept tag, label, value, unit, form, filing date, accession, source tag
- Writes to `output_path` if provided, otherwise defaults to `./<TICKER>_<mode>.csv`
- Filterable by form type and max filing count

**Example prompts:**

> "Export Tesla's filing fee history as a CSV"

> "Save Goldman Sachs' complete ffd data to C:\Users\me\Desktop\GS_fees.csv"

> "Export the line-item breakdown for all of Reddit's S-1 filings"

**CSV columns by mode:**

| Mode | Columns |
|:-----|:--------|
| `fee_history` | `accession_number`, `form_type`, `filing_date`, `entity_name`, `cik`, `exhibit_url`, `submission_type`, `total_offering`, `total_fee`, `previously_paid`, `fee_offset`, `net_fee_due`, `fee_rate`, `security_classes` |
| `line_items` | `accession_number`, `form_type`, `filing_date`, `entity_name`, `row_num`, `security_type`, `class_title`, `fee_calc_rule`, `amount_registered`, `price_per_unit`, `max_aggregate_offering`, `fee_rate`, `fee_amount`, `previously_paid` |
| `ffd_concepts` | `concept`, `label`, `value`, `unit`, `form`, `filed`, `accession`, `period_end`, `period_start`, `fiscal_year`, `fiscal_period`, `source` |

## Resources

| URI | Description |
|:----|:------------|
| `ffd://fee-taxonomy` | Complete ffd: XBRL concept reference for Exhibit 107 — per-row and summary-level concepts, fee calculation rules, and historical SEC fee rates |
| `ffd://form-types` | Registration form types that require Exhibit 107 — S-1, S-3, F-1, 424B series, merger proxies, with key dates |

## Prompts

| Prompt | Description |
|:-------|:------------|
| `fee_disclosure_analysis` | Guides structured analysis of a company's Exhibit 107 fee disclosures — identify the filing, parse the fee table, analyze the fee structure, and summarize |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher

### Install from source

```sh
git clone https://github.com/davidtauriello/ffd-mcp.git
cd ffd-mcp
npm install
npm run build
```

### Run locally (stdio)

```sh
EDGAR_USER_AGENT="YourApp you@email.com" npm start
```

### Run locally (HTTP)

```sh
EDGAR_USER_AGENT="YourApp you@email.com" MCP_TRANSPORT_TYPE=http npm start
# Server listens at http://localhost:3010/mcp
# Health check at http://localhost:3010/health
```

## Client configuration

### Claude Desktop (stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filing-fee-mcp": {
      "command": "node",
      "args": ["/path/to/ffd-mcp/dist/index.js"],
      "env": {
        "EDGAR_USER_AGENT": "YourApp you@email.com"
      }
    }
  }
}
```

### Claude Code

```sh
claude mcp add filing-fee-mcp -- node /path/to/ffd-mcp/dist/index.js
```

### Microsoft Copilot

Add to `mcp.json`:

```json
{
	"servers": {
		"Filing Fee MCP": {
			"type": "stdio",
			"command": "node",
			"args": [
				"/path/to/ffd-mcp/dist/index.js"],
			"env": {"EDGAR_USER_AGENT" : "YourApp you@email.com"}
		}
	},
	"inputs": []
}
```

Set `EDGAR_USER_AGENT` in your environment.

### Any MCP client (Streamable HTTP)

Point any client that supports Streamable HTTP at `http://your-server:3010/mcp`.

## Docker

### Build and run

```sh
docker build -t filing-fee-mcp .

docker run -d -p 3010:3010 -e EDGAR_USER_AGENT="YourApp you@email.com" filing-fee-mcp
```

The container defaults to HTTP transport on port 3010. Override the port with `-e MCP_HTTP_PORT=8080 -p 8080:8080`.

### CSV export from Docker

The `export_fee_data` tool writes CSV files inside the container. Mount a volume to make them accessible on the host:

```sh
docker run -d -p 3010:3010 -e EDGAR_USER_AGENT="YourApp you@email.com" -v $(pwd)/exports:/app/exports filing-fee-mcp
```

Then use `output_path: "/app/exports/GS_fees.csv"` and the file appears in `./exports/` on the host.

### Health check

```sh
curl http://localhost:3010/health
# {"status":"ok","server":"filing-fee-mcp-server","version":"1.0.0"}
```

## Configuration

| Variable | Required | Default | Description |
|:---------|:---------|:--------|:------------|
| `EDGAR_USER_AGENT` | **Yes** | — | User-Agent header for SEC compliance. Format: `"AppName contact@email.com"`. The SEC blocks requests without a valid User-Agent. |
| `EDGAR_RATE_LIMIT_RPS` | No | `10` | Max requests/second to SEC APIs. Do not exceed 10. |
| `EDGAR_TICKER_CACHE_TTL` | No | `3600` | Seconds to cache the company tickers lookup file. |
| `MCP_TRANSPORT_TYPE` | No | `stdio` | Transport mode: `stdio` or `http`. |
| `MCP_HTTP_PORT` | No | `3010` | HTTP server port (only used when transport is `http`). |

## Project structure

```
src/
  index.ts                                  # Server entry point (McpServer + transport)
  config/
    server-config.ts                        # Environment variable parsing (Zod)
  services/edgar/
    edgar-client.ts                         # Rate-limited SEC EDGAR HTTP client
    fee-exhibit-parser.ts                   # Exhibit 107 iXBRL/HTML parser
    fee-exhibit-service.ts                  # Orchestrates client + parser
    types.ts                                # Domain types
  mcp-server/
    tools/definitions/
      get-fee-exhibit.ts                    # Parse a specific Exhibit 107
      search-fee-filings.ts                 # Find registration filings
      get-company-fee-history.ts            # Batch-parse fee exhibits
      compare-fee-rates.ts                  # Cross-company comparison
      search-filings-by-fee.ts              # Full-text search
      get-ffd-concepts-by-company.ts        # Hybrid companyfacts + parsing
      export-fee-data.ts                    # CSV export
    resources/definitions/
      fee-taxonomy.ts                       # ffd: XBRL concept reference
      form-types.ts                         # Registration form types
    prompts/definitions/
      fee-disclosure-analysis.ts            # Guided analysis prompt
```

## How it works

### Exhibit 107

Since February 2022, the SEC requires all registration statement filers to include Exhibit 107 (EX-FILING FEES) — a machine-readable inline XBRL document disclosing every security class, offering amount, fee calculation rule, fee rate, and net fee due.

This server parses those exhibits using regex-based extraction of ffd: namespace XBRL facts from the iXBRL HTML. It handles both inline XBRL (`<ix:nonNumeric>`, `<ix:nonFraction>`) and standalone XML (`<ffd:Tag>`) formats, with a fallback HTML table parser for non-XBRL exhibits.

### EDGAR indexing lag

EDGAR's submissions API lists new filings immediately, but the per-document index and full-text search can lag 24-48 hours behind acceptance. This server handles the gap with:

- **Retry logic**: When a document index returns empty for a filing within the 48h window, retries up to 3 times with increasing delays
- **Recency warnings**: Tools surface an advisory when results touch the lag window
- **Companyfacts fast path**: The `get_ffd_concepts_by_company` tool reads from the companyfacts API (no lag) for 424B/S-3/S-8 filings, falling back to document parsing only for S-1/F-1 filings

## License

Apache 2.0. See [LICENSE](./LICENSE).
