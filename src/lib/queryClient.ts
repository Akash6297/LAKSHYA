import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      // only toast background refetch failures; first-load errors render inline
      if (query.state.data !== undefined) toast.error(`Couldn't refresh: ${(err as Error).message}`)
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _v, _c, mutation) => {
      if (!mutation.options.meta?.silent) toast.error((err as Error).message)
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (count, err) => count < 2 && !/permission|session/i.test((err as Error).message),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
})

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean }
  }
}
