# Civic Foundry — Balancing & Difficulty

## Purpose

This document explains how Civic Foundry should be balanced as a systems-heavy simulation. Detailed parameter and formula conventions remain in [`../BALANCING.md`](../BALANCING.md).

## Balancing goal

Balance should create meaningful trade-offs while preserving the causal structure of the city.

The preferred question is:

> What conditions make this choice effective or costly?

rather than:

> What arbitrary bonus/penalty makes two buttons numerically equal?

## Simulation credibility before difficulty

A system should first behave coherently under controlled conditions. Difficulty modifiers should not be used to hide broken conservation, bad routing, impossible development economics or unstable population dynamics.

## Difficulty should come from conditions

Good scenario difficulty can arise from:

- constrained geography;
- expensive or weak soils;
- flood/hazard exposure;
- inherited congestion;
- weak tax base;
- aging infrastructure;
- high debt/maintenance obligations;
- low housing supply;
- labor mismatch;
- weak regional access;
- difficult political constraints in later phases;
- demanding scenario objectives.

This gives the player understandable problems rather than invisible AI cheating.

## Avoid hidden cheating

Difficulty should generally avoid:

- giving firms or households impossible money;
- creating service capacity without staff/equipment;
- making traffic ignore network rules;
- changing construction outcomes without an exposed reason;
- altering random outcomes through undocumented non-determinism.

If a scenario uses explicit external subsidies, economic shocks or special rules, those can be legitimate because they are modeled conditions.

## Directional balance

Many mechanics should be calibrated first for correct directionality.

Examples:

- greater effective transport capacity should reduce a controlled bottleneck, all else equal;
- higher construction costs should reduce marginal project feasibility;
- higher vacancy should weaken rent pressure;
- better job accessibility should improve relevant location attractiveness;
- understaffed facilities should provide less realized service;
- disconnected utilities should not provide capacity;
- debt/maintenance obligations should reduce future fiscal flexibility.

Only after directional behavior is sound should exact magnitudes be tuned.

## Trade-off design

Strong decisions should rarely be universally dominant.

Examples:

### Roads

Benefits:
- travel capacity;
- access;
- freight movement.

Costs/trade-offs:
- capital and maintenance cost;
- land/right-of-way consumption;
- induced travel and downstream bottlenecks;
- environmental/neighborhood impacts in later systems.

### Zoning reform

Benefits:
- greater development capacity;
- potential housing/job supply.

Trade-offs:
- infrastructure/service demand;
- land-value and displacement effects;
- political opposition in later phases;
- altered neighborhood form.

### High service levels

Benefits:
- better outcomes and desirability.

Trade-offs:
- staffing and operating cost;
- facilities/fleet requirements;
- opportunity cost elsewhere in the budget.

## Economic calibration

Prices, costs and incomes should be calibrated as a connected system. Avoid adjusting rent, wages, construction cost or tax revenue independently if the change creates inconsistent economic ratios.

Important relationships include:

- household income vs housing cost;
- wage vs firm productivity/revenue;
- land value vs achievable development value;
- construction cost vs rent/sale value;
- service expenditure vs tax base;
- logistics cost vs firm margin;
- interest/financing cost vs project feasibility.

## Units

Every balance parameter should have a clear unit and time basis where applicable.

Examples:

- currency per simulation month/year;
- capacity per hour/day;
- speed/distance units;
- area units;
- probability per evaluation event;
- annual interest rate;
- deterioration per year.

Avoid coefficients whose meaning cannot be explained.

## Time-scale balance

Long-run systems require appropriate response times.

Examples:

- congestion can react quickly;
- relocation should not oscillate every tick;
- buildings should not deteriorate in days;
- construction should take meaningful simulated time when project staging is implemented;
- demographics and infrastructure replacement unfold over years/decades.

Fast feedback is useful for the player, but simulation response should remain believable.

## Stability

Long-run balance must avoid numerical/systemic pathologies such as:

- runaway exponential population growth caused by formulas;
- permanent death spirals from one small shock when recovery should be possible;
- oscillating markets caused by overreactive update rules;
- unrestricted compounding money creation;
- unlimited traffic demand independent of population/activity;
- inevitable maximum-density development everywhere.

Long-run deterministic tests are part of balancing work.

## Scenario difficulty

Scenario presets can modify starting conditions and objectives rather than globally multiplying every cost.

Useful levers:

- starting treasury/debt;
- existing assets/condition;
- geography and hazards;
- regional demand;
- interest rates/macroeconomic context where modeled;
- starting population/industry mix;
- legal/political constraints;
- goal thresholds and time horizon.

## Sandbox defaults

Default sandbox settings should favor understandable system behavior and a forgiving enough fiscal runway for learning while still requiring planning.

The game should not require memorizing hidden thresholds. Important breakpoints should be visible through tooltips, diagnostics or causal explanations.

## Testing balance changes

A substantial balance change should use controlled comparison scenarios.

Record relevant outputs before/after such as:

- population/jobs;
- vacancy/rents;
- firm survival/output;
- congestion/accessibility;
- service queues/outcomes;
- treasury/debt;
- development starts;
- long-run stability.

Deterministic seeds make A/B comparisons especially valuable.

## Principle

Civic Foundry balance should make real system constraints legible and consequential. Difficulty comes from managing trade-offs under imperfect conditions, not from opaque bonuses or simulation cheating.