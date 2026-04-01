# React TSX Component Best Practices (2025-2026)

Practical patterns for structuring React TypeScript components. Focused on
testability, separation of concerns, and maintainability at scale.

---

## 1. Separating Business Logic from JSX

**Rule: Large page components should never mix business logic with rendering.**

Extract all state management, data fetching, and domain logic into custom hooks.
The component file becomes a thin rendering shell.

```tsx
// BAD: logic and rendering interleaved
function OrderPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders(filter).then(data => {
      setOrders(data);
      setLoading(false);
    });
  }, [filter]);

  const totals = orders.reduce((acc, o) => acc + o.total, 0);

  // 200 lines of JSX mixed with inline handlers...
}
```

```tsx
// GOOD: hook owns all logic, component owns all rendering
// useOrders.ts
interface UseOrdersReturn {
  orders: Order[];
  totals: number;
  filter: string;
  setFilter: (f: string) => void;
  loading: boolean;
  error: Error | null;
}

export function useOrders(): UseOrdersReturn {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchOrders(filter)
      .then(setOrders)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [filter]);

  const totals = useMemo(
    () => orders.reduce((acc, o) => acc + o.total, 0),
    [orders]
  );

  return { orders, totals, filter, setFilter, loading, error };
}

// OrderPage.tsx
export default function OrderPage() {
  const { orders, totals, filter, setFilter, loading, error } = useOrders();

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      <FilterBar value={filter} onChange={setFilter} />
      <OrderList orders={orders} />
      <TotalBanner total={totals} />
    </div>
  );
}
```

### When to split further

If a custom hook exceeds ~100 lines, break domain logic into pure functions
in a separate module:

```tsx
// order-logic.ts — pure functions, trivially testable
export function calculateTotals(orders: Order[]): number {
  return orders.reduce((acc, o) => acc + o.total, 0);
}

export function filterOrders(orders: Order[], status: string): Order[] {
  return status === 'all' ? orders : orders.filter(o => o.status === status);
}

// useOrders.ts — uses the pure functions
import { calculateTotals, filterOrders } from './order-logic';
```

---

## 2. Data Fetching: Custom Hooks, TanStack Query, and `use()`

### Avoid raw useEffect for data fetching

React's official guidance: "Writing data fetching directly in Effects gets
repetitive and makes it difficult to add optimizations like caching and server
rendering later." The fewer raw `useEffect` calls in your components, the
easier your application is to maintain.

### Option A: TanStack Query (recommended for production)

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Wrap in a domain-specific hook
export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.get<Workflow[]>('/workflows').then(r => r.data),
    staleTime: 30_000,
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  });
}

// Component stays clean
function WorkflowList() {
  const { data: workflows, isLoading, error } = useWorkflows();
  const deleteMutation = useDeleteWorkflow();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <ul>
      {workflows.map(w => (
        <WorkflowCard
          key={w.id}
          workflow={w}
          onDelete={() => deleteMutation.mutate(w.id)}
        />
      ))}
    </ul>
  );
}
```

### Option B: React 19 `use()` with Suspense

```tsx
import { use, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

// Create promise outside render (or in a cache/loader)
const workflowsPromise = fetchWorkflows();

function WorkflowList() {
  const workflows = use(workflowsPromise); // suspends until resolved
  return (
    <ul>
      {workflows.map(w => <WorkflowCard key={w.id} workflow={w} />)}
    </ul>
  );
}

// Compose declaratively
function WorkflowPage() {
  return (
    <ErrorBoundary fallback={<ErrorPanel />}>
      <Suspense fallback={<Spinner />}>
        <WorkflowList />
      </Suspense>
    </ErrorBoundary>
  );
}
```

The `use()` hook resolves a promise and suspends rendering until it completes.
Pair it with Suspense for loading states and ErrorBoundary for failures.

### Option C: Lightweight custom hook (when you don't want a library)

```tsx
type AsyncState<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: Error };

export function useFetch<T>(url: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    fetch(url, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then(data => setState({ status: 'success', data }))
      .catch(error => {
        if (error.name !== 'AbortError') {
          setState({ status: 'error', error });
        }
      });

    return () => controller.abort();
  }, [url]);

  return state;
}
```

---

## 3. Making Components Testable

### Principle: Push logic into pure functions and custom hooks

Components that are thin rendering shells are easy to test because:
- Business logic lives in pure functions (test with plain unit tests)
- Custom hooks can be tested with `renderHook()` from testing-library
- Components only need to verify rendering output, not logic

### Testing pure domain logic

```tsx
// order-logic.test.ts
import { calculateTotals, filterOrders } from './order-logic';

