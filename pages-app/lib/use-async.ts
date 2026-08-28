import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync<T>(loader: () => Promise<T>, dependencies: React.DependencyList = []) {
  const dependencyKey = JSON.stringify(dependencies);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; }, [loader]);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await loaderRef.current()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { queueMicrotask(() => void run()); }, [dependencyKey, run]);
  return { data, error, loading, reload: run };
}
