/**
 * FAERS MCP - Tool Definitions
 * 
 * FDA Adverse Event Reporting System (FAERS) tools for accessing
 * post-market drug safety data via the OpenFDA API.
 * 
 * All tools are read-only and query public FDA data.
 */

export interface ToolAnnotations {
  /** Human-readable title for the tool */
  title?: string;
  /** If true, the tool does not modify any state (read-only) */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive operations */
  destructiveHint?: boolean;
  /** If true, tool may interact with external entities */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations?: ToolAnnotations;
}

export const TOOLS: ToolDefinition[] = [
  // -------------------------------------------------------------------------
  // SEARCH ADVERSE EVENTS
  // -------------------------------------------------------------------------
  {
    name: "search_adverse_events",
    description: "Search FAERS for adverse event reports by drug name, reaction, or date range. Returns individual case reports with patient demographics, reactions, and outcomes.",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Search Adverse Events",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET EVENT COUNTS
  // -------------------------------------------------------------------------
  {
    name: "get_event_counts",
    description: "Get aggregated counts of adverse events for a drug, grouped by reaction, outcome, patient age, sex, or country. Useful for understanding the safety profile distribution.",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Get Event Counts",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // COMPARE SAFETY PROFILES
  // -------------------------------------------------------------------------
  {
    name: "compare_safety_profiles",
    description: "Compare adverse event profiles across multiple drugs. Returns top reactions for each drug for side-by-side comparison.",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Compare Safety Profiles",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET SERIOUS EVENTS
  // -------------------------------------------------------------------------
  {
    name: "get_serious_events",
    description: "Get serious adverse events for a drug, filtered by outcome type (death, hospitalization, life-threatening, disability, congenital anomaly, or other serious).",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Get Serious Events",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET REPORTING TRENDS
  // -------------------------------------------------------------------------
  {
    name: "get_reporting_trends",
    description: "Get adverse event reporting trends over time for a drug. Useful for detecting safety signals (sudden increases in reports).",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Get Reporting Trends",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // SEARCH BY REACTION
  // -------------------------------------------------------------------------
  {
    name: "search_by_reaction",
    description: "Find all drugs associated with a specific adverse reaction. Useful for understanding which drugs commonly cause a particular side effect.",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Search by Reaction",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET CONCOMITANT DRUGS
  // -------------------------------------------------------------------------
  {
    name: "get_concomitant_drugs",
    description: "Find drugs commonly co-reported with a specific drug in adverse event reports. Helps identify potential drug interactions.",
    inputSchema: {
      type: "object",
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
    annotations: {
      title: "Get Concomitant Drugs",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET DATA INFO
  // -------------------------------------------------------------------------
  {
    name: "get_data_info",
    description: "Get information about the FAERS database including last update date, data limitations, and how to interpret results.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations: {
      title: "Get Data Info",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET DRUG LABEL INFO
  // -------------------------------------------------------------------------
  {
    name: "get_drug_label_info",
    description: "Get FDA drug label information including indications, warnings, contraindications, adverse reactions, and boxed warnings. Provides official prescribing information context.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug (e.g., 'Humira', 'adalimumab')",
        },
        sections: {
          type: "array",
          items: { type: "string" },
          description: "Specific label sections to retrieve (e.g., ['warnings', 'adverse_reactions', 'contraindications']). Returns all key sections if not specified.",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Get Drug Label Info",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET RECALL INFO
  // -------------------------------------------------------------------------
  {
    name: "get_recall_info",
    description: "Search FDA drug recalls and enforcement actions. Returns recall classification, reason, distribution, and status for drug safety issues.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug to search recalls for",
        },
        classification: {
          type: "string",
          enum: ["Class I", "Class II", "Class III"],
          description: "Recall classification: Class I (most serious - may cause death), Class II (may cause temporary health problems), Class III (unlikely to cause adverse health consequences)",
        },
        status: {
          type: "string",
          enum: ["Ongoing", "Completed", "Terminated", "Pending"],
          description: "Filter by recall status",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Get Recall Info",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // SEARCH BY INDICATION
  // -------------------------------------------------------------------------
  {
    name: "search_by_indication",
    description: "Find adverse events for drugs used for a specific indication/condition. Useful for comparing safety profiles of drugs in the same therapeutic class.",
    inputSchema: {
      type: "object",
      properties: {
        indication: {
          type: "string",
          description: "Medical condition or indication (e.g., 'diabetes', 'rheumatoid arthritis', 'hypertension')",
        },
        group_by: {
          type: "string",
          enum: ["drug", "reaction"],
          description: "Group results by drug name or by reaction type (default: drug)",
        },
        limit: {
          type: "number",
          description: "Number of top results to return (default: 20)",
        },
      },
      required: ["indication"],
    },
    annotations: {
      title: "Search by Indication",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // SEARCH BY DRUG CLASS
  // -------------------------------------------------------------------------
  {
    name: "search_by_drug_class",
    description: "Search adverse events across an entire drug class (pharmacologic class). Compare safety profiles of all drugs in a therapeutic category like 'TNF inhibitors', 'GLP-1 agonists', 'SSRIs', etc.",
    inputSchema: {
      type: "object",
      properties: {
        drug_class: {
          type: "string",
          description: "Pharmacologic class name (e.g., 'Tumor Necrosis Factor Blocker', 'GLP-1 Receptor Agonist', 'Selective Serotonin Reuptake Inhibitor', 'ACE Inhibitor')",
        },
        group_by: {
          type: "string",
          enum: ["drug", "reaction"],
          description: "Group results by individual drug or by reaction type (default: reaction)",
        },
        serious_only: {
          type: "boolean",
          description: "Filter to only serious adverse events (default: false)",
        },
        limit: {
          type: "number",
          description: "Number of top results to return (default: 20)",
        },
      },
      required: ["drug_class"],
    },
    annotations: {
      title: "Search by Drug Class",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // COMPARE LABEL TO REPORTS
  // -------------------------------------------------------------------------
  {
    name: "compare_label_to_reports",
    description: "Compare FDA drug label adverse reactions to actual FAERS reports. Identifies potential emerging signals (reactions reported but not on label) and validates labeled reactions. Critical for pharmacovigilance signal detection.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        top_n: {
          type: "number",
          description: "Number of top reported reactions to analyze (default: 20)",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Compare Label to Reports",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET PEDIATRIC SAFETY
  // -------------------------------------------------------------------------
  {
    name: "get_pediatric_safety",
    description: "Get adverse event data specifically for pediatric patients (age 0-17). Returns age-stratified safety data, top reactions in children, and comparison to adult safety profile. Essential for pediatric trial planning.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        age_group: {
          type: "string",
          enum: ["neonate", "infant", "child", "adolescent", "all_pediatric"],
          description: "Specific pediatric age group: neonate (0-27 days), infant (28 days-23 months), child (2-11 years), adolescent (12-17 years), or all_pediatric (0-17 years). Default: all_pediatric",
        },
        include_adult_comparison: {
          type: "boolean",
          description: "Include comparison to adult (18+) safety profile (default: true)",
        },
        limit: {
          type: "number",
          description: "Number of top reactions to return (default: 15)",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Get Pediatric Safety",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET GERIATRIC SAFETY
  // -------------------------------------------------------------------------
  {
    name: "get_geriatric_safety",
    description: "Get adverse event data specifically for geriatric patients (age 65+). Returns age-stratified safety data, top reactions in elderly, falls/cognitive events, and comparison to younger adult profile. Essential for trials in elderly populations.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        age_group: {
          type: "string",
          enum: ["65_to_74", "75_to_84", "85_plus", "all_geriatric"],
          description: "Specific geriatric age group or all_geriatric (65+). Default: all_geriatric",
        },
        include_adult_comparison: {
          type: "boolean",
          description: "Include comparison to younger adult (18-64) safety profile (default: true)",
        },
        limit: {
          type: "number",
          description: "Number of top reactions to return (default: 15)",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Get Geriatric Safety",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET SAFETY SUMMARY
  // -------------------------------------------------------------------------
  {
    name: "get_safety_summary",
    description: "Get an executive safety summary for a drug combining: total report counts, top 10 reactions, serious event breakdown, recent trend direction, any recalls, and boxed warnings. Ideal for quick due diligence or HCP questions.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
        include_label_warnings: {
          type: "boolean",
          description: "Include boxed warnings and major label warnings (default: true)",
        },
        include_recalls: {
          type: "boolean",
          description: "Include recall history summary (default: true)",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Get Safety Summary",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },

  // -------------------------------------------------------------------------
  // GET PREGNANCY LACTATION INFO
  // -------------------------------------------------------------------------
  {
    name: "get_pregnancy_lactation_info",
    description: "Get pregnancy and lactation safety information from FDA drug label. Includes pregnancy category/narrative, lactation recommendations, and females/males of reproductive potential guidance. Critical for protocol exclusion criteria.",
    inputSchema: {
      type: "object",
      properties: {
        drug_name: {
          type: "string",
          description: "Brand name or generic name of the drug",
        },
      },
      required: ["drug_name"],
    },
    annotations: {
      title: "Get Pregnancy & Lactation Info",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
];
