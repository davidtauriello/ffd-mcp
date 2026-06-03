/**
 * @fileoverview Exhibit 107 filing fee parser.
 * Extracts ffd: XBRL concepts from inline iXBRL HTML and standalone XML.
 * Handles all XBRL contexts (offrl_1 … offrl_N) to capture every row.
 * @module services/edgar/fee-exhibit-parser
 */

import type {
  FeeLineItem,
  FilingFeeExhibit,
  SecurityType,
} from "./types.js";

// ─── FFD namespace concepts we care about ─────────────────────────────────────

// Concept sets kept for reference — not currently used programmatically.
// const MONETARY_CONCEPTS = new Set(["AmtSctiesRgstrd", "PricPerScty", ...]);
// const STRING_CONCEPTS = new Set(["SubmissnTp", "FeeExhibitTp", ...]);

// ─── Parsed XBRL fact ─────────────────────────────────────────────────────────

interface XbrlFact {
  concept: string; // local-name only (no prefix)
  contextRef: string;
  value: string;
  decimals?: string;
  unitRef?: string;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export class FeeExhibitParser {
  /**
   * Parse an Exhibit 107 document (iXBRL HTML or inline XBRL XML).
   * Returns a structured FilingFeeExhibit or throws on parse failure.
   */
  parseExhibit(
    html: string,
    meta: {
      cik: string;
      entityName: string;
      accessionNumber: string;
      formType: string;
      filingDate: string;
      exhibitDocument: string | null;
      exhibitUrl: string;
    }
  ): FilingFeeExhibit {
    const facts = this.extractFacts(html);
    return this.assembleFeeExhibit(facts, meta);
  }

  // ─── Step 1: Extract all ffd: XBRL facts from the document ─────────────────

  private extractFacts(html: string): XbrlFact[] {
    const facts: XbrlFact[] = [];

    // iXBRL inline facts: <ix:nonNumeric contextRef="..." name="ffd:Foo">value</ix:nonNumeric>
    // and <ix:nonFraction contextRef="..." name="ffd:Foo" decimals="..." unitRef="...">value</ix:nonFraction>
    const ixPattern =
      /<ix:(nonNumeric|nonFraction)[^>]*?name="ffd:([^"]+)"[^>]*?contextRef="([^"]*)"[^>]*?(?:decimals="([^"]*)"[^>]*?)?(?:unitRef="([^"]*)"[^>]*?)?>([\s\S]*?)<\/ix:\1>/gi;

    let match: RegExpExecArray | null;
    while ((match = ixPattern.exec(html)) !== null) {
      const fact: XbrlFact = { concept: match[2] ?? "", contextRef: match[3] ?? "", value: this.cleanValue(match[6] ?? "") };
      if (match[4] !== undefined) fact.decimals = match[4];
      if (match[5] !== undefined) fact.unitRef = match[5];
      facts.push(fact);
    }

    // Also look for standalone XML ix:header / xbrl instance doc style
    // <ffd:Foo contextRef="..." decimals="...">value</ffd:Foo>
    const xmlPattern =
      /<ffd:([A-Za-z]+)[^>]*?contextRef="([^"]*)"[^>]*?(?:decimals="([^"]*)")?[^>]*?(?:unitRef="([^"]*)")?[^>]*?>([\s\S]*?)<\/ffd:\1>/gi;

    // Reset to avoid duplicates — only use xmlPattern if ixPattern found nothing
    if (facts.length === 0) {
      while ((match = xmlPattern.exec(html)) !== null) {
        const fact: XbrlFact = { concept: match[1] ?? "", contextRef: match[2] ?? "", value: this.cleanValue(match[5] ?? "") };
        if (match[3] !== undefined) fact.decimals = match[3];
        if (match[4] !== undefined) fact.unitRef = match[4];
        facts.push(fact);
      }
    }

    // Fallback: parse plain HTML table if no XBRL at all
    if (facts.length === 0) {
      return this.extractFromHtmlTable(html);
    }

