// Default P&I standard pricing TAG register (90 TAGs) + dayworks TAG set (12
// TAGs, incl. the operator-inclusion rate-basis TAG added 5 Aug 2026) +
// dayworks rate card (incl. "-WO" with-operator companion items), extracted
// from "P&I Standard Tags and dayworks rates.xlsx" (worksheets "2) P&I
// Standard Pricing Tags" and "3) P&I Dayworks Rates").
//
// This is the SEED only — tagRegisterStore.js persists the live, editable
// copy in Supabase Storage (bucket tag-config), same pattern as
// plantRegisterStore.js. The tender team can edit trigger_concepts/priority/
// enabled through the admin UI without a redeploy; this file only matters
// again if the stored copy is ever reset.
//
// tag_text is copied verbatim from the workbook — do not reword TAG wording
// here without the tender team's sign-off (it is contractual language).
// trigger_concepts were AUTHORED from the TAG wording (the workbook has no
// such column) and should be reviewed/tuned by the tender team over time.
//
// Known data-quality issues carried over from the source workbook, per the
// TAG-review handover spec:
//  - TAG 32's source cell is corrupt ("iesel" only) — disabled, not guessed.
//  - TAGs 29 and 35 are verbatim duplicates in the workbook — both kept
//    active under their original numbers (not silently merged/renumbered),
//    flagged via data_quality_issue.
//  - Item/TAG numbers are stored as strings/ints exactly as given so a value
//    like dayworks item "2.10" is never coerced into the number 2.1.
//
// Validated 5 Aug 2026 against the real Puhinui Rd Lot 1 SOQ (manually, no
// live API call available in that session): 12 of 14 of the spec's section
// 10 validation findings matched correctly. Two corrections made as a
// result:
//  - TAG 63 (Benkelman Beam / pavement deflection testing) had its
//    trigger_concepts narrowed — "pavement testing" was broad enough to
//    risk a false match against Scala Penetrometer testing (TAG 61's
//    territory). Scala and Benkelman Beam are different tests (Tony,
//    5 Aug 2026) — TAG 63 now only fires on genuine deflection-testing
//    language.
//  - Dayworks TAG 12 added, plus "-WO" (with operator) companion rate lines
//    on every plant/vehicle item whose base rate excludes the operator/
//    driver. The Puhinui SOQ's dayworks schedule requires operator-inclusive
//    plant rates, the opposite basis to P&I's own excludes-operator lines.
//    Tony's correction: this is not a conflict to flag and argue about — 
//    with-operator and without-operator are genuinely two separate priced
//    items, so the fix is a second rate line (rate TBA, no real figure
//    exists yet), not a warning banner.
//
module.exports = {
  "pricingTags": [
    {
      "tag_number": 1,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Any consents, permits, fees, approvals, or extra work required by Resource Consent conditions.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "resource consent",
        "consent conditions",
        "RC conditions",
        "consent fees",
        "permits",
        "approvals"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 2,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Liaison with any residents, businesses, stakeholders with regards to property access or general approvals/notifications.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "liaison with residents",
        "stakeholder liaison",
        "property access notification",
        "community engagement"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 3,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Prior to work commencing the Client is to provide all current: construction drawings, contract specifications with relevant drainage specifications and basis of payment, onsite surveyor mark out of alignment and revised levels (R.Ls), materials onsite (if supplied), and any permits that you may require us to operate under (JSEA\u2019s, SSSP, ITP's, QA Plan/forms, EMP etc). P&I can help with the establishing of any JSEA\u2019s / SSSP or site-specific hazards, to the format you may require. P&I will submit all \u2018Notification of Particular Hazardous Work\u2019 to WorkSafe (usually notification for excavations over 1.5mtrs) for the duration of our works, and forward you copies for confirmation.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "construction drawings",
        "contract specifications",
        "drainage specification",
        "survey mark out",
        "RLs",
        "JSEA",
        "SSSP",
        "ITP",
        "QA plan",
        "EMP",
        "notification of particular hazardous work",
        "WorkSafe notification"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 4,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Supply or management of Traffic Control. Preparation of TMP/RON. (Note: TM allowance for our clear working area requirement is typically approx. 8m wide min.)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "traffic management",
        "TMP",
        "traffic management plan",
        "RON",
        "road opening notice",
        "CAR",
        "corridor access request",
        "traffic control",
        "signage",
        "cones",
        "barriers",
        "STMS"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 5,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Location, radar detection, and mark out of any services or other obstructions.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "service location",
        "radar detection",
        "GPR",
        "service mark out",
        "utility location",
        "obstruction location"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 6,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Supply of any service plans.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "service plans",
        "utility plans",
        "asset plans"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 7,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Stand over costs/asset owner approvals for work around any services.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "stand over",
        "asset owner approval",
        "utility standover",
        "network approval"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 8,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Securing of any power/telephone poles that require specialist supporting by the utilities supplier and any associated costs.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "power pole support",
        "telephone pole support",
        "pole securing",
        "utility support costs"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 9,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Relocation or diversion of existing services (ie. telecom, power, water, gas) to accommodate new pipelines and/or their associated structures (such as manholes/cesspits/pumpstations etc).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "service relocation",
        "service diversion",
        "telecom relocation",
        "power relocation",
        "water main relocation",
        "gas main relocation",
        "utility diversion"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 10,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Potholing of any services/obstructions for identification of clashes of design prior to construction works beginning.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "potholing",
        "service identification",
        "vacuum excavation for services",
        "clash identification"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 11,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Hydro-excavation or hand excavation of any services or other obstructions.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "hydro-excavation",
        "hand excavation of services",
        "hand dig services"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 12,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Any survey set out.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "survey set out",
        "construction set out",
        "setting out",
        "survey pegs"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 13,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Any as-built survey and/or as-built drawings (but we can assist client engineers/surveyors with GPS markouts identifying on-site locations & depths etc for the production of their as-built drawings of our work installed).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "as-built survey",
        "as-built drawings",
        "as built plans"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 14,
      "category": "Site Setup, Services & Survey",
      "tag_text": "Any fencing, edge protection, barricading or toilet facilities.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "fencing",
        "edge protection",
        "barricading",
        "toilet facilities",
        "site amenities"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 15,
      "category": "Environmental",
      "tag_text": "Any noise, dust, slit control, or installation, removal, re-establishment, or maintenance of any environmental, erosion, or sediment control measures.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "dust control",
        "noise control",
        "silt control",
        "erosion control",
        "sediment control",
        "ESC",
        "erosion and sediment control",
        "environmental controls"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 16,
      "category": "Environmental",
      "tag_text": "Any straw mulching of site.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "straw mulching",
        "mulching"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 17,
      "category": "Environmental",
      "tag_text": "Arborist work for removal of trees or branches, and working in drip lines. - (Client to engage arborists where required.)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "arborist",
        "tree removal",
        "branch removal",
        "drip line works"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 18,
      "category": "Environmental",
      "tag_text": "Hydro-excavation or hand excavation of any tree roots. - (Client to advise if this would be required by arborist).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "hydro-excavation of tree roots",
        "hand excavation of tree roots",
        "root excavation"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 19,
      "category": "Environmental",
      "tag_text": "Removal, reinstatement, or disposal of any trees, logs, stumps, or vegetation (any organic obstructions) underground or otherwise.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "vegetation removal",
        "tree removal",
        "stump grinding",
        "stump removal",
        "log removal",
        "organic material removal",
        "vegetation clearing"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 20,
      "category": "Environmental",
      "tag_text": "Any work in or around archaeological/heritage sites, and any costs associated with hold ups/delays due to archaeological finds.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "archaeological",
        "heritage site",
        "accidental discovery protocol",
        "koiwi",
        "taonga",
        "archaeological finds"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 21,
      "category": "Construction",
      "tag_text": "We expect to have a an access option to carry out works on Saturdays when required. Client to have their required supervision available when weekend works are required.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "Saturday works",
        "weekend works",
        "weekend supervision"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 22,
      "category": "Construction",
      "tag_text": "Any installation of throat risers or concrete set MH/cesspit iron lids at finish height (typically undertaken later by Client's roading/civil finishing crews).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "throat riser",
        "manhole lid",
        "cesspit lid",
        "finish height iron lids"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 23,
      "category": "Construction",
      "tag_text": "Any installation of catchpit concrete aprons (typically undertaken later by Client's kerbing crew when doing kerb and channels).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "catchpit apron",
        "concrete apron",
        "kerb and channel apron"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 24,
      "category": "Construction",
      "tag_text": "Any removal of existing manholes or pipelines.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "removal of existing manholes",
        "removal of existing pipelines",
        "demolition of existing pipe"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 25,
      "category": "Construction",
      "tag_text": "Any concrete surround/capping of shallow pipes.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "concrete surround",
        "concrete capping",
        "pipe encasement"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 26,
      "category": "Construction",
      "tag_text": "Any pipe grouting.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "pipe grouting",
        "grouting"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 27,
      "category": "Construction",
      "tag_text": "Any pipe anchor blocks or anti-seepage collars and/or any drop structures in manholes (where not already quantified on schedule).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "pipe anchor block",
        "anti-seepage collar",
        "drop structure",
        "manhole drop structure"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 28,
      "category": "Construction",
      "tag_text": "Geotextile wrapping of any trench bedding or pipe joints.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "geotextile",
        "geotextile wrapping",
        "trench bedding wrap",
        "pipe joint wrapping"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 29,
      "category": "Construction",
      "tag_text": "Any rip rap or subsoil drainage  installation. (where not already quantified on schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "rip rap",
        "riprap",
        "subsoil drainage"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1,
      "data_quality_issue": "Duplicate of TAG 35 \u2014 identical wording in source workbook. Both kept active and flagged; not merged automatically per spec (no silent rewriting of TAG numbering)."
    },
    {
      "tag_number": 30,
      "category": "Construction",
      "tag_text": "Any sheetpiling.  (where not already quantified on schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "sheet piling",
        "sheetpiling",
        "sheet pile"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 31,
      "category": "Construction",
      "tag_text": "Any concrete pumps.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "concrete pump",
        "concrete pumping"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 32,
      "category": "Construction",
      "tag_text": "iesel",
      "tag_type": "unknown",
      "trigger_concepts": [],
      "default_priority": "low",
      "enabled": false,
      "version": 1,
      "data_quality_issue": "Source workbook cell is corrupt/truncated ('iesel' only). Disabled pending Tony's correction of the original wording \u2014 do not guess the intended text."
    },
    {
      "tag_number": 33,
      "category": "Construction",
      "tag_text": "No allowance for construction/materials for laydown areas or haul roads if required.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "laydown area",
        "haul road construction",
        "haul road materials"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 34,
      "category": "Construction",
      "tag_text": "Any materials supplied by the Client are to be delivered within 50mtrs of current work area. Concrete for structures/pipe corbels is to be supplied by Ready Mix concrete truck. To ensure prudent ordering of concrete loads we will endeavour to order bulk loads where possible for the Clients benefit, to avoid small load charges and hassle of ordering multiple loads. Concrete trucks are to be supplied to closest haul roads and we will skip the concrete to manholes/structures required, and let the truck go in a timely fashion. Then bench MHs/form the pipe corbels (hobs) as required.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "materials supplied by client",
        "delivery distance",
        "ready mix concrete supply",
        "concrete truck access"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 35,
      "category": "Construction",
      "tag_text": "Any rip rap or subsoil drainage  installation. (where not already quantified on schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "rip rap",
        "riprap",
        "subsoil drainage"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1,
      "data_quality_issue": "Duplicate of TAG 29 \u2014 identical wording in source workbook. Both kept active and flagged; not merged automatically per spec (no silent rewriting of TAG numbering)."
    },
    {
      "tag_number": 36,
      "category": "Construction",
      "tag_text": "Any PE or CLS pipe welding or testing of any PE or CLS pipe welds.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "PE pipe welding",
        "CLS pipe welding",
        "pipe weld testing"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 37,
      "category": "Construction",
      "tag_text": "Accuracy of grades or rectifying of dips when Pipebursting (Pipebursting will only follow the grades of the existing pipelines they are pulled through. If pipelines proposed for pipebursting are concrete encased, ductile iron, or require relaying; opencut rates would apply).",
      "tag_type": "assumption",
      "trigger_concepts": [
        "pipebursting",
        "pipe bursting",
        "grade accuracy",
        "existing pipeline grades"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 38,
      "category": "Construction",
      "tag_text": "Hard filling trenches (place backfill, plate compaction & Clegg Test). - (where not already quantified on schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "hardfill trench",
        "hard filling",
        "plate compaction",
        "Clegg test"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 39,
      "category": "Water & Pumping",
      "tag_text": "Any Dewatering. (where not already quantified on schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "dewatering",
        "groundwater control"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 40,
      "category": "Water & Pumping",
      "tag_text": "Any Bypass Pumping of any pipelines or stream diversions.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "bypass pumping",
        "stream diversion",
        "flow diversion"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 41,
      "category": "Water & Pumping",
      "tag_text": "No allowance for well point dewatering of running sands.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "well point dewatering",
        "running sands",
        "wellpoint"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 42,
      "category": "Water & Pumping",
      "tag_text": "Have not allowed for costs associated with any tidal or seawater flows.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "tidal flows",
        "seawater flows",
        "tidal influence"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 43,
      "category": "Obstructions",
      "tag_text": "Any removal or disposal of any unforeseen obstructions such as rock or boulders or organic obstructions such as logs or tree stumps preventing trench excavation, or sheet pile installation or any installation otherwise. - (Most cost effective method for dealing with any obstructions to be established with Client & P&I once quantities/types onsite are verified by all parties.)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "unforeseen obstructions",
        "rock removal",
        "boulders",
        "logs",
        "tree stumps",
        "obstruction removal"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 44,
      "category": "Obstructions",
      "tag_text": "ROCK: Have not allowed for ripping/milling/rock breaking/blasting of any rock (including hard, rotten, sandstone, R1 or R2). This can be difficult to price accurately until best/clear methodology is established onsite once conditions and requirements are verified. Most cost effective method for dealing with any rock excavation to be established with both the Client & P&I once quantities/rock types onsite are verified.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "rock excavation",
        "rock breaking",
        "rock ripping",
        "rock milling",
        "blasting",
        "R1 rock",
        "R2 rock",
        "hard rock",
        "sandstone"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 45,
      "category": "Obstructions",
      "tag_text": "Concrete breaking/removal or installation.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "concrete breaking",
        "concrete removal",
        "concrete demolition"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 46,
      "category": "Obstructions",
      "tag_text": "Have not allowed for encountering ground conditions that differ adversely from the baseline conditions presented in the geotechnical baseline report.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "geotechnical baseline report",
        "GBR",
        "adverse ground conditions",
        "differing site conditions"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 47,
      "category": "Backfill & Disposal",
      "tag_text": "Removal of any excavated material (spoil) from work area, or any double handling of excavated material to make suitable for backfilling. Any excess spoil is to be side casted and piles to be left beside excavation works for removal by client. Client to provide trucking for the removal of unsuitable soils.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "spoil removal",
        "spoil disposal",
        "excess material removal",
        "double handling",
        "excavated material removal",
        "trucking of unsuitable soil"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 48,
      "category": "Backfill & Disposal",
      "tag_text": "Compaction of existing material: Compaction KPa strength will only be determined by existing clay strength. Where backfilling with the excavated existing spoil/clay fill is specified, we have allowed for standard compaction methodology with an excavator compaction wheel or equivalent to meet compaction requirements. Any backfill material that doesn\u2019t meet compaction specifications due to low cohesion or high sand/moisture content will need to be replaced by the Client with an approved suitable backfill material. No allowance has been made for settlement risk of compressible soils in the trench line.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "compaction of existing material",
        "compaction KPa",
        "clay strength",
        "compaction standard",
        "backfill compaction"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 49,
      "category": "Backfill & Disposal",
      "tag_text": "Any stabilised backfill or bedding \u2013 lime stabilised, cement stabilised or otherwise. No allowance for flowable-fill or mixing cement into backfill or bedding. (where not already quantified on the schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "stabilised backfill",
        "lime stabilisation",
        "cement stabilisation",
        "flowable fill",
        "CLSM"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 50,
      "category": "Backfill & Disposal",
      "tag_text": "Any rubbish disposal of any kind. (where not already quantified on the schedule)",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "rubbish disposal",
        "waste disposal",
        "general rubbish"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 51,
      "category": "Backfill & Disposal",
      "tag_text": "Handling, removal or disposal of contaminated soils, asbestos or Coal Tar materials or other contaminated material and where specialised wrapping or disposal is required.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "contaminated soil",
        "asbestos",
        "coal tar",
        "hazardous material disposal",
        "contaminated material"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 52,
      "category": "Backfill & Disposal",
      "tag_text": "Undercutting of trench/excavation and removal of unsuitable material, and/or installation of suitable new material.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "undercutting",
        "unsuitable material removal",
        "subgrade replacement"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 53,
      "category": "Reinstatement",
      "tag_text": "No allowance for reinstatement.  We have allowed for reinstatement with specified backfill (ie: hardfill or excavated trench clay fill) to existing ground level above pipes installed. (ie: Have not allowed for any reinstatement if required, such as topsoil/chipseal/hotmix/concrete/any vegetation).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "reinstatement",
        "topsoil reinstatement",
        "chipseal reinstatement",
        "hotmix reinstatement",
        "pavement reinstatement",
        "vegetation reinstatement"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 54,
      "category": "Reinstatement",
      "tag_text": "Removal or reinstatement of any road line marking.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "road line marking",
        "line marking removal",
        "line marking reinstatement"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 55,
      "category": "Reinstatement",
      "tag_text": "Reinstatement of any traffic light sensor cords around traffic lights.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "traffic light sensor",
        "loop detector",
        "sensor cords"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 56,
      "category": "Reinstatement",
      "tag_text": "Removal or reinstatement of any traffic islands or kerbing or channel.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "traffic islands",
        "kerb reinstatement",
        "channel reinstatement",
        "kerb and channel"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 57,
      "category": "Reinstatement",
      "tag_text": "Removal or reinstatement of any concrete driveways or footpaths.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "concrete driveway reinstatement",
        "footpath reinstatement"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 58,
      "category": "Reinstatement",
      "tag_text": "Removal or reinstatement of any pavers.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "paver reinstatement",
        "pavers"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 59,
      "category": "Testing & Quality Assurance",
      "tag_text": "CCTV or jetting of any pipelines.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "CCTV inspection",
        "pipe jetting",
        "CCTV survey",
        "drain jetting"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 60,
      "category": "Testing & Quality Assurance",
      "tag_text": "Any air/hydrostatic testing on Stormwater pipes, but we have allowed to air test any new Wastewater pipelines installed.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "air testing",
        "hydrostatic testing",
        "stormwater pipe testing",
        "wastewater pipe testing"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 61,
      "category": "Testing & Quality Assurance",
      "tag_text": "Client to provide all onsite quality tests and ground settlement monitoring as required in the applicable ITPs. (P&I can supply cleggs or scalas where required).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "quality testing",
        "settlement monitoring",
        "ITP testing",
        "Clegg test",
        "Scala testing",
        "Scala penetrometer"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 62,
      "category": "Testing & Quality Assurance",
      "tag_text": "Any nuclear density testing.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "nuclear density testing",
        "NDT compaction testing"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 63,
      "category": "Testing & Quality Assurance",
      "tag_text": "Any subgrade or pavement testing (eg: Benkelman Beam Testing).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "Benkelman Beam",
        "deflection testing",
        "pavement structural testing"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 64,
      "category": "Testing & Quality Assurance",
      "tag_text": "Any testing of concrete quality or strength (MPa).",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "concrete testing",
        "concrete strength testing",
        "MPa testing"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 65,
      "category": "Commercial",
      "tag_text": "Any Contract Bond.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "contract bond",
        "performance bond"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 66,
      "category": "Commercial",
      "tag_text": "Any Liquidated or general damages.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "liquidated damages",
        "LDs",
        "general damages"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 67,
      "category": "Commercial",
      "tag_text": "Any Contracts Works Insurance.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "contract works insurance",
        "CAR insurance",
        "construction all risks"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 68,
      "category": "Commercial",
      "tag_text": "Any Professional Indemnity Insurance.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "professional indemnity insurance",
        "PI insurance"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 69,
      "category": "Commercial",
      "tag_text": "Any night works or works outside of normal working hours, and any associated costs.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "night works",
        "out of hours works",
        "after hours works"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 70,
      "category": "Commercial",
      "tag_text": "Materials Price Escalation - If the duration of the project exceeds the set timeline where we are entitled to Extension of Time, or any other reason out of our control, the price hike (if any) in the material price would be passed onto the client.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "price escalation",
        "materials price escalation",
        "extension of time",
        "EOT"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 71,
      "category": "Commercial",
      "tag_text": "Any change to design specifications or current drawings (or if required by site engineer) would be a variation and/or need to be re-priced. We can provide our Clients with timely assistance and recommendations with regards to best practice & cost-effective construction methodologies, but we are not designers. We shall rely on our clients site engineers/design team/consulting engineers for their decision and confirmation of all design or any changes to design.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "design change",
        "variation",
        "specification change",
        "drawing revision"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 72,
      "category": "Commercial",
      "tag_text": "Pricing is based on organised, non-interrupted work (Mon-Sat), starting from the downstream end and working our way upstream. Works to start at most downstream structure of each section of works \u2013 Where any holdups/downtime are incurred our dayworks/standby rates would apply.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "non-interrupted work",
        "programme sequence",
        "downstream to upstream",
        "holdups",
        "downtime",
        "standby rates"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 73,
      "category": "Commercial",
      "tag_text": "Have made no allowance for delays associated with access restrictions or materials supplied by the client. Daily coordination is required among all the parties.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "access restriction delays",
        "client-supplied material delays",
        "coordination"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 74,
      "category": "Commercial",
      "tag_text": "Completion date is dependant on weather. Any weather related or other delays (not in control of P&I or our direct subcontractors) would add that time onto the end, extending the finish date.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "weather delay",
        "completion date",
        "extension for weather"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 75,
      "category": "Commercial",
      "tag_text": "Unscheduled works or other works required by Client to be charged at our dayworks rates provided.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "unscheduled works",
        "dayworks rate application",
        "additional works"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 76,
      "category": "Commercial",
      "tag_text": "Claimable pipe laid is measured from centre of manhole/structure to centre of manhole/structure.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "pipe measurement",
        "centre to centre measurement",
        "claimable pipe length"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 77,
      "category": "Commercial",
      "tag_text": "Any claimed pipe/structure depths will be from invert level to the existing ground level at the time of laying pipe/structures. Pricing is based on excavation depths as shown on design drawings provided during tender ie: Design finished level to invert level.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "pipe depth measurement",
        "invert level",
        "design finished level"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 78,
      "category": "Commercial",
      "tag_text": "Compaction of existing material: Compaction KPa strength will only be determined by existing clay strength. Without compaction trial results, we are unsure what KPa can be attained with existing material. We have allowed for compacting with an excavator compaction wheel or equivalent. Any equipment or stabilising materials required to meet compaction standards required beyond this would be extra over to our pricing. Have not allowed for drying of backfill material or lime/cement stabilize. Have not allowed for prestart compaction test programme compaction trials.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "compaction of existing material",
        "compaction trial",
        "prestart compaction test",
        "lime stabilise",
        "cement stabilise"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 79,
      "category": "Commercial",
      "tag_text": "We have not allowed to stabilise steep sided gullies, slopes, or historic landslips the pipe alignment may traverse through (e.g by: \n\u2022\tGroundworks to stabilise the slope including hard fill shear keys or installation of in-ground palisade walls;\n\u2022\tSlope groundwater drainage with horizontal drains;\n\u2022\tFlexible and accessible pipe couplings at the landslide margins.",
      "tag_type": "scope_exclusion",
      "trigger_concepts": [
        "slope stabilisation",
        "steep sided gully",
        "landslip",
        "palisade wall",
        "slope drainage",
        "geotechnical slope"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 80,
      "category": "Commercial",
      "tag_text": "DEFECTS LIABILITY: P&I is not responsible for any:  1) Design; 2) Defects or damage in materials that have been procured by the Client, unless caused during installation by P&I; 3) acts or omissions of any other persons or entities (excluding P&I staff and/or direct subcontractors of P&I) resulting in defects/damage of P&I's subcontract works. 4) Maintenance and, improper or lack of maintenance of the works after P&I have completed installation. 5) Natural perils, force majeure. 7) Fair wear and tear of any installed materials.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "defects liability",
        "design responsibility",
        "materials procured by client",
        "force majeure",
        "wear and tear"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 81,
      "category": "Commercial",
      "tag_text": "SEVERE WEATHER & ENVIRONMENTAL: Work area and excavated trenches to be maintained where practical in a severe weather event, but contingency to be paid for severe weather events, and based on actual costs incurred on a case by case basis. Any insurance claims for weather related event to be under Client Contract Works Policy (Natural Perils) and any deductibles/excesses for this are payable by Client. Contractors Contract Works Insurance is to be provided as per Contractors Insurers Policy and to cover Client's Excess for natural perils. All Motor Vehicle and Public Liability insurances are to be covered under Contractors Insurance Policy.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "severe weather",
        "natural perils",
        "contract works policy",
        "weather contingency",
        "insurance excess"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 82,
      "category": "Commercial",
      "tag_text": "We expect to carry out works that can be undertaken safely during wet weather/rain. To do this we require adequate access to site during wet weather conditions via suitable haul roads provided by the client. This will minimise weather related delays as there are many tasks that can be completed safely in the rain, provided adequate access is provided. Also good truck access is critical for vehicles such as tipper trucks, Hiab truck, concrete boom pump truck, concrete trucks, & LV's to be able to use access tracks after rain showers etc.",
      "tag_type": "assumption",
      "trigger_concepts": [
        "wet weather access",
        "haul road access",
        "rain delay access"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 83,
      "category": "Commercial",
      "tag_text": "Defects Notification Period to start at the practical completion of each schedule section, or separable portion of these works. Ie: not at the practical completion of the totality of all P&I\u2019s completed works, and/or not at the practical completion of the client's head contract works.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "defects notification period",
        "DNP",
        "practical completion",
        "separable portion"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 84,
      "category": "Commercial",
      "tag_text": "Schedule rates given are on a measure and value basis.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "measure and value",
        "schedule rates"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 85,
      "category": "Commercial",
      "tag_text": "These tags apply to all our pricing, rates, schedules, programmes given.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "tags apply to all pricing",
        "blanket application"
      ],
      "default_priority": "low",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 86,
      "category": "Commercial",
      "tag_text": "We are not responsible for the work of any other persons or entities (excluding P&I staff and P&I direct subcontractors).",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "responsibility for other contractors",
        "other persons or entities",
        "third party works"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 87,
      "category": "Commercial",
      "tag_text": "No retentions to apply to any Dayworks Rates",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "retentions",
        "dayworks retentions"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 88,
      "category": "Commercial",
      "tag_text": "All payment claims/invoices are a claim under the NZ Construction Contracts Act 2002.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "Construction Contracts Act",
        "CCA 2002",
        "payment claims"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 89,
      "category": "Commercial",
      "tag_text": "Any contract agreement shall be to NZS 3910:2013, Conditions of contract for building and civil engineering \u2013 construction.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "NZS 3910",
        "conditions of contract",
        "contract form"
      ],
      "default_priority": "medium",
      "enabled": true,
      "version": 1
    },
    {
      "tag_number": 90,
      "category": "Commercial",
      "tag_text": "All prices given exclude GST.",
      "tag_type": "commercial_condition",
      "trigger_concepts": [
        "GST",
        "exclusive of GST",
        "prices exclude GST"
      ],
      "default_priority": "high",
      "enabled": true,
      "version": 1
    }
  ],
  "dayworksTags": [
    {
      "tag_number": 1,
      "item_refs": "5.0-9.0",
      "tag_text": "Small Equipment & Tools - If not used, no charge.",
      "trigger_concepts": [
        "small tools",
        "equipment not used",
        "no charge if unused"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 2,
      "item_refs": "1.0-10.0",
      "tag_text": "Stand By Rates - Discount rate used when holdups/downtime/delays are incurred and plant is sitting idle and not being utilised. Normal Day work rate applies for all labour.",
      "trigger_concepts": [
        "standby rate",
        "plant idle",
        "downtime",
        "holdups"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 3,
      "item_refs": "2.0-10.0",
      "tag_text": "All transportation of any Plant is to be at cost plus 15% where required by the client.",
      "trigger_concepts": [
        "plant transport",
        "transportation markup",
        "cost plus percentage"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 4,
      "item_refs": "1.0-10.0",
      "tag_text": "Any extra materials or hire equipment the client would like P&I to purchase on their behalf to be at cost + 15%.",
      "trigger_concepts": [
        "materials markup",
        "hire equipment markup",
        "purchase on client's behalf",
        "cost plus percentage"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 5,
      "item_refs": "4",
      "tag_text": "Hire period on large vehicles commences at the time the equipment leaves P&I's Silverdale depot and is completed when the equipment arrives back at P&I's Silverdale depot.",
      "trigger_concepts": [
        "hire period",
        "depot to depot",
        "large vehicle hire"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 6,
      "item_refs": "1",
      "tag_text": "Staff Training & Endorsements - Staff supplied to have relevant driver licence endorsements (Class 1-5, WTR, F), NZQA Drainlaying/Pipelaying Qualifications and vaccinations. Also staff to have undertaken Mobile Earthmoving Plant Operator Competency Attestations, and attended Constructsafe, Slinging & Lifting, Concrete Saw, Confined Space courses where applicable. All staff to undertake Drug & Alcohol testing to clients requirements and to meet P&I D&A policy.",
      "trigger_concepts": [
        "driver endorsements",
        "NZQA qualification",
        "Constructsafe",
        "confined space training",
        "drug and alcohol testing",
        "staff competency"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 7,
      "item_refs": "1",
      "tag_text": "Night shift Labour to be charged at 1.5x times rates above.",
      "trigger_concepts": [
        "night shift rate",
        "night labour multiplier"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 8,
      "item_refs": "1.0-10.0",
      "tag_text": "All payment claims under the Construction Contracts Act 2002 and is subject to Conditions of Contract applied by Pipeline & Infrastructure (North) Ltd.",
      "trigger_concepts": [
        "Construction Contracts Act",
        "payment claims",
        "conditions of contract"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 9,
      "item_refs": "2.0-9.0",
      "tag_text": "Fuel Escalation - Hire rates including fuel can be renegotiated with any significant move in fuel prices (+ or - 10%).",
      "trigger_concepts": [
        "fuel escalation",
        "fuel price movement",
        "rate renegotiation"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 10,
      "item_refs": "1.0-10.0",
      "tag_text": "No retentions to apply to any Dayworks Rates.",
      "trigger_concepts": [
        "retentions",
        "dayworks retentions"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 11,
      "item_refs": "1.0-10.0",
      "tag_text": "All prices exclude GST.",
      "trigger_concepts": [
        "GST",
        "exclusive of GST"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "medium"
    },
    {
      "tag_number": 12,
      "item_refs": "2.0-4.0",
      "tag_text": "Plant hire rates above EXCLUDE the machine operator/driver unless the line item states otherwise. Where a tender's dayworks schedule requires rates inclusive of the operator, fuel, maintenance, repairs and/or overheads and profit, that is priced from the corresponding \"-WO\" (with operator) item, not the base rate.",
      "trigger_concepts": [
        "rates to include operator",
        "operator inclusive rate",
        "machine operator included",
        "rates including fuel maintenance and operator",
        "on-site overheads included in plant rate",
        "off-site overheads and profit included",
        "with operator rate"
      ],
      "enabled": true,
      "version": 1,
      "default_priority": "high"
    }
  ],
  "dayworksRates": [
    {
      "item_no": "1.1",
      "description": "Project Manager",
      "unit": "per hr",
      "hire_rate": 110,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "1.2",
      "description": "Site Supervisor/Foreman",
      "unit": "per hr",
      "hire_rate": 85,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "1.3",
      "description": "Drainlayer/Tradesman/Carpenter",
      "unit": "per hr",
      "hire_rate": 85,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "1.4",
      "description": "Skilled Labourer/Pipelayer",
      "unit": "per hr",
      "hire_rate": 55,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "1.5",
      "description": "Excavator Operator",
      "unit": "per hr",
      "hire_rate": 60,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "1.6",
      "description": "Operating Foreman",
      "unit": "per hr",
      "hire_rate": 75,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "1.7",
      "description": "Truck Driver",
      "unit": "per hr",
      "hire_rate": 50,
      "standby_rate": null,
      "notes": "Normal Day work rate applies for all labour",
      "operator_included": null
    },
    {
      "item_no": "2.1",
      "description": "Excavator < 2 tonne",
      "unit": "per hr",
      "hire_rate": 55,
      "standby_rate": 47,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.1-WO",
      "description": "Excavator < 2 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.1 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.2",
      "description": "Excavator 2 to 4 tonne",
      "unit": "per hr",
      "hire_rate": 60,
      "standby_rate": 55,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.2-WO",
      "description": "Excavator 2 to 4 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.2 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.3",
      "description": "Excavator > 4 tonne",
      "unit": "per hr",
      "hire_rate": 75,
      "standby_rate": 65,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.3-WO",
      "description": "Excavator > 4 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.3 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.4",
      "description": "Excavator 6-11 tonne",
      "unit": "per hr",
      "hire_rate": 85,
      "standby_rate": 72,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.4-WO",
      "description": "Excavator 6-11 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.4 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.5",
      "description": "Excavator 12-14 tonne",
      "unit": "per hr",
      "hire_rate": 100,
      "standby_rate": 79,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.5-WO",
      "description": "Excavator 12-14 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.5 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.6",
      "description": "Excavator 14-24 tonne",
      "unit": "per hr",
      "hire_rate": 120,
      "standby_rate": 99,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.6-WO",
      "description": "Excavator 14-24 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.6 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.7",
      "description": "Excavator 30-35 tonne",
      "unit": "per hr",
      "hire_rate": 190,
      "standby_rate": 149,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.7-WO",
      "description": "Excavator 30-35 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.7 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.8",
      "description": "Excavator 35-70 tonne",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "notes": "Rate to be established if required",
      "operator_included": null
    },
    {
      "item_no": "2.9",
      "description": "Wheeled Excavator 6 tonne",
      "unit": "per hr",
      "hire_rate": 80,
      "standby_rate": 65,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.9-WO",
      "description": "Wheeled Excavator 6 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.9 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.10",
      "description": "Wheeled Excavator 14 tonne",
      "unit": "per hr",
      "hire_rate": 120,
      "standby_rate": 99,
      "notes": "Rate to be established if required",
      "operator_included": null
    },
    {
      "item_no": "2.11",
      "description": "Excavator Attachment - Compaction Wheel (Sheep Foot Roller attachment)",
      "unit": "per hr",
      "hire_rate": "INCLUDED",
      "standby_rate": null,
      "notes": "Included with Excavators between 12 - 24 tonne",
      "operator_included": null
    },
    {
      "item_no": "2.12",
      "description": "Excavator Attachment - Rock Breaker - 2-70 tonne",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "notes": "Rate to be established if required",
      "operator_included": null
    },
    {
      "item_no": "2.13",
      "description": "Excavator Attachment - Drum Cutter - 14-33 tonne",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "notes": "Rate to be established if required",
      "operator_included": null
    },
    {
      "item_no": "2.14",
      "description": "Excavator Attachment - GPS",
      "unit": "per hr",
      "hire_rate": 25,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "2.15",
      "description": "Loader 5-10 tonne",
      "unit": "per hr",
      "hire_rate": 85,
      "standby_rate": 74,
      "notes": "Standby rate excludes fuel/depreciation/wear & tear etc. Hire rate excludes operator.",
      "operator_included": false
    },
    {
      "item_no": "2.15-WO",
      "description": "Loader 5-10 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 2.15 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "2.16",
      "description": "Loader < 10 tonne (or larger)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "notes": "Rate to be established if required",
      "operator_included": null
    },
    {
      "item_no": "3.1",
      "description": "Site Ute",
      "unit": "per day",
      "hire_rate": 120,
      "standby_rate": 90,
      "notes": "Standby excludes fuel/depreciation/etc & RUC's. Each crew has 1x ute allocated per day on dayworks. Hire rate excludes driver.",
      "operator_included": false
    },
    {
      "item_no": "3.1-WO",
      "description": "Site Ute (WITH operator)",
      "unit": "per day",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 3.1 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "3.2",
      "description": "Small Tipper Truck 2 - 4 tonne",
      "unit": "per hr",
      "hire_rate": 50,
      "standby_rate": 41,
      "notes": "Standby excludes fuel/depreciation/etc & RUC's. Hire rate excludes driver.",
      "operator_included": false
    },
    {
      "item_no": "3.2-WO",
      "description": "Small Tipper Truck 2 - 4 tonne (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 3.2 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "4.1",
      "description": "Tipper Truck - 10 tonne - 6 wheeled Tipper",
      "unit": "per hr",
      "hire_rate": 65,
      "standby_rate": 57,
      "notes": "Standby excludes fuel/depreciation/etc & RUC's. Hire rate excludes driver.",
      "operator_included": false
    },
    {
      "item_no": "4.1-WO",
      "description": "Tipper Truck - 10 tonne - 6 wheeled Tipper (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 4.1 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "4.2",
      "description": "Hydro Excavator - Medium - 6 wheeled Truck",
      "unit": "per hr",
      "hire_rate": 170,
      "standby_rate": 139,
      "notes": "Standby excludes fuel/depreciation/etc & RUC's. Hire rate excludes driver.",
      "operator_included": false
    },
    {
      "item_no": "4.2-WO",
      "description": "Hydro Excavator - Medium - 6 wheeled Truck (WITH operator)",
      "unit": "per hr",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "operator_included": true,
      "notes": "With-operator rate \u2014 not yet established, price per engagement. Base item 4.2 excludes the operator; use THIS item whenever a tender specifies operator-inclusive rates. See Dayworks TAG 12."
    },
    {
      "item_no": "5.1",
      "description": "Trench Shield",
      "unit": "per day",
      "hire_rate": 300,
      "standby_rate": null,
      "notes": "If not used, no charge. Depth typically up to 2.5m, can be stacked for 1.2-10m depths.",
      "operator_included": null
    },
    {
      "item_no": "5.2",
      "description": "Hydraulic Trench Shoring (20m trench length)",
      "unit": "per day",
      "hire_rate": 750,
      "standby_rate": null,
      "notes": "If not used, no charge. Depth typically up to 2.5m, can be stacked for 1.2-10m depths.",
      "operator_included": null
    },
    {
      "item_no": "5.3",
      "description": "Hydraulic Shoring Ram each (includes feet, shoring pump, hoses)",
      "unit": "per day",
      "hire_rate": 30,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "5.4",
      "description": "Slide Rail Shoring",
      "unit": "per day",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": null,
      "operator_included": null
    },
    {
      "item_no": "6.1",
      "description": "Trench Rammer - Jumping Jack",
      "unit": "per day",
      "hire_rate": 95,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "6.2",
      "description": "Plate Compactor - 54kg",
      "unit": "per day",
      "hire_rate": 95,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "6.3",
      "description": "Plate Compactor - 100kg",
      "unit": "per day",
      "hire_rate": 120,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "6.4",
      "description": "Plate Compactor - 400-550kg",
      "unit": "per day",
      "hire_rate": 120,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "6.5",
      "description": "Plate Compactor - 550-800kg",
      "unit": "per day",
      "hire_rate": 180,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "6.6",
      "description": "Clegg Hammer",
      "unit": "per day",
      "hire_rate": 100,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "7.1",
      "description": "4\" Dewatering Pump and Well Pointing Gear",
      "unit": "per day",
      "hire_rate": 600,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "7.2",
      "description": "6\" Bypass Pump (with 10m suction hose & 100m delivery hose)",
      "unit": "per day",
      "hire_rate": 600,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "7.3",
      "description": "2\" Flexi Drive Pump & Hoses",
      "unit": "per day",
      "hire_rate": 110,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "7.4",
      "description": "2\" Submersible Electric Pump & Hoses",
      "unit": "per day",
      "hire_rate": 110,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "7.5",
      "description": "3\" Trash Pump & Hoses",
      "unit": "per day",
      "hire_rate": 135,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "8.1",
      "description": "Concrete Saw",
      "unit": "per day",
      "hire_rate": 125,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "8.2",
      "description": "Pipe Laser",
      "unit": "per day",
      "hire_rate": 110,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "8.3",
      "description": "Laser Level (Dumpy/Rotating Level)",
      "unit": "per day",
      "hire_rate": 110,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "8.4",
      "description": "Small Compressor",
      "unit": "per day",
      "hire_rate": 100,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "8.5",
      "description": "Pipe Plugs (sizes 100mm to 1200mm available) and air regulator gauge",
      "unit": "per day",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "If not used, no charge. Rate established on size of plug required.",
      "operator_included": null
    },
    {
      "item_no": "8.6",
      "description": "Confined Space Gear - Tripod, Harnesses, & Gas Detector",
      "unit": "per day",
      "hire_rate": 200,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "8.7",
      "description": "CCTV - Manhole Inspection Pole Camera, LCD Display Unit & Recording",
      "unit": "per day",
      "hire_rate": 200,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "9.1",
      "description": "5kva Generator",
      "unit": "per day",
      "hire_rate": 120,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "9.2",
      "description": "20kva Generator",
      "unit": "per day",
      "hire_rate": 179,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "9.3",
      "description": "Electric Tools - Kango/Dyna Drill/Power Drill/Skill Saw/Grinder",
      "unit": "per day",
      "hire_rate": 60,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "9.4",
      "description": "PE Pipe Welder",
      "unit": "per day",
      "hire_rate": 150,
      "standby_rate": null,
      "notes": "If not used, no charge.",
      "operator_included": null
    },
    {
      "item_no": "10.1",
      "description": "Transport of Construction Plant to Site - 8 Wheeler Transporter (3-14 tonne plant)",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": null,
      "operator_included": null
    },
    {
      "item_no": "10.2",
      "description": "Transport of Construction Plant to Site - Low Boy Transporter (14-24 tonne plant, no traffic pilot)",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": null,
      "operator_included": null
    },
    {
      "item_no": "10.3",
      "description": "Transport of Construction Plant to Site - Low Boy Transporter < 24 tonne (or larger) plant requiring traffic pilot",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": "TBA",
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.4",
      "description": "Site Storage Container - Establishment/Disestablishment",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.5",
      "description": "Extra Hire Equip",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.6",
      "description": "Propping Hire - Extra Hire Equip",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.7",
      "description": "Formwork Hire - Extra Hire Equip",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.8",
      "description": "Extra over Materials",
      "unit": "each",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.9",
      "description": "Tipping fees - clean fill",
      "unit": "per m3",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.10",
      "description": "Tipping fees - unsuitable fill",
      "unit": "per m3",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    },
    {
      "item_no": "10.11",
      "description": "Tipping fees - Disposal of Rock or Concrete",
      "unit": "per m3",
      "hire_rate": "TBA",
      "standby_rate": null,
      "notes": "Rate to be established if required.",
      "operator_included": null
    }
  ]
}
