import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from './router.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    // SSE invalidates what changed; refetching on focus or retrying a local backend would only hide defects.
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});
const router = createAppRouter(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
