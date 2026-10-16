/**
 * SFpark Pilot Dynamic Pricing Policy Service
 * 
 * Target availability equilibrium: 60% to 80% occupancy.
 * 
 * Rules:
 * 1. Occupancy > 80%: Increase rate by +$0.25 (Demand Surge to free up curbside spaces)
 * 2. Occupancy 60% to 80%: Maintain rate unchanged ($0.00) (Target Equilibrium)
 * 3. Occupancy 30% up to but not including 60%: Decrease rate by -$0.25 (Off-Peak Incentive)
 * 4. Occupancy < 30%: Decrease rate by -$0.50 (Underutilized Discount)
 * 
 * Constraints:
 * - Mutually exclusive bands with strict boundary handling
 * - Floor rate: $0.25 minimum (cannot be negative)
 * - Ceiling cap: $6.00 maximum meter rate
 */

export function calculateSFparkPricingAdjustment(occupancyPct, baseRate = 2.00) {
  if (occupancyPct === null || occupancyPct === undefined || isNaN(Number(occupancyPct))) {
    throw new Error('Invalid occupancy percentage: must be a valid number.');
  }

  const occ = Number(occupancyPct);
  if (occ < 0 || occ > 100) {
    throw new Error(`Occupancy percentage out of valid range [0, 100]: received ${occ}`);
  }

  const numericBase = Number(baseRate);
  if (isNaN(numericBase) || numericBase < 0) {
    throw new Error(`Base rate must be non-negative: received ${baseRate}`);
  }

  let adjustment = 0;
  let policyAction = '';

  if (occ > 80.0) {
    adjustment = 0.25;
    policyAction = 'Demand Surge (+25¢)';
  } else if (occ >= 60.0 && occ <= 80.0) {
    adjustment = 0.00;
    policyAction = 'Target Equilibrium (Maintain)';
  } else if (occ >= 30.0 && occ < 60.0) {
    adjustment = -0.25;
    policyAction = 'Off-Peak Incentive (-25¢)';
  } else {
    // occ < 30.0
    adjustment = -0.50;
    policyAction = 'Underutilized Discount (-50¢)';
  }

  const floorRate = 0.25;
  const ceilingRate = 6.00;
  const unconstrainedRate = Number((numericBase + adjustment).toFixed(2));
  const recommendedRate = Math.min(ceilingRate, Math.max(floorRate, unconstrainedRate));

  return {
    occupancyPct: occ,
    baselineRate: numericBase,
    adjustment,
    recommendedRate,
    adjusted_rate: recommendedRate,
    policyAction,
    band: policyAction,
    currency: 'USD',
    currencySymbol: '$',
    floorApplied: unconstrainedRate < floorRate,
    ceilingApplied: unconstrainedRate > ceilingRate
  };
}

export function calculateFacilityPricingAdjustment(occupancyPct, slotTypeName, baseRate) {
  if (occupancyPct === null || occupancyPct === undefined || isNaN(Number(occupancyPct))) {
    throw new Error('Invalid occupancy percentage: must be a valid number.');
  }

  const occ = Number(occupancyPct);
  if (occ < 0 || occ > 100) {
    throw new Error(`Occupancy percentage out of valid range [0, 100]: received ${occ}`);
  }

  const numericBase = Number(baseRate);
  if (isNaN(numericBase) || numericBase < 0) {
    throw new Error(`Base rate must be a non-negative number: received ${baseRate}`);
  }

  let multiplier = 1.0;
  let policyAction = '';

  if (occ > 80.0) {
    multiplier = 1.20; // +20% surge
    policyAction = 'Facility High Demand (+20% Surge)';
  } else if (occ >= 60.0 && occ <= 80.0) {
    multiplier = 1.00; // Standard base
    policyAction = 'Facility Target Capacity (Standard Rate)';
  } else if (occ >= 30.0 && occ < 60.0) {
    multiplier = 0.90; // -10% discount
    policyAction = 'Facility Moderate Demand (10% Incentive)';
  } else {
    multiplier = 0.80; // -20% discount
    policyAction = 'Facility Off-Peak (20% Discount)';
  }

  const recommendedRate = Number(Math.max(0.0, numericBase * multiplier).toFixed(2));

  return {
    slotTypeName: slotTypeName || 'Standard',
    occupancyPct: occ,
    baselineRate: numericBase,
    multiplier,
    adjustment: Number((recommendedRate - numericBase).toFixed(2)),
    recommendedRate,
    policyAction,
    currency: 'INR',
    currencySymbol: '₹',
    calculatedAt: new Date().toISOString()
  };
}
