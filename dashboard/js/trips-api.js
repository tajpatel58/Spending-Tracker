/**
 * trips-api.js
 * ---------------------------------------------------------------------
 * Reads, adds, updates (budget) and deletes the household's trips in the Supabase `trips`
 * table (one row per trip: id, location, start_date, end_date, budget). Each
 * function throws on failure, so the Trips page can say what went wrong
 * (a missing table or row-level-security policy shows up here first).
 * ---------------------------------------------------------------------
 */

import { supabaseClient } from './auth.js';

const COLUMNS = 'id, location, start_date, end_date, budget';

/** Every saved trip, earliest first. */
export async function fetchTrips() {
  const { data, error } = await supabaseClient
    .from('trips')
    .select(COLUMNS)
    .order('start_date');

  if (error) throw error;
  return data || [];
}

/** Saves a new trip and returns the stored row. Dates are 'YYYY-MM-DD'; budget is in pounds, or null for none. */
export async function createTrip({ location, startDate, endDate, budget = null }) {
  const { data, error } = await supabaseClient
    .from('trips')
    .insert({ location, start_date: startDate, end_date: endDate, budget })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Sets a trip's budget (in pounds, or null to remove it) and returns the
 * stored value. Like a delete, an update that row-level security stops
 * changes nothing quietly, so a missing row back is a NO_ROWS error.
 */
export async function updateTripBudget(id, budget) {
  const { data, error } = await supabaseClient
    .from('trips')
    .update({ budget })
    .eq('id', id)
    .select('id, budget');

  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error(`No trip was updated (id ${id})`), { code: 'NO_ROWS' });
  return data[0].budget;
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
