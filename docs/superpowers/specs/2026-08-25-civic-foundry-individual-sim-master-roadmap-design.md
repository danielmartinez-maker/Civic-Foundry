# Civic Foundry — Full Individual Sim Master Roadmap

## Status

Approved direction in chat on 2026-08-25.

This specification extends and supersedes the human-simulation assumptions in `2026-08-24-civic-foundry-2.0-master-design.md`. The physical, economic, land, infrastructure, governance and regional ambitions of that design remain in force unless explicitly replaced here.

The decisive architectural change is that **every resident inside the detailed playable simulation is one persistent individual Sim**. Weighted population cohorts may still be used outside the detailed region for regional aggregates, but they may not stand in for residents who are counted as living inside the playable city.

This is a progressive replacement program. Existing V7 behavior remains available behind compatibility boundaries until each replacement passes determinism, persistence, migration, performance and simulation-quality gates.

---

# 1. Product ambition

Civic Foundry becomes a city-scale life, economic, infrastructure and political simulator in which the city is produced by the interaction of individual lives, households, firms, institutions, land markets, networks and government.

The intended causal chain becomes:

individual people
→ families and households
→ schedules and activities
→ education, work, consumption and relationships
→ trips and service demand
→ firms and institutions
→ land and real-estate demand
→ transportation and infrastructure load
→ neighborhood outcomes
→ health, wealth and opportunity
→ public opinion and politics
→ policy and investment
→ changed life outcomes for the same persistent people and their descendants.

The player must be able to inspect both citywide outcomes and the specific lives that produced them.

A person who exists in the population is not merely a statistic. They have an identity, household, family relationships, personal history, motivations, current activity, schedule, education/employment state, financial circumstances, health state, mobility access and evolving relationships.

---

# 2. New non-negotiable individual-Sim invariants

These invariants are added to the existing determinism, conservation, causality, persistence and domain-ownership rules.

1. **One resident, one Person.** Every resident counted inside the detailed simulation corresponds to exactly one persistent `PersonId`.
2. **Population is derived.** Detailed-city population is the count of living resident `Person` entities, not an independently mutable scalar.
3. **No synthetic workers.** Employment totals must reconcile to actual employed people and actual jobs.
4. **No synthetic students.** Enrollment totals must reconcile to actual students and actual institutions.
5. **No synthetic travelers.** Every passenger or traveler originating inside the detailed city must trace to an actual `PersonId`; weighted traveler cohorts are prohibited for those residents.
6. **No synthetic voters.** Eligible-voter and turnout counts must reconcile to actual adult residents.
7. **No synthetic household occupancy.** Every occupied housing unit must contain actual household members, and every housed resident must resolve to an actual unit/home.
8. **Family integrity.** Parent, child, sibling, partner and household relationships must reference valid people and obey deterministic consistency rules.
9. **Schedule causality.** Routine personal trips are generated from actual scheduled activities, not directly from citywide population multipliers.
10. **Backstory provenance.** Simulated history is never fabricated after the fact. New-game bootstrap biographies may contain deterministically generated pre-simulation background marked as bootstrap provenance; all post-start life history is event-derived.
11. **Persistent identity under optimization.** Rendering culling, low-frequency scheduling or sleeping inactive entities may reduce computation but may never merge, delete or replace a resident's identity.
12. **Life-event conservation.** Birth, death, migration, marriage/partnership changes, household formation and dissolution must reconcile population and family state.
13. **Bounded memory, persistent consequence.** Sims may compress low-salience memories for performance, but important consequences and life-history facts remain persistent and queryable.
14. **Decisions are contextual.** Major personal decisions must be based on the Sim's real constraints, knowledge, motivations and relationships rather than hidden global scores.
15. **Explainable person behavior.** Important decisions expose a concise causal explanation built from actual decision inputs.

---

# 3. Simulation scale and performance model

The human simulation is designed around **persistent identity with event-driven execution**, not frame-by-frame AI for every person.

Target scale:

- 100,000 persistent individual residents: mandatory acceptance tier for the mature person engine.
- 250,000–500,000 persistent residents: normal large-city target.
- 1,000,000 persistent residents: architecture/stress target for authoritative identity, save/load and event scheduling.

These are performance targets, not permission to weaken simulation invariants.

The runtime uses three activity states:

### Active

High-frequency updates when sequence materially matters:

- walking or driving;
- riding or waiting for transit;
- active emergency exposure;
- time-sensitive institutional interaction;
- location-sensitive social activity;
- evacuation or disaster response.

