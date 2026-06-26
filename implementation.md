# Implementation File: Transaction History Skeletal Loading

## 1. Description & Objective
This document outlines the technical implementation details for adding a skeletal loading state to the `TransactionHistory` component (Issue #603). The goal is to provide visual feedback to users while transaction data is being fetched, preventing sudden layout shifts and improving perceived performance.

## 2. Design Decisions
- **Simulated Network Delay:** Since the component currently uses static, synchronous mock data (`ALL_TRANSACTIONS`), a simulated delay (`setTimeout`) was added to model real-world asynchronous fetching.
- **Tailwind CSS Utility Classes:** Instead of creating a separate reusable `Skeleton` component which would add boilerplate, we use Tailwind's `animate-pulse` utility inline. This keeps the implementation lean, reducing overhead while achieving the exact visual outcome required by the design system.
- **Table Preservation:** The table headers and pagination controls remain visible during the loading state. This is an intentional UX decision so the user can see the structure of the data and interact with filters immediately once data lands.
- **Skeleton Row Count:** The number of skeleton rows rendered dynamically matches the selected `pageSize`.

## 3. Complexity Analysis
- **Time Complexity:** 
  - Rendering the skeletal state takes $O(P)$ time, where $P$ is the selected page size (e.g., 5, 10, 20). This is highly performant and does not introduce any complex logic or heavy array processing during the loading phase.
- **Space Complexity:**
  - The space complexity is $O(1)$ auxiliary space. The DOM tree growth is strictly bounded by the constant `pageSize` maximum of 20 elements, ensuring minimal memory footprint during the loading state.

## 4. Code Explanations
### `TransactionHistory.tsx`
1. **State Addition:**
   ```typescript
   const [isLoading, setIsLoading] = useState(true);
   ```
   Controls whether the skeleton or the actual data is shown.

2. **Simulation Hook:**
   ```typescript
   useEffect(() => {
     // Simulated 1s delay to mock asynchronous data fetching
     const timer = setTimeout(() => setIsLoading(false), 1000);
     return () => clearTimeout(timer);
   }, []);
   ```
   Fires once on component mount. Clears the loading state after 1 second. Clean-up ensures the timer is removed if the component unmounts prematurely.

3. **Skeleton Rendering (JSX):**
   ```tsx
   {isLoading ? (
     Array.from({ length: pageSize }).map((_, i) => (
       <tr key={`skeleton-${i}`} className="border-b border-slate-800/50 last:border-0">
         <td className="p-4"><div className="h-4 w-20 bg-slate-800 rounded animate-pulse" /></td>
         <td className="p-4"><div className="h-4 w-12 bg-slate-800 rounded animate-pulse" /></td>
         <td className="p-4"><div className="h-4 w-16 bg-slate-800 rounded animate-pulse" /></td>
         <td className="p-4"><div className="h-6 w-20 bg-slate-800 rounded-full animate-pulse" /></td>
         <td className="p-4"><div className="h-4 w-24 bg-slate-800 rounded animate-pulse" /></td>
         <td className="p-4"><div className="h-4 w-24 bg-slate-800 rounded animate-pulse" /></td>
       </tr>
     ))
   ) : paginated.length === 0 ? (
     ...
   )}
   ```
   Renders placeholder boxes for each column. We use `w-24`, `w-16`, etc., to roughly match the expected content widths, creating a realistic shimmer effect.