describe('calculateTotals', () => {
  it('sums order totals', () => {
    const orders = [{ total: 10 }, { total: 20 }] as Order[];
    expect(calculateTotals(orders)).toBe(30);
  });
});
```

### Testing custom hooks

```tsx
// useOrders.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useOrders } from './useOrders';

// Mock the API layer, not the hook internals
vi.mock('./api', () => ({
  fetchOrders: vi.fn().mockResolvedValue([
    { id: '1', total: 50, status: 'active' },
  ]),
}));

describe('useOrders', () => {
  it('returns orders after loading', async () => {
    const { result } = renderHook(() => useOrders());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.totals).toBe(50);
  });
});
```

### Testing components (render tests)

```tsx
// OrderPage.test.tsx
import { render, screen } from '@testing-library/react';
import OrderPage from './OrderPage';

// Mock the hook — component doesn't own the logic
vi.mock('./useOrders', () => ({
  useOrders: () => ({
    orders: [{ id: '1', title: 'Test', total: 42, status: 'active' }],
    totals: 42,
    filter: 'all',
    setFilter: vi.fn(),
    loading: false,
    error: null,
  }),
}));

it('renders order list', () => {
  render(<OrderPage />);
  expect(screen.getByText('Test')).toBeInTheDocument();
});
```

### Key testing rules

- **Mock at the boundary**: mock API calls and imported hooks, not internals
- **Test behavior, not implementation**: click buttons, check visible output
- **Use discriminated unions for state**: `{ status: 'loading' | 'success' | 'error' }` makes it impossible to have inconsistent states
- **Avoid snapshot tests**: prefer explicit assertions on specific elements

---

## 4. Container/Presenter Pattern: Current Status

**The pattern is not dead, but it has evolved.** The class-based container
component approach is obsolete. Custom hooks have replaced containers as
the primary mechanism for separating data/logic from presentation.

### Modern equivalent: Hook + Presentational Component

```tsx
// useUserProfile.ts (replaces the "container")
export function useUserProfile(userId: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  });
  return { user: data, isLoading, error };
}

// UserProfileCard.tsx (the "presenter" — pure props in, JSX out)
interface UserProfileCardProps {
  user: User;
}

export function UserProfileCard({ user }: UserProfileCardProps) {
  return (
    <div className="rounded-lg border p-4">
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  );
}

// UserProfilePage.tsx (thin composition layer)
export default function UserProfilePage({ userId }: { userId: string }) {
  const { user, isLoading, error } = useUserProfile(userId);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return <UserProfileCard user={user} />;
}
```

### When to use the full container/presenter split

- **Large teams**: when multiple people work on the same feature, hard boundaries help
- **Design system components**: presentational components with zero logic are ideal for shared libraries
- **Complex pages**: when a page composes 5+ data sources, a dedicated composition layer prevents spaghetti

### When hooks alone are enough

- Small/medium apps where a single hook per page keeps things clear
- Features with one data source and straightforward rendering
- When you want less boilerplate

---

## 5. Headless Component Pattern

For reusable behavior (dropdowns, modals, drag-and-drop), the headless
component pattern exposes logic via a custom hook and lets consumers
provide their own JSX.

```tsx
// useDropdown.ts — headless logic
interface UseDropdownReturn<T> {
  isOpen: boolean;
  selectedItem: T | null;
  items: T[];
  toggle: () => void;
  select: (item: T) => void;
  getToggleProps: () => React.ButtonHTMLAttributes<HTMLButtonElement>;
  getItemProps: (item: T) => React.LiHTMLAttributes<HTMLLIElement>;
}

export function useDropdown<T>(items: T[]): UseDropdownReturn<T> {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<T | null>(null);

  return {
    isOpen,
    selectedItem,
    items,
    toggle: () => setIsOpen(prev => !prev),
    select: (item: T) => {
      setSelectedItem(item);
      setIsOpen(false);
    },
    getToggleProps: () => ({
      onClick: () => setIsOpen(prev => !prev),
      'aria-expanded': isOpen,
      'aria-haspopup': 'listbox' as const,
    }),
    getItemProps: (item: T) => ({
      role: 'option' as const,
      'aria-selected': item === selectedItem,
      onClick: () => {
        setSelectedItem(item);
        setIsOpen(false);
      },
    }),
  };
}

