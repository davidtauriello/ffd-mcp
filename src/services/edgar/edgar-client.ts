/**
 * @fileoverview Rate-limited SEC EDGAR HTTP client.
 * Respects SEC's 10 req/s limit via 100ms inter-request delay.
 * Handles CIK resolution from tickers and company names.
 * @module services/edgar/edgar-client
 */

import type { ServerConfig } from "../../config/server-config.js";
import type { CikResolution, EdgarCompanyFilingsResponse } from "./types.js";

const BASE = "https://data.sec.gov";
const SEARCH_BASE = "https://efts.sec.gov";
const EDGAR_BASE = "https://www.sec.gov";

// ─── Rate limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private queue: Array<() => void> = [];
  private lastCall = 0;
  private readonly minGapMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(rps: number) {
    this.minGapMs = Math.ceil(1000 / rps);
  }

  async throttle(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastCall >= this.minGapMs && this.queue.length > 0) {
        const next = this.queue.shift();
        this.lastCall = now;
        next?.();
      }
      if (this.queue.length === 0) {
        clearInterval(this.timer!);
        this.timer = null;
      }
    }, 10);
  }
}

// ─── CIK cache ────────────────────────────────────────────────────────────────

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface CikCache {
  data: Record<string, TickerEntry>;
  fetchedAt: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class EdgarClient {
  private limiter: RateLimiter;
  private userAgent: string;
  private cikCache: CikCache | null = null;
  private readonly tickerCacheTtlMs: number;

  constructor(config: ServerConfig) {
    this.limiter = new RateLimiter(config.rateLimitRps);
    this.userAgent = config.userAgent;
    this.tickerCacheTtlMs = config.tickerCacheTtl * 1000;
  }

  // ─── Core fetch ─────────────────────────────────────────────────────────────

  async fetch(url: string): Promise<Response> {
    await this.limiter.throttle();
    const res = await globalThis.fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json, text/html, */*",
        "Accept-Encoding": "gzip, deflate",
      },
    });
    if (!res.ok) {
      throw new Error(`SEC EDGAR request failed: ${res.status} ${res.statusText} — ${url}`);
    }
    return res;
  }

  async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetch(url);
    return res.json() as Promise<T>;
  }

  async fetchText(url: string): Promise<string> {
    const res = await this.fetch(url);
    return res.text();
  }

  // ─── CIK resolution ──────────────────────────────────────────────────────────

  private async getTickerMap(): Promise<Record<string, TickerEntry>> {
    const now = Date.now();
    if (this.cikCache && now - this.cikCache.fetchedAt < this.tickerCacheTtlMs) {
      return this.cikCache.data;
    }
    const url = `${EDGAR_BASE}/files/company_tickers.json`;
    const raw = await this.fetchJson<Record<string, TickerEntry>>(url);
    this.cikCache = { data: raw, fetchedAt: now };
    return raw;
  }

  /**
   * Resolve a ticker, company name, or raw CIK string to a padded CIK + name.
   * Tries: numeric CIK → exact ticker → substring name match → EFTS entity search.
   */
  async resolveCik(query: string): Promise<CikResolution> {
    const trimmed = query.trim();

    // Raw numeric CIK
    if (/^\d+$/.test(trimmed)) {
      const padded = trimmed.padStart(10, "0");
      return { cik: padded, name: trimmed, ticker: null };
    }

    // Ticker / name lookup in cached map
    const map = await this.getTickerMap();
    const upper = trimmed.toUpperCase();

    for (const entry of Object.values(map)) {
      if (entry.ticker.toUpperCase() === upper) {
        return {
          cik: String(entry.cik_str).padStart(10, "0"),
          name: entry.title,
          ticker: entry.ticker,
        };
      }
    }

    // Substring name match
    const lower = trimmed.toLowerCase();
    for (const entry of Object.values(map)) {
      if (entry.title.toLowerCase().includes(lower)) {
        return {
          cik: String(entry.cik_str).padStart(10, "0"),
          name: entry.title,
          ticker: entry.ticker,
        };
      }
    }

    // EFTS full-text entity search fallback
    const searchUrl = `${SEARCH_BASE}/efts/v1/hits.json?q="${encodeURIComponent(trimmed)}"&dateRange=custom&startdt=2020-01-01&forms=S-1,S-3,S-11,F-1`;
    try {
      const hits = await this.fetchJson<{
        hits: { hits: Array<{ _source: { entity_name: string; file_num: string; period_of_report: string } }> };
      }>(searchUrl);
      const first = hits?.hits?.hits?.[0]?._source;
      if (first) {
        // Extract CIK from file_num if available
        const cikMatch = first.file_num?.match(/(\d+)/);
        if (cikMatch?.[1]) {
          return {
            cik: cikMatch[1].padStart(10, "0"),
            name: first.entity_name,
            ticker: null,
          };
        }
      }
    } catch {
      // ignore search errors, fall through to error
    }

    throw new Error(
      `Could not resolve "${query}" to a CIK. ` +
        `Try a ticker symbol (e.g. "AAPL"), 10-digit CIK number, or exact company name.`
    );
  }

  // ─── Filing index ────────────────────────────────────────────────────────────

  /** Fetch filing index for a given CIK and accession number */
  async getFilingIndex(cik: string, accessionNumber: string): Promise<string> {
    const acc = accessionNumber.replace(/-/g, "");
    const url = `${EDGAR_BASE}/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${accessionNumber}-index.htm`;
    return this.fetchText(url);
  }

  /** Fetch full filing index JSON */
  async getFilingIndexJson(
    cik: string,
    accessionNumber: string
  ): Promise<{ directory: { item: Array<{ name: string; type: string; size: string }> } }> {
    const acc = accessionNumber.replace(/-/g, "");
    const dirUrl = `${EDGAR_BASE}/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/`;
    return this.fetchJson(dirUrl);
  }

  /**
   * Fetch the document list for a filing with exhibit types.
   * Parses the SGML index-headers file which reliably includes TYPE and
   * FILENAME for every document — unlike the directory listing (HTML, no
   * types) or the -index.json (404 for many filings).
   */
  async getFilingDocuments(
    cik: string,
    accessionNumber: string
  ): Promise<Array<{ name: string; type: string; size: string; description?: string }>> {
    const acc = accessionNumber.replace(/-/g, "");
    const cikNum = parseInt(cik, 10);
    const headersUrl = `${EDGAR_BASE}/Archives/edgar/data/${cikNum}/${acc}/${accessionNumber}-index-headers.html`;
    try {
      const html = await this.fetchText(headersUrl);
      return parseIndexHeaders(html);
    } catch {
      return [];
    }
  }

  /** Fetch company recent filings from submissions endpoint */
  async getCompanyFilings(cik: string): Promise<EdgarCompanyFilingsResponse> {
    const padded = cik.padStart(10, "0");
    const url = `${BASE}/submissions/CIK${padded}.json`;
    return this.fetchJson<EdgarCompanyFilingsResponse>(url);
  }

  /** Fetch raw text of a specific document in a filing */
  async getFilingDocument(cik: string, accessionNumber: string, filename: string): Promise<string> {
    const acc = accessionNumber.replace(/-/g, "");
    const cikNum = parseInt(cik, 10);
    const url = `${EDGAR_BASE}/Archives/edgar/data/${cikNum}/${acc}/${filename}`;
    return this.fetchText(url);
  }

  /** EFTS full-text search for filings */
  async searchFilings(params: {
    query: string;
    forms?: string[];
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<{
    hits: {
      total: { value: number };
      hits: Array<{
        _id: string;
        _source: {
          period_of_report: string;
          entity_name: string;
          file_num: string;
          form_type: string;
          file_date: string;
          biz_location: string;
        };
      }>;
    };
  }> {
    const qs = new URLSearchParams();
    qs.set("q", params.query);
    if (params.forms?.length) qs.set("forms", params.forms.join(","));
    if (params.startDate || params.endDate) {
      qs.set("dateRange", "custom");
      if (params.startDate) qs.set("startdt", params.startDate);
      if (params.endDate) qs.set("enddt", params.endDate);
    }
    qs.set("hits.hits.total.value", "true");
    qs.set("hits.hits._source.period_of_report", "true");
    const url = `${SEARCH_BASE}/efts/v1/hits.json?${qs.toString()}`;
    return this.fetchJson(url);
  }

  /** Build canonical EDGAR URL for a filing document */
  buildDocumentUrl(cik: string, accessionNumber: string, filename: string): string {
    const acc = accessionNumber.replace(/-/g, "");
    const cikNum = parseInt(cik, 10);
    return `${EDGAR_BASE}/Archives/edgar/data/${cikNum}/${acc}/${filename}`;
  }

  // ─── Companyfacts (XBRL bulk data, no lag) ──────────────────────────────────

  /**
   * Fetch the full companyfacts JSON for a CIK.
   * Returns every XBRL fact ever filed — filter to `ffd` taxonomy for fee data.
   * This endpoint has no indexing lag: data appears as soon as EDGAR accepts it.
   */
  async getCompanyFacts(cik: string): Promise<CompanyFactsResponse> {
    const padded = cik.padStart(10, "0");
    const url = `${BASE}/api/xbrl/companyfacts/CIK${padded}.json`;
    return this.fetchJson<CompanyFactsResponse>(url);
  }

  // ─── Retry-aware document fetch for recent filings ──────────────────────────

  /**
   * Fetch a filing document with retry for very recent filings.
   * EDGAR's per-document index can lag 24–48h behind acceptance.
   * On a 404 for filings filed within the last 48h, retries up to 2 times
   * with short delays before giving up.
   */
  async getFilingDocumentWithRetry(
    cik: string,
    accessionNumber: string,
    filename: string,
    filingDate?: string,
  ): Promise<{ text: string; retried: boolean }> {
    const isRecent = filingDate ? isWithinHours(filingDate, 48) : false;
    const maxAttempts = isRecent ? 3 : 1;
    const delayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const text = await this.getFilingDocument(cik, accessionNumber, filename);
        return { text, retried: attempt > 1 };
      } catch (err) {
        const is404 = err instanceof Error && err.message.includes("404");
        if (!is404 || attempt >= maxAttempts) throw err;
        // Wait before retry — document may still be propagating
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
    // Unreachable, but satisfies TypeScript
    throw new Error("Retry exhausted");
  }

  /**
   * Fetch filing document list with retry for recently-filed accessions.
   * The -index.json can lag behind the submissions API.
   */
  async getFilingDocumentsWithRetry(
    cik: string,
    accessionNumber: string,
    filingDate?: string,
  ): Promise<{ docs: Array<{ name: string; type: string; size: string; description?: string }>; retried: boolean }> {
    const isRecent = filingDate ? isWithinHours(filingDate, 48) : false;
    const maxAttempts = isRecent ? 3 : 1;
    const delayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const docs = await this.getFilingDocuments(cik, accessionNumber);
      if (docs.length > 0) return { docs, retried: attempt > 1 };
      if (attempt >= maxAttempts) return { docs: [], retried: attempt > 1 };
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
    return { docs: [], retried: false };
  }
}

// ─── Companyfacts response type ───────────────────────────────────────────────

/** Subset of the companyfacts JSON we actually read. */
export interface CompanyFactsResponse {
  cik: number;
  entityName: string;
  facts: Record<
    string, // taxonomy, e.g. "ffd", "us-gaap", "dei"
    Record<
      string, // tag, e.g. "FeeAmt", "NetFeeAmt"
      {
        label: string;
        description: string;
        units: Record<
          string, // unit, e.g. "USD", "pure"
          Array<{
            accn: string;
            end: string;
            filed: string;
            form: string;
            fp: string;
            frame?: string;
            fy: number;
            start?: string;
            val: number;
          }>
        >;
      }
    >
  >;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the SGML index-headers HTML to extract document TYPE and FILENAME.
 * Each document block looks like:
 *   &lt;DOCUMENT&gt;
 *   &lt;TYPE&gt;EX-FILING FEES
 *   &lt;SEQUENCE&gt;2
 *   &lt;FILENAME&gt;exhibit107-fx1a.htm
 *   &lt;DESCRIPTION&gt;EX-FILING FEES
 */
function parseIndexHeaders(
  html: string
): Array<{ name: string; type: string; size: string; description?: string }> {
  const docs: Array<{ name: string; type: string; size: string; description?: string }> = [];
  // Match each DOCUMENT block — the headers file uses HTML-escaped angle brackets
  const docPattern = /&lt;DOCUMENT&gt;([\s\S]*?)(?:&lt;\/DOCUMENT&gt;|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = docPattern.exec(html)) !== null) {
    const block = match[1] ?? "";
    const typeMatch = block.match(/&lt;TYPE&gt;\s*([^\n<]+)/i);
    const fileMatch = block.match(/&lt;FILENAME&gt;\s*([^\n<]+)/i);
    const descMatch = block.match(/&lt;DESCRIPTION&gt;\s*([^\n<]+)/i);
    if (typeMatch?.[1] && fileMatch?.[1]) {
      const doc: { name: string; type: string; size: string; description?: string } = {
        name: fileMatch[1].trim(),
        type: typeMatch[1].trim(),
        size: "0",
      };
      const desc = descMatch?.[1]?.trim();
      if (desc) doc.description = desc;
      docs.push(doc);
    }
  }
  return docs;
}

/** Check whether a YYYY-MM-DD date string falls within the last N hours. */
function isWithinHours(dateStr: string, hours: number): boolean {
  const filed = new Date(dateStr + "T00:00:00Z");
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return filed.getTime() >= cutoff;
}
