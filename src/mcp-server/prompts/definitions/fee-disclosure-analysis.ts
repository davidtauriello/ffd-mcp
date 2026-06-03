/**
 * @fileoverview fee_disclosure_analysis prompt — guides structured analysis of fee exhibits.
 * @module mcp-server/prompts/definitions/fee-disclosure-analysis
 */

export const FEE_DISCLOSURE_PROMPT_NAME = "fee_disclosure_analysis";

export const FEE_DISCLOSURE_PROMPT_DESCRIPTION =
  "Guides structured analysis of a company's Exhibit 107 filing fee disclosures. " +
  "Covers fee breakdown, rate analysis, offering structure, and comparison to peers.";

export function getFeeDisclosurePrompt(args: { company?: string; accession?: string }) {
  const target = args.company
    ? `the company "${args.company}"`
    : args.accession
      ? `filing accession ${args.accession}`
      : "a company of the user's choice";

  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Analyze the Exhibit 107 filing fee disclosure for ${target}.`,
            "",
            "Follow these steps:",
            "",
            "1. **Identify the filing**: Use search_fee_filings to find the most recent registration statement with an Exhibit 107.",
            "2. **Parse the fee exhibit**: Use get_fee_exhibit to extract the full structured fee table.",
            "3. **Analyze the fee structure**:",
            "   - List each security class with its type, title, and maximum aggregate offering amount",
            "   - Identify the fee calculation rule used (e.g., Rule 457(o) vs 457(a))",
            "   - Note the SEC fee rate applied",
            "   - Calculate the effective fee as a percentage of total offering",
            "4. **Summarize**:",
            "   - Total offering amount and net fee due",
            "   - Any fee offsets or previously paid amounts",
            "   - Whether the offering is equity, debt, or mixed",
            "5. **Context**: Explain what the fee amounts tell us about the size and nature of the offering.",
            "",
            "If no Exhibit 107 is found, explain that the company may not have filed a registration statement recently,",
            "or the filing may predate the February 2022 mandate.",
          ].join("\n"),
        },
      },
    ],
  };
}
