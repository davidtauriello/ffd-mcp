/**
 * @fileoverview Fee taxonomy resource — ffd: XBRL concept reference for Exhibit 107.
 * @module mcp-server/resources/definitions/fee-taxonomy
 */

export const FEE_TAXONOMY_URI = "ffd://fee-taxonomy";

export function getFeeeTaxonomyResource() {
  return {
    uri: FEE_TAXONOMY_URI,
    mimeType: "text/markdown" as const,
    text: FEE_TAXONOMY_MARKDOWN,
  };
}

const FEE_TAXONOMY_MARKDOWN = `# FFD XBRL Taxonomy — Exhibit 107 Filing Fee Concepts

The \`ffd:\` namespace covers all machine-readable concepts in SEC Exhibit 107 (EX-FILING FEES).
These exhibits are required on registration statements (S-1, S-3, F-1, etc.) filed since February 2022.

## Per-Row Concepts (one per security class, context \`offrl_1\` … \`offrl_N\`)

| Concept | Type | Description |
|:--------|:-----|:------------|
| \`ffd:OfferingSctyTp\` | String | Security type (Equity, Debt, Other) |
| \`ffd:SctyTitleTp\` | String | Class title (e.g. "Common Stock", "8.5% Senior Notes") |
| \`ffd:FeeCalcRuleNm\` | String | Fee calculation rule (e.g. "Rule 457(o)", "Rule 457(a)") |
| \`ffd:AmtSctiesRgstrd\` | Monetary | Number of securities registered |
| \`ffd:PricPerScty\` | Monetary | Price per security (when applicable) |
| \`ffd:MaxAggrgteOfferingAmt\` | Monetary | Maximum aggregate offering amount |
| \`ffd:FeeRate\` | Decimal | SEC fee rate applied |
| \`ffd:FeeAmt\` | Monetary | Fee amount for this security class |
| \`ffd:PrevslyPdFlg\` | Boolean | Whether this fee was previously paid |

## Summary-Level Concepts (context \`rc\` or filing-level)

| Concept | Type | Description |
|:--------|:-----|:------------|
| \`ffd:SubmissnTp\` | String | Submission type (e.g. "S-1") |
| \`ffd:FeeExhibitTp\` | String | Exhibit type (usually "EX-FILING FEES") |
| \`ffd:TtlOfferingAmt\` | Monetary | Total aggregate offering amount |
| \`ffd:TtlFeeAmt\` | Monetary | Total fee amount |
| \`ffd:TtlPrevlyPdAmt\` | Monetary | Total previously paid |
| \`ffd:TtlFeeOffsetAmt\` | Monetary | Total fee offsets claimed |
| \`ffd:NetFeeAmt\` | Monetary | Net fee due to the SEC |
| \`ffd:FeeRate\` | Decimal | Fee rate (summary level) |

## Fee Offset Concepts

| Concept | Type | Description |
|:--------|:-----|:------------|
| \`ffd:FeeOffsetClmd\` | Monetary | Offset amount claimed |
| \`ffd:OffsetClmdRlToRl\` | String | Rule under which offset is claimed |

## Historical SEC Fee Rates

| Effective Date | Rate per $1M |
|:---------------|:-------------|
| 2024-10-01 | $153.10 |
| 2024-04-01 | $147.60 |
| 2023-10-01 | $147.60 |
| 2023-04-01 | $110.20 |
| 2022-10-01 | $110.20 |
| 2022-04-01 | $92.70 |

Fee rates are set by the SEC and apply uniformly. Differences between companies reflect rounding,
alternate calculation rules (e.g. 457(o) vs 457(a)), or previously paid offsets.
`;
