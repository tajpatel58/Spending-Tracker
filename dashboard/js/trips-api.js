/**
 * trips-api.js
 * ---------------------------------------------------------------------
 * Reads, adds, updates (budgets) and deletes the household's trips in the Supabase `trips`
 * table (one row per trip: id, location, start_date, end_date, budget,
 * part_budgets — the budget for each part, e.g. { flights: 420 }, with
 * budget kept as their sum). Each
 * function throws on failure, so the Trips page can say what went wrong
 * (a missing table or row-level-security policy shows up here first).
 * ---------------------------------------------------------------------
 */

import { supabaseClient } from './auth.js';

const COLUMNS = 'id, location, start_date, end_date, budget, part_budgets';

/** Every saved trip, earliest first. */
export async function fetchTrips() {
  const { data, error } = await supabaseClient
    .from('trips')
    .select(COLUMNS)
    .order('start_date');

  if (error) throw error;
  return data || [];
}

/** Saves a new trip (no budget yet) and returns the stored row. Dates are 'YYYY-MM-DD'. */
export async function createTrip({ location, startDate, endDate }) {
  const { data, error } = await supabaseClient
    .from('trips')
    .insert({ location, start_date: startDate, end_date: endDate })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Sets a trip's budget for each part ({ flights: 420, stay: 900 }, in
 * pounds; parts at 0 are dropped) and its budget as their sum (null when
 * none are left) — or as `total`, when given (Undo uses it to put back a
 * trip that had only a total) — and returns the stored { budget,
 * part_budgets }. Like a
 * delete, an update that row-level security stops changes nothing
 * quietly, so a missing row back is a NO_ROWS error.
 */
export async function updateTripBudgets(id, parts, total) {
  const partBudgets = Object.fromEntries(Object.entries(parts).filter(([, amount]) => amount > 0));
  const amounts = Object.values(partBudgets);
  const budget = total !== undefined ? total : amounts.length ? amounts.reduce((s, v) => s + v, 0) : null;
  const { data, error } = await supabaseClient
    .from('trips')
    .update({ budget, part_budgets: partBudgets })
    .eq('id', id)
    .select('id, budget, part_budgets');

  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error(`No trip was updated (id ${id})`), { code: 'NO_ROWS' });
  return { budget: data[0].budget, part_budgets: data[0].part_budgets };
}

/**
 * Deletes a trip by its row id. Row-level security doesn't raise an error
 * when it stops a delete (nothing is deleted, quietly), so this asks for
 * the deleted row back and throws a NO_ROWS error when there isn't one.
 */
export async function deleteTrip(id) {
  const { data, error } = await supabaseClient
    .from('trips')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error(`No trip was deleted (id ${id})`), { code: 'NO_ROWS' });
}
