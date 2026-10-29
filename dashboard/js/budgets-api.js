/**
 * budgets-api.js
 * ---------------------------------------------------------------------
 * Reads and saves the household's monthly budgets in the Supabase
 * `monthly_budgets` table (one row per month: month 'YYYY-MM', unique,
 * and budgets — each budget group's amount in pounds, e.g.
 * { Groceries: 300, 'Dining Out': 250 }). A month without a row uses
 * the defaults in state.js BUDGETS. Each function throws on failure, so
 * the Overview can say what went wrong.
 * ---------------------------------------------------------------------
 */

import { supabaseClient } from './auth.js';

/** Every saved month's budgets: { '2026-10': { Groceries: 300, ... }, ... }. */
export async function fetchMonthlyBudgets() {
  const { data, error } = await supabaseClient
    .from('monthly_budgets')
    .select('month, budgets');

  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.month, row.budgets || {}]));
}

/**
 * Saves a month's budgets (adding its row, or replacing the one it has)
 * and returns them as stored. Row-level security that stops the save
 * changes nothing quietly, so a missing row back is a NO_ROWS error.
 */
export async function saveMonthlyBudgets(month, budgets) {
  const { data, error } = await supabaseClient
    .from('monthly_budgets')
    .upsert({ month, budgets }, { onConflict: 'month' })
    .select('month, budgets');

  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error(`No budgets were saved (${month})`), { code: 'NO_ROWS' });
  return data[0].budgets;
}