### Scheduled

The person has an authoritative next event and does not need per-tick decision work:

- sleeping;
- working a stable shift;
- attending class;
- remaining at home;
- routine leisure;
- inpatient treatment where no new decision is due.

### Dormant-but-persistent

Long-horizon state is retained while only milestone events are scheduled:

- residents away from the detailed map but still legally/socially attached;
- long-term institutional residence where appropriate;
- low-frequency life-stage processes.

Dormancy is computational only. The Person entity remains real and inspectable.

The event scheduler must support millions of future personal events without scanning all residents every tick. Scheduling should be keyed by simulation time and deterministic sequence order.

---

# 4. Core individual-Sim data model

The exact TypeScript shape is implementation-plan work, but the authoritative domains are fixed by this design.

## 4.1 Person identity

Each person owns or references:

- stable `PersonId`;
- legal/display name generated from cultural naming data;
- date of birth;
- sex and other demographic attributes required by simulation systems;
- alive/deceased state;
- resident/nonresident status;
- citizenship/residency status where scenarios require it;
- birthplace;
- migration origin;
- current household;
- current home;
- current activity;
- current physical location or authoritative location state;
- life-stage state.

## 4.2 Family graph

The family graph supports:

- biological/adoptive parents;
- children;
- siblings derived consistently from parentage;
- partners/spouses;
- former partners;
- guardians/dependents;
- multigenerational family links;
- inheritance relationships;
- household membership distinct from biological/legal family.

Family relationships persist across moves and household splits.

## 4.3 Personality and motivation

Each Sim has a bounded profile rather than an unrestricted language-model persona.

Motivation dimensions include at minimum:

- financial security;
- career advancement;
- family stability;
- education/skill growth;
- homeownership preference;
- housing quality;
- neighborhood attachment;
- commute aversion;
- safety preference;
- health priority;
- leisure preference;
- social connection;
- status/achievement;
- environmental preference;
- civic/political engagement;
- risk tolerance;
- change tolerance.

Personality and motivation weights influence decisions but do not directly force outcomes. Budget, geography, availability, institutions and relationships constrain choices.

## 4.4 Life history

Every person accumulates structured life events such as:

- birth;
- migration;
- household formation/dissolution;
- home moves;
- school enrollment/graduation/dropout;
- job applications, hiring, promotion, layoff and retirement;
- relationship formation/separation;
- marriage or equivalent partnership events;
- births/adoptions of children;
- major illness or injury;
- home purchase/sale;
- eviction/displacement;
- crime victimization where simulated;
- disaster exposure;
- major financial distress or windfall;
- political/civic participation;
- death.

The history store must distinguish:

- `bootstrap_background`: deterministic pre-simulation biography used to initialize a plausible resident;
- `simulated_event`: event that actually occurred after the simulation start/migration point;
- `imported_fact`: fact migrated from an older save when explicitly supported by old authoritative data.

## 4.5 Memory

Memory is structured and bounded.

High-salience memories may include:

- job loss;
- promotion;
- rent increase;
- eviction/displacement;
- home purchase;
- birth/death in close family;
- crime exposure;
- severe congestion/repeated lateness;
- transit failure;
- successful transit access;
- school success/failure;
- hospital wait or successful treatment;
- flood/fire/disaster damage;
- policy benefit or policy harm;
- neighborhood improvement/decline.

Memory affects future preferences, trust, satisfaction, political opinion and bounded decision-making. Low-salience repeated events may compress into rolling experience summaries.

## 4.6 Household state

A household owns or references:

- `HouseholdId`;
- member PersonIds;
- dependents;
- home/unit;
- tenure;
- shared cash/savings where appropriate;
- recurring expenses;
- vehicles;
- debts/mortgages;
- household decision structure;
- childcare/caregiving obligations;
- housing preferences;
- migration/move status.

Households are real social/economic units, not population buckets.

## 4.7 Schedule and activity state

Every resident maintains an adaptive daily/weekly activity plan containing commitments and flexible activities.

Possible activity classes include:

- sleep;
- work;
- school/university/training;
- commute/travel;
- meals;
- shopping;
- healthcare;
- childcare;
- eldercare;
- government/administrative errands;
- exercise;
- recreation;
- social visits;
- religious/community activity;
- volunteering;
- job search;
- study/homework;
- household maintenance;
- tourism/entertainment;
- emergency/disaster response.

Schedules respond to:

