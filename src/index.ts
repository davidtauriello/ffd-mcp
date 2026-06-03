#!/usr/bin/env node
/**
 * @fileoverview Filing Fee MCP Server entry point.
 * Registers 7 tools, 2 resources, and 1 prompt for SEC Exhibit 107 fee disclosure analysis.
 * Supports stdio (default) and HTTP transports.
 * @module index
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config/server-config.js";
import { EdgarClient } from "./services/edgar/edgar-client.js";

// Tools
import { getFeeExhibitSchema, handleGetFeeExhibit } from "./mcp-server/tools/definitions/get-fee-exhibit.js";
import { searchFeeFilingsSchema, handleSearchFeeFilings } from "./mcp-server/tools/definitions/search-fee-filings.js";
import { getCompanyFeeHistorySchema, handleGetCompanyFeeHistory } from "./mcp-server/tools/definitions/get-company-fee-history.js";
import { compareFeeRatesSchema, handleCompareFeeRates } from "./mcp-server/tools/definitions/compare-fee-rates.js";
import { searchFilingsByFeeSchema, handleSearchFilingsByFee } from "./mcp-server/tools/definitions/search-filings-by-fee.js";
import { getFfdConceptsByCompanySchema, handleGetFfdConceptsByCompany } from "./mcp-server/tools/definitions/get-ffd-concepts-by-company.js";
import { exportFeeDataSchema, handleExportFeeData } from "./mcp-server/tools/definitions/export-fee-data.js";

// Resources
import { FEE_TAXONOMY_URI, getFeeeTaxonomyResource } from "./mcp-server/resources/definitions/fee-taxonomy.js";
import { FORM_TYPES_URI, getFormTypesResource } from "./mcp-server/resources/definitions/form-types.js";

// Prompts
import { FEE_DISCLOSURE_PROMPT_NAME, FEE_DISCLOSURE_PROMPT_DESCRIPTION, getFeeDisclosurePrompt } from "./mcp-server/prompts/definitions/fee-disclosure-analysis.js";

async function main() {
  const config = loadConfig();
  const client = new EdgarClient(config);

  const server = new McpServer({
    name: "filing-fee-mcp-server",
    version: "1.0.0",
  });

  // ─── Tools ──────────────────────────────────────────────────────────────────

  server.tool(
    "get_fee_exhibit",
    "Fetch and parse a specific Exhibit 107 (EX-FILING FEES) from an SEC filing. " +
    "Returns all ffd: XBRL concepts: every security class, max aggregate offering, " +
    "fee amounts, fee rate, and net fee due. Requires accession_number + cik. " +
    "Provide the exhibit document filename for faster parsing, or let the server auto-detect it.",
    getFeeExhibitSchema.shape,
    async (input) => {
      const result = await handleGetFeeExhibit(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as unknown as Record<string, unknown> };
    }
  );

  server.tool(
    "search_fee_filings",
    "Find a company's recent registration statement filings that contain Exhibit 107 fee disclosures. " +
    "Returns accession numbers, form types, filing dates, and EDGAR URLs. " +
    "Use the results to call get_fee_exhibit for full fee table parsing. " +
    "Resolves tickers, company names, or CIK numbers automatically.",
    searchFeeFilingsSchema.shape,
    async (input) => {
      const result = await handleSearchFeeFilings(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as Record<string, unknown> };
    }
  );

  server.tool(
    "get_company_fee_history",
    "Fetch and parse all Exhibit 107 fee exhibits for a company across multiple filings in one call. " +
    "Returns the full structured fee table for each filing plus grand totals. " +
    "Best for understanding a company's full offering history and total fees paid. " +
    "Slower than get_fee_exhibit since it fetches and parses multiple documents.",
    getCompanyFeeHistorySchema.shape,
    async (input) => {
      const result = await handleGetCompanyFeeHistory(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as Record<string, unknown> };
    }
  );

  server.tool(
    "compare_fee_rates",
    "Compare Exhibit 107 filing fee data across 2-8 companies side by side. " +
    "Shows the latest registration form, total offering, net fee due, and fee rate for each company. " +
    "Note: SEC fee rates are uniform — differences reflect rounding or alternate calculation rules.",
    compareFeeRatesSchema.shape,
    async (input) => {
      const result = await handleCompareFeeRates(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as Record<string, unknown> };
    }
  );

  server.tool(
    "search_filings_by_fee",
    "Full-text search across all EDGAR filing documents since 1993, scoped to registration statements. " +
    "Use to find all companies that registered a specific security type, used a specific rule (e.g. 457(o)), " +
    "or mention specific terms in their fee exhibits. Supports phrases, boolean operators, and wildcards.",
    searchFilingsByFeeSchema.shape,
    async (input) => {
      const result = await handleSearchFilingsByFee(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as Record<string, unknown> };
    }
  );

  server.tool(
    "get_ffd_concepts_by_company",
    "Get a company's complete ffd: filing fee history by merging two sources: " +
    "(1) the EDGAR companyfacts API for 424B/S-3/S-8 filings (fast, no lag), and " +
    "(2) Exhibit 107 document parsing for S-1/F-1 filings that companyfacts doesn't index. " +
    "Returns all fee-related facts (FeeAmt, NetFeeAmt, TtlOfferingAmt, FeeRate, etc.) " +
    "across every form type. Each entry is tagged with its source. " +
    "Use get_fee_exhibit when you need the full per-security-class line-item breakdown for a single filing.",
    getFfdConceptsByCompanySchema.shape,
    async (input) => {
      const result = await handleGetFfdConceptsByCompany(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as Record<string, unknown> };
    }
  );

  server.tool(
    "export_fee_data",
    "Query SEC fee data and save it as a CSV file. Three modes: " +
    '"fee_history" (one row per filing with summary totals), ' +
    '"line_items" (one row per security class across all filings), ' +
    '"ffd_concepts" (one row per ffd: XBRL fact from companyfacts + parsed exhibits). ' +
    "Writes to the specified output_path or defaults to ./<TICKER>_<mode>.csv. " +
    "The CSV text is also returned in structuredContent.csvText so callers can " +
    "reconstruct the file locally without depending on the server's filesystem.",
    exportFeeDataSchema.shape,
    async (input) => {
      const result = await handleExportFeeData(input as any, client);
      return { content: result.content, structuredContent: result.structuredContent as unknown as Record<string, unknown> };
    }
  );

  // ─── Resources ──────────────────────────────────────────────────────────────

  server.resource(
    "fee-taxonomy",
    FEE_TAXONOMY_URI,
    {
      description: "Complete ffd: XBRL concept reference for Exhibit 107. Covers all per-row and summary-level concepts, fee calculation rules, and historical SEC fee rates.",
      mimeType: "text/markdown",
    },
    async () => {
      const r = getFeeeTaxonomyResource();
      return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] };
    }
  );

  server.resource(
    "form-types",
    FORM_TYPES_URI,
    {
      description: "Registration form types that require Exhibit 107, including S-1, S-3, F-1, 424B series, and merger proxy forms with key dates.",
      mimeType: "text/markdown",
    },
    async () => {
      const r = getFormTypesResource();
      return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] };
    }
  );

  // ─── Prompts ─────────────────────────────────────────────────────────────────

  server.prompt(
    FEE_DISCLOSURE_PROMPT_NAME,
    FEE_DISCLOSURE_PROMPT_DESCRIPTION,
    {
      company: z.string().optional().describe("Company ticker, name, or CIK to analyze"),
      accession: z.string().optional().describe("Specific accession number if already known"),
    },
    async (args) => getFeeDisclosurePrompt(args as { company?: string; accession?: string })
  );

  // ─── Transport ───────────────────────────────────────────────────────────────

  if (config.transportType === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const http = await import("http");

    const httpServer = http.createServer(async (req, res) => {
      if (req.url === "/mcp" || req.url === "/mcp/") {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
        await server.connect(transport as Parameters<typeof server.connect>[0]);
        await transport.handleRequest(req, res);
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "filing-fee-mcp-server", version: "1.0.0" }));
        return;
      }
      res.writeHead(404);
      res.end("Not found. MCP endpoint: /mcp");
    });

    httpServer.listen(config.httpPort, () => {
      process.stderr.write(`[filing-fee-mcp] HTTP server on http://localhost:${config.httpPort}/mcp\n`);
    });
  }
}

main().catch((err) => {
  process.stderr.write(`[filing-fee-mcp] Fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
