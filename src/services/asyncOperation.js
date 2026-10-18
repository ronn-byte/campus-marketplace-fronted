export async function runWithLoading(operation, setLoading) {
  setLoading(true);
  try {
    return await operation();
  } finally {
    setLoading(false);
  }
}