    return facts;
  }

  // ─── Step 2: Extract from HTML table as last resort ──────────────────────────

  private extractFromHtmlTable(html: string): XbrlFact[] {
    const facts: XbrlFact[] = [];
    // Look for patterns like "$100,000,000.00" and "0.0001381" in the fee table
    // This is a heuristic fallback for non-XBRL exhibits
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    let rowNum = 0;

    for (const row of rows) {
      const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? []).map((c) =>
        c.replace(/<[^>]+>/g, "").trim()
      );
      if (cells.length < 5) continue;

      // Heuristic: row with a dollar amount and a fee amount
      const hasAmount = cells.some((c) => /\$[\d,]+/.test(c));
      if (!hasAmount) continue;

      rowNum++;
      const ctx = `offrl_${rowNum}`;

      if (cells[0]) facts.push({ concept: "OfferingSctyTp", contextRef: ctx, value: cells[0] });
      if (cells[1]) facts.push({ concept: "SctyTitleTp", contextRef: ctx, value: cells[1] });
      if (cells[2]) facts.push({ concept: "FeeCalcRuleNm", contextRef: ctx, value: cells[2] });

      const maxAgg = this.parseMoney(cells[3] ?? "");
      if (maxAgg !== null) {
        facts.push({
          concept: "MaxAggrgteOfferingAmt",
          contextRef: ctx,
          value: String(maxAgg),
          unitRef: "USD",
        });
      }

      const feeAmt = this.parseMoney(cells[cells.length - 1] ?? "");
      if (feeAmt !== null) {
        facts.push({
          concept: "FeeAmt",
          contextRef: ctx,
          value: String(feeAmt),
          unitRef: "USD",
        });
      }
    }

    return facts;
  }

  // ─── Step 3: Assemble the structured exhibit from facts ──────────────────────

  private assembleFeeExhibit(
    facts: XbrlFact[],
    meta: {
      cik: string;
      entityName: string;
      accessionNumber: string;
      formType: string;
      filingDate: string;
      exhibitDocument: string | null;
      exhibitUrl: string;
    }
  ): FilingFeeExhibit {
    // Bucket facts by context
    const byContext = new Map<string, Map<string, string>>();
    for (const f of facts) {
      if (!byContext.has(f.contextRef)) byContext.set(f.contextRef, new Map());
      byContext.get(f.contextRef)!.set(f.concept, f.value);
    }

    // Summary-level context (usually "rc" or "duration" or "")
    const summaryCtx = this.findSummaryContext(byContext);
    const summary = summaryCtx ? (byContext.get(summaryCtx) ?? new Map()) : new Map<string, string>();

    // Row-level contexts: offrl_1, offrl_2, ... or any context with OfferingSctyTp/SctyTitleTp
    const rowContexts = this.findRowContexts(byContext);

    // Build line items
    const lineItems: FeeLineItem[] = rowContexts.map((ctx, i) => {
      const c = byContext.get(ctx) ?? new Map();
      return {
        row: i + 1,
        securityType: this.parseSecurityType(c.get("OfferingSctyTp") ?? ""),
        classTitle: c.get("SctyTitleTp") ?? `Security class ${i + 1}`,
        feeCalcRule: c.get("FeeCalcRuleNm") ?? null,
        amountRegistered: this.parseNumber(c.get("AmtSctiesRgstrd")),
        pricePerUnit: this.parseNumber(c.get("PricPerScty")),
        maxAggregateOffering: this.parseNumber(c.get("MaxAggrgteOfferingAmt")),
        feeRate: this.parseNumber(c.get("FeeRate") ?? summary.get("FeeRate")),
        feeAmount: this.parseNumber(c.get("FeeAmt")),
        previouslyPaid: (c.get("PrevslyPdFlg") ?? "false").toLowerCase() === "true",
        xbrlContext: ctx,
      };
    });

    // Net totals — prefer explicit XBRL fields, fall back to summing line items
    const totalOffering =
      (this.parseNumber(summary.get("TtlOfferingAmt"))) ??
      (lineItems.reduce((s, r) => s + (r.maxAggregateOffering ?? 0), 0) || null);

    const totalFee =
      (this.parseNumber(summary.get("TtlFeeAmt"))) ??
      (lineItems.reduce((s, r) => s + (r.feeAmount ?? 0), 0) || null);

    const netFeeDue =
      this.parseNumber(summary.get("NetFeeAmt")) ?? totalFee;

    return {
      cik: meta.cik,
      entityName: meta.entityName,
      accessionNumber: meta.accessionNumber,
      formType: meta.formType,
      filingDate: meta.filingDate,
      exhibitDocument: meta.exhibitDocument,
      exhibitUrl: meta.exhibitUrl,
      exhibitType: summary.get("FeeExhibitTp") ?? "EX-FILING FEES",
      submissionType: summary.get("SubmissnTp") ?? meta.formType,
      offeringTableNa: (summary.get("OfferingTableNa") ?? "") === "N/A",
      offsetTableNa: (summary.get("OffsetTableNa") ?? "N/A") === "N/A",
      combinedProspectusTableNa: (summary.get("CombinedProspectusTableNa") ?? "N/A") === "N/A",
      lineItems,
      offsets: [], // offset parsing omitted for brevity
      totalOffering,
      totalFee,
      totalPreviouslyPaid: this.parseNumber(summary.get("TtlPrevlyPdAmt")) ?? 0,
      totalFeeOffset: this.parseNumber(summary.get("TtlFeeOffsetAmt")) ?? 0,
      netFeeDue,
      feeRate:
        this.parseNumber(summary.get("FeeRate")) ??
        lineItems.find((r) => r.feeRate !== null)?.feeRate ?? null,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private findSummaryContext(byContext: Map<string, Map<string, string>>): string | null {
    const summaryKeys = new Set(["TtlOfferingAmt", "NetFeeAmt", "TtlFeeAmt", "SubmissnTp", "FeeExhibitTp"]);
    for (const [ctx, facts] of byContext) {
      for (const key of summaryKeys) {
        if (facts.has(key)) return ctx;
      }
    }
    // Fallback: the context that has the most summary fields
    let best: string | null = null;
    let bestScore = 0;
    for (const [ctx, facts] of byContext) {
      const score = [...summaryKeys].filter((k) => facts.has(k)).length;
      if (score > bestScore) {
        best = ctx;
        bestScore = score;
      }
    }
    return best;
  }

  private findRowContexts(byContext: Map<string, Map<string, string>>): string[] {
    const rowKeys = new Set(["OfferingSctyTp", "SctyTitleTp", "FeeAmt", "MaxAggrgteOfferingAmt"]);
    const candidates: string[] = [];

    for (const [ctx, facts] of byContext) {
      const score = [...rowKeys].filter((k) => facts.has(k)).length;
      if (score >= 1) candidates.push(ctx);
    }

    // Sort: offrl_1, offrl_2, ... numerically; then other contexts
    return candidates.sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, "") || "0", 10);
      const nb = parseInt(b.replace(/\D/g, "") || "0", 10);
      return na - nb;
    });
  }

  private parseSecurityType(raw: string): SecurityType {
    const u = raw.toLowerCase();
    if (u.includes("debt") || u.includes("note") || u.includes("bond") || u.includes("debenture"))
      return "Debt";
    if (
      u.includes("equit") ||
      u.includes("common") ||
      u.includes("preferred") ||
      u.includes("warrant") ||
      u.includes("unit")
    )
      return "Equity";
    if (raw === "") return "Unknown";
    return "Other";
  }

  private parseNumber(raw: string | undefined): number | null {
    if (!raw) return null;
    const cleaned = raw.replace(/[$,\s]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  private parseMoney(raw: string): number | null {
    const cleaned = raw.replace(/[$,\s]/g, "").replace(/[()]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  private cleanValue(raw: string): string {
    // Strip HTML tags, decode entities, normalize whitespace
    return raw
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