// Consumer provides all the JSX
function StatusFilter({ statuses }: { statuses: string[] }) {
  const { isOpen, selectedItem, toggle, getToggleProps, getItemProps } =
    useDropdown(statuses);

  return (
    <div className="relative">
      <button {...getToggleProps()}>{selectedItem ?? 'Select status'}</button>
      {isOpen && (
        <ul role="listbox" className="absolute mt-1 border rounded bg-white">
          {statuses.map(s => (
            <li key={s} {...getItemProps(s)} className="px-3 py-1 cursor-pointer">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

This is the same pattern used by Radix UI, Headless UI, and Ark UI. It
maximizes reuse because the hook handles all behavior (keyboard navigation,
focus management, ARIA attributes) while styling is entirely up to the consumer.

---

## 6. Polling and WebSocket State Without Stale Closures

### The problem

```tsx
// BUG: stale closure
function ChatRoom({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const ws = new WebSocket(`/ws/rooms/${roomId}`);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      // 'messages' is captured at effect creation time — always []
      setMessages([...messages, msg]); // BUG: stale
    };
    return () => ws.close();
  }, [roomId]); // can't add 'messages' — would reconnect on every message
}
```

### Fix 1: Functional state updater (simplest)

```tsx
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  setMessages(prev => [...prev, msg]); // always uses latest state
};
```

This solves 90% of stale closure issues. Use it whenever you're updating
state based on previous state inside an effect callback.

### Fix 2: useRef for values you need to read (not update)

```tsx
function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function ChatRoom({ roomId, onMessage }: Props) {
  const onMessageRef = useLatest(onMessage);

  useEffect(() => {
    const ws = new WebSocket(`/ws/rooms/${roomId}`);
    ws.onmessage = (event) => {
      onMessageRef.current(JSON.parse(event.data)); // always fresh
    };
    return () => ws.close();
  }, [roomId]); // onMessage changes don't cause reconnect
}
```

### Fix 3: useEffectEvent (React 19.2+)

```tsx
import { useEffectEvent } from 'react';

function ChatRoom({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionCount, setConnectionCount] = useState(0);

  // This function always reads the latest state,
  // but is NOT a reactive dependency
  const onWsMessage = useEffectEvent((event: MessageEvent) => {
    const msg = JSON.parse(event.data);
    setMessages(prev => [...prev, msg]);
    // Can safely read connectionCount here — never stale
    logger.info(`Message on connection #${connectionCount}`);
  });

  useEffect(() => {
    const ws = new WebSocket(`/ws/rooms/${roomId}`);
    ws.onmessage = onWsMessage;
    setConnectionCount(c => c + 1);
    return () => ws.close();
  }, [roomId]); // onWsMessage is not a dependency
}
```

`useEffectEvent` gives you a stable function that always reads the latest
values when called, without being a reactive dependency. It is the
recommended solution for WebSocket handlers, interval callbacks, and
analytics events that need fresh state.

### Fix 4: Zustand for shared real-time state

For app-wide real-time state (presence, notifications, live data), use a
Zustand store updated from outside React:

```tsx
// ws-store.ts — vanilla store, no React dependency
import { createStore } from 'zustand/vanilla';

interface WsState {
  messages: Message[];
  connected: boolean;
  addMessage: (msg: Message) => void;
  setConnected: (v: boolean) => void;
}

export const wsStore = createStore<WsState>((set) => ({
  messages: [],
  connected: false,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setConnected: (v) => set({ connected: v }),
}));

// ws-manager.ts — runs outside React
const ws = new WebSocket('/ws');
ws.onopen = () => wsStore.getState().setConnected(true);
ws.onclose = () => wsStore.getState().setConnected(false);
ws.onmessage = (e) => wsStore.getState().addMessage(JSON.parse(e.data));

// Component reads from store — no stale closures possible
import { useStore } from 'zustand';

function MessageList() {
  const messages = useStore(wsStore, (s) => s.messages);
  return <ul>{messages.map(m => <MessageItem key={m.id} message={m} />)}</ul>;
}
```

### Polling with useInterval

```tsx
function useInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useLatest(callback);

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => savedCallback.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

// Usage — callback always reads fresh state
function DashboardPoller() {
  const refresh = useDashboardRefresh();
  useInterval(() => refresh(), 5_000);
  // ...
}
```

---

## 7. Error Boundary Patterns

### Using react-error-boundary (recommended)

```tsx
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

// Typed fallback component
function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="rounded border border-red-300 bg-red-50 p-4">
      <h3 className="font-semibold text-red-800">Something went wrong</h3>
      <pre className="mt-2 text-sm text-red-700">{error.message}</pre>
      <button
        onClick={resetErrorBoundary}
        className="mt-3 rounded bg-red-600 px-3 py-1 text-white"
      >
        Try again
      </button>
    </div>
  );
}
```

### Strategic placement (not one giant boundary)

```tsx
function AppLayout() {
  return (
    <div className="flex">
      {/* Sidebar errors don't break the main content */}
      <ErrorBoundary fallback={<SidebarError />}>
        <Sidebar />
      </ErrorBoundary>

      <main>
        {/* Each feature gets its own boundary */}
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
```

### Per-feature boundary with reset on navigation

```tsx
function FeatureBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      resetKeys={[location.pathname]} // auto-reset on navigation
      onError={(error, info) => {
        // Report to monitoring (Sentry, etc.)
        logger.error('Component error', { error, componentStack: info.componentStack });
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
```

### Combining Suspense + ErrorBoundary (declarative async UI)

```tsx
// Reusable wrapper for any async feature section
function AsyncSection({
  children,
  loadingFallback = <Spinner />,
}: {
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
}) {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <Suspense fallback={loadingFallback}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

// Usage
function Dashboard() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <AsyncSection>
        <RevenueChart />
      </AsyncSection>
      <AsyncSection>
        <ActiveUsers />
      </AsyncSection>
    </div>
  );
}
```

### Error boundaries for async event handlers

Error boundaries only catch errors during rendering. For async operations
(click handlers, API calls), catch errors manually and set error state:

```tsx
function DeleteButton({ workflowId }: { workflowId: string }) {
  const [error, setError] = useState<Error | null>(null);

  // Re-throw to let the nearest ErrorBoundary catch it
  if (error) throw error;

  async function handleDelete() {
    try {
      await api.delete(`/workflows/${workflowId}`);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return <button onClick={handleDelete}>Delete</button>;
}
```

---

## Quick Reference: When to Use What

| Concern | Pattern |
|---------|---------|
| Data fetching | TanStack Query or `use()` + Suspense |
| Page-level logic | Custom hook per page (replaces container) |
| Reusable behavior | Headless hook (returns props/state, no JSX) |
| Pure domain logic | Standalone functions in `*-logic.ts` files |
| Real-time state | Zustand vanilla store + WebSocket outside React |
| Polling | `useInterval` hook with `useLatest` or `useEffectEvent` |
| Stale closures | Functional updater > useRef > useEffectEvent |
| Error handling | `react-error-boundary` at feature boundaries |
| Loading states | Suspense boundaries per feature section |

---

## Sources

- [Business Logic Separation in React](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)
- [Headless Components Pattern (Martin Fowler)](https://martinfowler.com/articles/headless-component.html)
- [Container/Presentational Pattern (patterns.dev)](https://www.patterns.dev/react/presentational-container-pattern/)
- [React State Management in 2025](https://www.developerway.com/posts/react-state-management-2025)
- [React Stack Patterns 2026 (patterns.dev)](https://www.patterns.dev/react/react-2026/)
- [useEffectEvent Guide (Peter Kellner)](https://peterkellner.net/2026-01-09-understanding-react-useeffectevent-vs-useeffect/)
- [useEffectEvent: Goodbye Stale Closures (LogRocket)](https://blog.logrocket.com/react-useeffectevent/)
- [The Stale Closure Trap in React's Batched World](https://egebilge.medium.com/the-stale-closure-trap-in-reacts-batched-world-c19c2ccbb85a)
- [Modern React Data Fetching: Suspense, use(), ErrorBoundary](https://www.freecodecamp.org/news/the-modern-react-data-fetching-handbook-suspense-use-and-errorboundary-explained/)
- [react-error-boundary (GitHub)](https://github.com/bvaughn/react-error-boundary)
- [Error Handling in React (Sentry)](https://blog.sentry.io/guide-to-error-and-exception-handling-in-react/)
- [You Might Not Need an Effect (react.dev)](https://react.dev/learn/you-might-not-need-an-effect)
- [React Hooks Complete Guide 2026](https://inhaq.com/blog/mastering-react-hooks-the-ultimate-guide-for-building-modern-performant-uis.html)
- [Zustand WebSocket Integration (Discussion)](https://github.com/pmndrs/zustand/discussions/1651)
- [React Component Architecture (rtcamp)](https://rtcamp.com/handbook/react-best-practices/component-architecture/)
- [Testing React Components with Hooks & Mocks](https://webbylab.com/blog/guide-of-testing-react-components-with-hooks-mocks/)
- [React Testing with Vitest & RTL](https://vaskort.medium.com/bulletproof-react-testing-with-vitest-rtl-deeaabce9fef)