- weekday/weekend;
- work shift;
- school timetable;
- household obligations;
- travel times;
- transit schedules;
- congestion;
- health;
- income/budget;
- weather/environment;
- personal preferences;
- disruptions;
- life events.

## 4.8 Employment and education

Every employed person references an actual employer/job position. Every student references an actual educational institution/program when enrolled.

Individual state includes, as applicable:

- occupation;
- employer;
- wage/salary;
- work location;
- shift;
- job tenure;
- skills;
- unemployment duration;
- job-search state;
- educational attainment;
- current institution;
- program/grade stage;
- attendance;
- performance/attainment state.

## 4.9 Health and aging

Individual health state includes enough information to drive service use and life outcomes without becoming a medical diagnosis simulator.

Potential domains include:

- age-related baseline health;
- acute illness/injury state;
- chronic-risk burden;
- disability/mobility limitation where relevant;
- healthcare access;
- treatment state;
- stress/wellbeing proxies;
- mortality risk;
- pregnancy/reproductive lifecycle where required by demographic simulation.

## 4.10 Personal and household economics

Individual/household financial state may include:

- wages and transfers;
- recurring living costs;
- rent/mortgage;
- savings;
- debt;
- vehicle costs;
- taxes;
- insurance where modeled;
- consumption budget;
- housing affordability;
- wealth/assets;
- inheritance.

Material transfers must reconcile through the EconomicLedger where the corresponding economic domain is active.

---

# 5. Decision architecture

Sims do not run unconstrained general-purpose AI.

Major decisions use bounded deterministic decision models with:

1. current state and constraints;
2. known/available options;
3. motivation/personality weights;
4. household and family obligations;
5. recent memories/experience summaries;
6. affordability and time constraints;
7. accessibility and geography;
8. deterministic stochasticity from the person's named RNG stream where required;
9. inertia/habit/switching costs;
10. explainable scoring or rule trace.

Examples include:

- whether to move;
- which available home to choose;
- whether to search for a job;
- which job offer to accept;
- whether to change travel mode;
- where to shop;
- school/program choice;
- whether to buy a vehicle;
- household formation/separation decisions;
- migration into/out of the city;
- political turnout/support where later phases enable it.

The player-facing inspector may show concise explanations such as:

`Moved from Riverside to Central East`\n
- rent burden fell 11 percentage points;
- commute fell 19 minutes;
- school access improved;
- move increased distance from parents;
- household ranked the option highest after affordability and family constraints.

---

# 6. Backstory generation

Every newly initialized adult or child receives a coherent deterministic bootstrap biography appropriate to age, household and scenario.

Backstory generation may establish:

- birthplace;
- parental/family relationships;
- childhood household context;
- education completed before simulation start;
- prior occupation/employment category;
- previous residence region;
- migration reason category;
- relationship status;
- major prior-life background facts needed to make initial state coherent.

Bootstrap biography is **not represented as simulated history**. It is provenance-tagged background. From simulation start onward, all history is event-derived.

New births require no generated backstory because their entire life occurs inside the simulation.

Over long games, the proportion of residents with fully simulated histories should rise naturally as generations are born, age and replace the bootstrap population.

---

# 7. Generational simulation

Civic Foundry is designed to support multi-decade and century-scale cities.

The human engine therefore includes:

- aging;
- fertility and births;
- adoption/guardianship where supported;
- leaving the parental household;
- household formation;
- partnership and separation;
- education progression;
- career progression;
- retirement;
- caregiving;
- inheritance/estate transfer;
- mortality;
- in-migration and out-migration.

Multi-generational outcomes become emergent.

Examples:

- school investment changes educational attainment and lifetime earnings decades later;
- housing scarcity delays household formation and childbearing;
- pollution exposure affects health outcomes;
- inaccessible job growth increases unemployment for specific neighborhoods;
- inherited housing wealth compounds across generations;
- displacement can break social networks and alter descendant outcomes;
- transit investment can improve access to education and employment across a family line.

---

# 8. Revised master roadmap

The former single later-stage household/demographic phase is replaced with an earlier Human Simulation Program. Transportation, services, economy and politics are then rebuilt to consume real individual people.

## PHASE 0 — Foundry Kernel & Identity Infrastructure

Status: already partially implemented through 0A/0B work.

Retain the SimulationKernel, deterministic scheduler, commands, events, RNG registry, EntityRegistry, SpatialIndex, ledger, history and causality systems.

Extend the kernel requirements to support:

