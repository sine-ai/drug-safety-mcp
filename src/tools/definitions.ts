/**
 * FAERS MCP - Tool Definitions
 * 
 * FDA Adverse Event Reporting System (FAERS) tools for accessing
 * post-market drug safety data via the OpenFDA API.
 */

import type { ToolDefinition } from "@sineai/mcp-core";

export const TOOLS: ToolDefinition[] = [
  // -------------------------------------------------------------------------
  // SEARCH ADVERSE EVENTS
  // -------------------------------------------------------------------------
  {
    name: "search_adverse_events",
    description: "Search FAERS for adverse event reports by drug name, reaction, or date range. Returns individual case reports with patient demographics, reactions, and outcomes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug (e.g., 'Humira', 'adalimumab')",
        },
        reaction: {
          type: "string",
          description: "MedDRA preferred term for the adverse reaction (e.g., 'headache', 'nausea', 'injection site reaction')",
        },
        start_date: {
          type: "string",
          description: "Start date for search range in YYYYMMDD format (e.g., '20200101')",
        },
        end_date: {
          type: "string",
          description: "End date for search range in YYYYMMDD format (e.g., '20231231')",
        },
        serious: {
          type: "boolean",
          description: "Filter to only serious adverse events (death, hospitalization, life-threatening, disability)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10, max: 100)",
        },
      },
      required: ["drug_name"],
    },
  },

  // -------------------------------------------------------------------------
  // GET EVENT COUNTS
  // -------------------------------------------------------------------------
  {
    name: "get_event_counts",
    description: "Get aggregated counts of adverse events for a drug, grouped by reaction, outcome, patient age, sex, or country. Useful for understanding the safety profile distribution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        group_by: {
          type: "string",
          enum: ["reaction", "outcome", "age", "sex", "country", "reporter_type", "route"],
          description: "Field to group counts by",
        },
        limit: {
          type: "number",
          description: "Number of top results to return (default: 20, max: 100)",
        },
      },
      required: ["drug_name", "group_by"],
    },
  },

  // -------------------------------------------------------------------------
  // COMPARE SAFETY PROFILES
  // -------------------------------------------------------------------------
  {
    name: "compare_safety_profiles",
    description: "Compare adverse event profiles across multiple drugs. Returns top reactions for each drug for side-by-side comparison.",
    inputSchema: {
      type: "object" as const,
      properties: {
        drug_names: {
          type: "array",
          items: { type: "string" },
          description: "List of drug names to compare (2-5 drugs)",
        },
        top_n: {
          type: "number",
          description: "Number of top reactions to return per drug (default: 10)",
        },
      },
      required: ["drug_names"],
    },
  },

  // -------------------------------------------------------------------------
  // GET SERIOUS EVENTS
  // -------------------------------------------------------------------------
  {
    name: "get_serious_events",
    description: "Get serious adverse events for a drug, filtered by outcome type (death, hospitalization, life-threatening, disability, congenital anomaly, or other serious).",
    inputSchema: {
      type: "object" as const,
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        outcome_type: {
          type: "string",
          enum: ["death", "hospitalization", "life_threatening", "disability", "congenital_anomaly", "other_serious"],
          description: "Type of serious outcome to filter by (optional - returns all serious if not specified)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
      },
      required: ["drug_name"],
    },
  },

  // -------------------------------------------------------------------------
  // GET REPORTING TRENDS
  // -------------------------------------------------------------------------
  {
    name: "get_reporting_trends",
    description: "Get adverse event reporting trends over time for a drug. Useful for detecting safety signals (sudden increases in reports).",
    inputSchema: {
      type: "object" as const,
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        granularity: {
          type: "string",
          enum: ["year", "quarter", "month"],
          description: "Time granularity for trend analysis (default: quarter)",
        },
        years: {
          type: "number",
          description: "Number of years of history to include (default: 5)",
        },
      },
      required: ["drug_name"],
    },
  },

  // -------------------------------------------------------------------------
  // SEARCH BY REACTION
  // -------------------------------------------------------------------------
  {
    name: "search_by_reaction",
    description: "Find all drugs associated with a specific adverse reaction. Useful for understanding which drugs commonly cause a particular side effect.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reaction: {
          type: "string",
          description: "MedDRA preferred term for the adverse reaction (e.g., 'Stevens-Johnson syndrome', 'QT prolongation')",
        },
        limit: {
          type: "number",
          description: "Number of top drugs to return (default: 20)",
        },
      },
      required: ["reaction"],
    },
  },

  // -------------------------------------------------------------------------
  // GET CONCOMITANT DRUGS
  // -------------------------------------------------------------------------
  {
    name: "get_concomitant_drugs",
    description: "Find drugs commonly co-reported with a specific drug in adverse event reports. Helps identify potential drug interactions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the primary drug",
        },
        limit: {
          type: "number",
          description: "Number of top concomitant drugs to return (default: 20)",
        },
      },
      required: ["drug_name"],
    },
  },

  // -------------------------------------------------------------------------
  // GET DATA INFO
  // -------------------------------------------------------------------------
  {
    name: "get_data_info",
    description: "Get information about the FAERS database including last update date, data limitations, and how to interpret results.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];
