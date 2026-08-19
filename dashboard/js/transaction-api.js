async function updateTransactionCategory(transactionId, categoryId) {
  const { error } = await supabaseClient
    .from('transactions')
    .update({ category: categoryId })
    .eq('event_id', transactionId);

  if (error) throw error;
}

async function updateTransactionMerchant(transactionId, merchant) {
  const { error } = await supabaseClient
    .from('transactions')
    .update({ merchant })
    .eq('event_id', transactionId);

  if (error) throw error;
}

async function updateTransactionAmount(transactionId, amount) {
  const { error } = await supabaseClient
    .from('transactions')
    .update({ amount })
    .eq('event_id', transactionId);

  if (error) throw error;
}