- stable `PersonId`, `HouseholdId` and family relationship references;
- high-volume future-event scheduling;
- per-person or person-derived deterministic RNG namespaces;
- efficient person-domain snapshots;
- identity-preserving save/load;
- person and household invariant checking.

Acceptance additions:

- one million dormant/scheduled Person identities can be indexed without identity corruption;
- event ordering remains deterministic across save/load;
- no orphan household/family/person references;
- population is derivable from person state once the Personhood phase becomes authoritative.

## PHASE 1R — World Foundation 2.0

Retain the approved geography, terrain, hydrology, irregular geometry and seeded world-generation program.

Human-simulation addition:

- geography must provide stable home, activity and administrative locations for Person entities;
- migration origins/destinations and regional context must be addressable by stable region identifiers.

## PHASE 2R — Urban Fabric 2.0

Retain true parcels, zoning envelopes, mixed-use buildings, lifecycle, deterioration, renovation, redevelopment and land assembly.

Human-simulation addition:

- residential units become explicit occupancy targets;
- household occupancy must resolve to real units or explicitly modeled nonstandard housing states;
- mixed-use buildings must support distinct resident, worker, customer and visitor populations.

---

# HUMAN SIMULATION PROGRAM

## PHASE 3R — Personhood Core

Create the authoritative `Person` domain.

Implement:

- stable person identity;
- demographics;
- resident/nonresident state;
- alive/deceased state;
- home/household references;
- location/current-activity state;
- deterministic new-game population bootstrap;
- V7 aggregate-population migration into explicit residents;
- population derivation from people;
- person inspector foundation.

Migration from V7 must preserve known totals and housing allocation constraints. It may create deterministic bootstrap people but must not claim unsimulated pre-migration events as observed historical events.

Acceptance:

- every detailed-city resident maps to exactly one Person;
- no duplicate PersonIds;
- save/load reproduces people byte-equivalently where serialization order is defined;
- population totals reconcile exactly;
- person creation/removal occurs only through explicit demographic/migration events.

## PHASE 4R — Families & Households

Create actual family and household structures.

Implement:

- parent/child graph;
- sibling derivation;
- partnership/spouse relationships;
- guardians/dependents;
- household membership;
- household formation and dissolution;
- multigenerational households;
- leaving-home logic;
- household moves as group decisions;
- family-aware migration.

Acceptance:

- family references are bidirectionally consistent where required;
- children cannot belong to nonexistent guardians/households;
- household member counts reconcile to people;
- moves conserve household membership and occupancy;
- family graphs survive save/load exactly.

## PHASE 5R — Life History, Memory, Personality & Motivation

Give each person persistent personal context.

Implement:

- deterministic bootstrap biography;
- structured life-event history;
- bounded memory system;
- personality/motivation profile;
- experience summaries;
- individual satisfaction/priority state;
- explainable preference formation.

Acceptance:

- two otherwise similar people with materially different motivations can make different deterministic choices under the same option set;
- memories derive only from real events after simulation start;
- low-salience memory compression cannot alter protected life-history facts;
- life history remains inspectable after decades of simulation.

## PHASE 6R — Daily Life & Activity Scheduling

Replace population-multiplier trip generation with person schedules.

Implement:

- daily/weekly schedules;
- fixed commitments;
- flexible activities;
- work/school shifts;
- sleep;
- meals;
- errands;
- shopping;
- leisure;
- social visits;
- childcare/caregiving;
- healthcare appointments;
- schedule adaptation after delays/disruptions;
- next-event execution architecture.

Acceptance:

- every routine personal trip has an originating scheduled activity;
- no person may be in two mutually exclusive activities simultaneously;
- travel time changes can alter later activities and lateness;
- sleeping/stable persons do not require per-tick AI evaluation;
- schedule execution is deterministic.

## PHASE 7R — Social Networks & Relationships

Add persistent interpersonal networks beyond household/family.

Implement:

- friendships;
- coworkers;
- classmates;
- neighbors;
- community/religious/civic ties;
- relationship strength;
- trust/conflict state;
- contact frequency;
- social influence;
- relationship formation/decay;
- social-network effects on moves, jobs, wellbeing and politics.

Acceptance:

- social edges reference valid people;
- relocation can measurably alter contact/access to social ties;
- repeated interaction can strengthen relationships;
- long inactivity can weaken eligible ties without deleting protected family relationships.

## PHASE 8R — Education, Skills & Human Capital

