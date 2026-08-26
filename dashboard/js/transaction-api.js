async function updateTransactionCategory(transactionId, categoryId) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_category: categoryId })
    .eq('event_id', transactionId);

  if (error) throw error;
}

async function updateTransactionMerchant(transactionId, merchant) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_merchant: merchant })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

async function updateTransactionAmount(transactionId, amount) {
  const { data, error } = await supabaseClient
    .from('transactions_metadata')
    .update({ manual_amount: amount })
    .eq('event_id', transactionId)
    .select('event_id');

  if (error) throw error;
  if (!data?.length) throw new Error(`No metadata row found for transaction ${transactionId}`);
}

async function hideTransactions(transactionIds) {
  const { error } = await supabaseClient
    .from('transactions_metadata')
    .update({ hidden: true })
    .in('event_id', transactionIds);

  if (error) throw error;
}