Replace aggregate student counts with individual education trajectories.

Implement:

- school-age progression;
- actual enrollment;
- attendance;
- capacity and assignment;
- school travel;
- performance/attainment;
- graduation/dropout;
- vocational training;
- university/postsecondary paths;
- skill acquisition;
- educational prerequisites for occupations.

Acceptance:

- every enrolled seat maps to a Person;
- school capacity cannot be exceeded without explicit overcrowding state;
- educational attainment persists into labor-market decisions;
- access, quality, household circumstances and attendance influence outcomes.

## PHASE 9R — Careers, Jobs & Labor Lives

Replace aggregate workforce matching with person-to-job matching.

Implement:

- labor-force participation;
- individual job search;
- applications/offers;
- employer hiring;
- occupation/skill matching;
- wage offers;
- job tenure;
- promotions;
- layoffs/firing/firm closure effects;
- unemployment duration;
- career switching;
- retirement;
- work shifts and workplace locations.

Acceptance:

- employed count equals actual employed people;
- occupied jobs equal actual worker-position relationships;
- firm closure releases specific workers;
- wages flow to actual people/households;
- commute originates from actual home-work pairs.

## PHASE 10R — Household Economy, Consumption & Wealth

Make households financially persistent.

Implement:

- wages/transfers;
- rent/mortgage payments;
- savings;
- consumer debt;
- vehicle expenses;
- taxes;
- recurring household budget;
- discretionary consumption;
- emergency financial buffers;
- financial distress;
- wealth/assets;
- purchase decisions;
- household-level affordability.

Acceptance:

- material household money flows reconcile through the ledger;
- consumption cannot exceed available resources without explicit debt/arrears mechanisms;
- job loss affects actual household budgets;
- housing and mobility decisions react to household finances.

## PHASE 11R — Health, Aging & Mortality

Create persistent health and life-course state.

Implement:

- aging;
- baseline health;
- acute illness/injury;
- selected chronic-risk processes;
- healthcare seeking;
- treatment and recovery;
- disability/mobility impacts where modeled;
- stress/wellbeing proxies;
- pregnancy/birth pipeline where required;
- mortality;
- cause-linked health risks from environment, crashes and access.

Acceptance:

- every patient is an actual person;
- deaths remove people from living population while preserving historical identity;
- health state affects schedules and service demand;
- births create new Person entities linked to valid family/household state.

## PHASE 12R — Generations, Inheritance & Long-Horizon Life Course

Make century-scale demographic continuity a first-class system.

Implement:

- household generational transitions;
- leaving home;
- family formation;
- fertility timing;
- inheritance/estate transfer;
- intergenerational wealth;
- caregiving obligations;
- long-run education/health/income mobility;
- descendant links;
- generational analytics.

Acceptance:

- inheritance conserves modeled assets/liabilities;
- family trees remain valid over multiple generations;
- long-run outcomes can be traced across parent/child generations;
- no aggregate population injection bypasses person creation/migration.

---

# CITY SYSTEMS REBUILT AROUND ACTUAL PEOPLE

## PHASE 13R — Transportation Engine 2.0

Retain the lane-aware road hierarchy, turn movements, signals, dynamic routing, parking, crashes and disruption goals.

Individual-Sim additions:

- every personal road trip references a PersonId;
- route choice uses that person's schedule, vehicle access, time value, parking access, toll sensitivity and learned experience;
- crashes can affect actual occupants and schedules;
- parking occupancy arises from actual arriving vehicles/users.

## PHASE 14R — Mobility & Transit 2.0

Retain walking, cycling, car, taxi/ride-hail, bus, trolleybus, BRT, tram, metro, commuter rail, regional rail and ferry goals.

Individual-Sim additions:

- each passenger is an actual person;
- boarding/alighting updates actual location/activity state;
- missed connections can cause individual lateness;
- mode preference may evolve from repeated experience;
- accessibility constraints can differ by person;
- household vehicle ownership constrains car availability.

## PHASE 15R — Civic Institutions 2.0

Rebuild services around actual residents and staff.

Healthcare:

- actual patients, clinicians, queues, beds and treatment episodes.

Education:

- actual students, teachers, classes and enrollment.

Police/fire/EMS:

- actual incident victims/callers when applicable;
- actual staffing rosters when institutional workforce simulation is enabled.

Waste and public works:

- demand arises from actual households/buildings and routed operations.

## PHASE 16R — Economy 2.0

Retain a configurable urban/regional input-output economy, firms, inventories, production, freight and trade.

Individual-Sim additions:

- wages flow to actual employees;
- customers/consumer demand originate from actual household budgets;
- labor availability derives from real residents and skills;
- firm location decisions interact with actual workforce accessibility;
- unemployment and wage pressure emerge from person-job matching.

## PHASE 17R — Real Estate Capitalism 2.0

Retain ownership, listings, transactions, development finance, mortgages, rent/sale clearing and construction constraints.

Individual-Sim additions:

- households are actual buyers/renters;
- mortgage qualification uses real household income/wealth/debt;
- eviction/displacement affects actual families;
- moving updates every household member's schedule, commute, school and social accessibility;
- homeownership creates actual household wealth exposure.

## PHASE 18R — Metropolitan Infrastructure Networks

Retain explicit power, water, sewer, telecom and major-infrastructure networks.

Individual-Sim additions:

- outages affect actual households, workplaces, schedules and service access;
- reliability experience feeds memory/satisfaction where relevant;
- infrastructure inequality can be measured across people and households.

## PHASE 19R — Environment & Climate

Retain air pollution, water quality, noise, heat, energy, emissions, rainfall, drought, flooding, wildfire exposure, tree cover and resilience.

Individual-Sim additions:

- exposure is location/time dependent for actual people;
- health and schedule effects accumulate from real exposure;
- household adaptation/migration may respond to repeated hazards;
- disaster displacement preserves actual family and housing histories.

## PHASE 20R — Municipal Government & Finance

Retain fund accounting, operating/capital budgets, taxes, fees, grants, bonds, debt service, credit quality, pensions, maintenance backlog and capital planning.

Individual-Sim additions:

- household taxes/fees link to actual households where modeled;
- municipal employment can involve actual workers;
- policy distributional effects can be measured on actual people.

## PHASE 21R — Politics, Public Opinion & Civic Life

Build politics from residents' actual circumstances.

Implement:

- voter eligibility;
- registration rules where scenario-appropriate;
- turnout propensity;
- issue priorities;
- policy approval;
- neighborhood organizations;
- civic groups;
- demonstrations/meetings where modeled;
- mayoral elections;
- council districts;
- ballot questions;
- political coalitions;
- political feasibility.

Opinions may respond to:

- taxes;
- housing costs;
- commute experience;
- services;
- crime/safety;
- school quality;
- employment;
- neighborhood change;
- displacement;
- environment;
- social-network influence;
- personal memories;
- values/motivations.

Acceptance:

- election totals reconcile to actual eligible voters and ballots;
- political opinion cannot be manufactured by the UI;
- issue attitudes expose causal contributors;
- district results reconcile to resident geography.

## PHASE 22R — Planning Law

Retain zoning maps, FAR/height/setback rules, mixed use, parking rules, historic overlays, environmental review, impact fees, inclusionary rules, density bonuses and transferable development rights.

Individual-Sim additions:

- public hearings/support/opposition may involve actual residents, owners and organizations;
- displacement and accessibility impacts can be computed on affected people;
- development-code reform changes household and firm choices through actual market effects.

## PHASE 23R — Construction & Megaprojects

Retain design, engineering, land acquisition, procurement, contractor mobilization, construction stages, work zones, budgets, schedules, delays and cost overruns.

Individual-Sim additions:

- construction hires actual workers where labor simulation applies;
- work zones disrupt actual trips;
- displacement affects actual households/businesses;
- megaproject benefits/costs become inspectable at person and neighborhood level.

## PHASE 24R — Regional Simulation

Retain neighboring municipalities, external housing/labor markets, regional transport, freight gateways, ports/airports, tourism and intermunicipal flows.

Inside the detailed playable region, every resident remains explicit.

Outside it, Tier-C aggregates may remain for scale. Crossing the detailed-region boundary promotes/demotes entities through deterministic migration/visitor representations without duplicating population.

Long-term in-migrants become full Person entities with bootstrap provenance appropriate to their origin and age.

## PHASE 25R — Agglomeration, Institutions & City Identity

Retain endogenous economic clusters such as manufacturing, logistics, technology, finance, universities/research, tourism/culture and energy.

Individual-Sim additions:

- specialization changes career opportunities and skill formation;
- migration responds to real opportunity structures;
- city identity emerges partly from resident composition, institutions and generational history.

## PHASE 26R — Social Outcomes & Human Development

Model inequality, poverty, housing burden, displacement, homelessness, segregation, educational attainment, health outcomes, social mobility and crime risk as consequences experienced by actual people.

Add:

- intergenerational mobility;
- wealth distribution;
- access inequality;
- opportunity mapping;
- life-expectancy/health disparities where model scope supports them;
- educational mobility;
- neighborhood persistence/churn;
- family disruption from housing/economic shocks.

Citywide metrics are derived from individual outcomes.

## PHASE 27R — Institutional Decision Systems

Major non-player institutions use bounded deterministic decision models.

Actors may include:

- households;
- firms;
- developers;
- lenders;
- schools/universities;
- healthcare systems;
- transit agencies;
- utilities;
- municipal departments;
- neighborhood organizations;
- political actors.

Household decisions must reflect the actual members and motivations inside the household rather than a generic representative household.

## PHASE 28R — City Analytics, Explainability & Life Explorer

Expand the urban observatory into both macro and micro explainability.

Player capabilities include:

- inspect any Sim;
- inspect household/family tree;
- view current activity and day's schedule;
- view home, workplace/school and regular destinations;
- view income/wealth/housing burden;
- view motivations/preferences;
- view recent high-salience memories;
- view life timeline;
- view social/family connections with privacy-appropriate abstraction inside the game design;
- ask why the Sim moved, changed jobs, changed modes, missed school/work, became dissatisfied or supported/opposed a policy;
- follow cohorts defined by actual people without replacing them with authoritative cohorts;
- trace intergenerational outcomes.

Macro dashboards must reconcile to underlying people wherever the metric is person-derived.

## PHASE 29R — Scenarios, Editor, Replay & Modding

Make safe definitions data-driven and expose scenario/editor tooling.

Add support for:

- demographic scenarios;
- starting-family generation rules;
- cultural/naming datasets;
- occupation/education definitions;
- motivation/personality distributions;
- schedule archetypes used only as initial templates;
- policy scenarios;
- disasters;
- migration shocks;
- long-horizon replay;
- deterministic save comparison;
- modded life events under strict schema/invariant rules.

Mods may add behaviors and definitions but may not bypass person identity, conservation, determinism or authoritative-domain rules.

---

# 9. Removal of weighted resident cohorts inside the detailed city

The previous master design allowed Tier-B weighted agents for households, workers, students and travelers. That rule is superseded for detailed-city residents.

New fidelity model:

### Tier A — Persistent explicit city entities

Includes:

- every resident Person;
- every household;
- buildings/parcels;
- active vehicles where required;
- transit/service vehicles;
- incidents;
- projects;
- firms and facilities at the fidelity defined by their phases.

A Person may be computationally scheduled or dormant, but remains individually authoritative.

### Tier B — Derived analytical groupings

Cohorts may still be created for:

- dashboards;
- statistics;
- batched read-only analysis;
- sampling for UI presentation;
- optimization caches whose results reconcile back to individual entities.

A Tier-B cohort may never own population, employment, enrollment, housing occupancy, voting or personal travel demand.

### Tier C — External regional aggregates

Still permitted outside the detailed region for:

- external population pools;
- neighboring municipalities;
- regional labor/housing supply;
- macro conditions;
- regional migration pressure;
- external freight/finance.

When an external person becomes a resident of the detailed city, a persistent Person entity is created through a deterministic migration process.

---

# 10. Save, replay and migration requirements

The individual-Sim architecture substantially increases save complexity.

Required properties:

- stable IDs across save/load;
- canonical serialization order;
- versioned schemas;
- family graph integrity;
- scheduled-event persistence;
- bounded memory serialization;
- life-history persistence;
- no duplicated people after migration;
- no orphan PersonIds;
- deterministic restoration of RNG streams;
- derived caches rebuildable without changing authoritative outcomes.

V7 migration must convert aggregate population/housing state into a deterministic explicit population at the migration boundary.

Because old saves do not contain individual histories, migration must not pretend otherwise. Migrated residents receive provenance-tagged bootstrap background sufficient to initialize age, household, family, education and employment distributions consistent with known V7 state. Their genuine simulated histories begin at the migration timestamp.

---

# 11. Performance acceptance program

The human simulation requires dedicated benchmarks in addition to ordinary gameplay tests.

Benchmarks should include:

- 100k-person idle/scheduled city;
- 100k-person rush hour;
- 250k-person mixed daily activity;
- 500k-person large-city schedule rollover;
- 1M-person identity/save/index stress test;
- family graph queries;
- mass school/work schedule transitions;
- migration wave;
- disaster evacuation activation;
- save/load and replay equivalence;
- multi-decade simulation without memory/history growth becoming unbounded.

Performance optimizations may include:

- event queues;
- structure-of-arrays or compact domain stores where profiling justifies them;
- spatial partitioning;
- hot/cold state separation;
- cached read models;
- batched deterministic queries;
- activity-state promotion/demotion;
- bounded memory compression;
- incremental statistics.

Optimizations may not merge residents into authoritative weighted cohorts.

---

# 12. Testing requirements

Every Human Simulation phase requires:

- deterministic unit tests;
- save/load equivalence tests;
- person/household conservation tests;
- referential-integrity tests;
- multi-generation invariants where relevant;
- performance regression evidence;
- migration tests;
- scenario tests;
- negative tests for invalid family/household state;
- replay tests for important life events.

Cross-system tests must prove causal continuity, for example:

- household moves → changed school/commute routes;
- firm closure → specific workers unemployed → household budget stress → housing-search pressure;
- new transit line → changed mode choice for actual residents → changed accessibility → changed job/housing choices;
- school investment → changed individual attainment → later labor outcomes;
- flood → specific household displacement → temporary housing/commute disruption → recovery or out-migration;
- tax/policy change → household distributional effects → individual political response.

---

# 13. Player experience target

The simulation should support stories that are inspectable rather than scripted.

Example:

A player inspects one resident and can see that she:

- was born in a different region;
- moved to the city with her parents;
- attended a specific local school;
- formed persistent friendships there;
- trained for a skilled occupation;
- works at a specific employer on a specific shift;
- rents with a partner and child;
- owns one household vehicle shared with the partner;
- normally takes transit because the partner uses the car earlier;
- has repeatedly experienced overcrowded evening service;
- is considering a higher-paying job but would face a longer commute;
- remembers a prior rent-driven displacement;
- therefore places unusually high weight on housing stability;
- votes with housing affordability and transit reliability among her strongest local concerns.

None of those facts are decorative. Each is linked to authoritative state or simulated events.

Over decades, the same player can inspect descendants whose education, wealth, neighborhood access and opportunities were shaped by earlier city decisions.

---

# 14. Revised scale goal for the complete project

The prior 120,000–180,000 first-party TypeScript/test/tooling scale target is no longer representative of the approved ambition.

The revised architectural scale target is approximately **250,000–450,000+ first-party lines** if the full roadmap is realized, with line count remaining a non-goal and never an acceptance criterion.

The architecture must remain modular. Normal source files should still target under 500 LOC, with the existing warning/review thresholds retained.

The project should grow through independent domains and explicit interfaces rather than large coordinator classes.

---

# 15. Roadmap dependency order

The intended dependency order is:

Foundry Kernel
→ World Foundation
→ Urban Fabric
→ Personhood
→ Families/Households
→ Life History/Memory/Motivation
→ Daily Scheduling
→ Social Relationships
→ Education/Skills
→ Careers/Labor
→ Household Economy/Wealth
→ Health/Aging
→ Generations/Inheritance
→ Transportation
→ Mobility/Transit
→ Civic Institutions
→ Economy
→ Real Estate
→ Infrastructure
→ Environment
→ Government Finance
→ Politics
→ Planning Law
→ Megaprojects
→ Regional Simulation
→ Agglomeration/City Identity
→ Social Outcomes
→ Institutional Decisions
→ Analytics/Life Explorer
→ Scenarios/Editor/Replay/Modding.

Some physical foundation phases may continue development in parallel where interfaces are stable, but no later domain may reintroduce aggregate detailed-city residents as an authoritative shortcut.

---

# 16. Completion definition

Civic Foundry's full individual-Sim ambition is not complete merely because named citizens can be displayed.

Completion requires that:

- every resident is individually persistent;
- every resident has a coherent household/family context;
- every resident has an adaptive schedule;
- every resident has personal motivations/preferences;
- every resident has provenance-safe background and persistent simulated history;
- work, school, travel, housing, health, consumption and politics reconcile to actual people when those phases are active;
- major life events alter future behavior;
- generations can be simulated without identity corruption;
- macro city statistics reconcile to micro state;
- the player can inspect why both a city metric and an individual's outcome changed;
- the architecture remains deterministic, performant and save-compatible at large-city scale.

The intended end state is a city builder in which infrastructure, economics, urban form and government can be understood both from the map above and through the lives of the individual people living inside it.
