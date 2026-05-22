# ForestChat — Phase 2: Auth & Property Import

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add Supabase Auth (email+password login, protected routes, user-aware header) and property import (MML boundary + Metsäkeskus WFS stands → PostGIS + map).

**Architecture:** Phase 2 delivers two subsystems: (1) Supabase Auth integration with middleware session refresh, login/register pages, and auth-aware UI; (2) a property import pipeline that fetches boundaries from MML OGC API, intersects with Metsäkeskus WFS stand data, and stores everything in PostGIS — all exposed through a typed API route and a clean import UI.

**Tech Stack:** Next.js 16.2 (App Router, middleware), TypeScript strict, Supabase Auth + `@supabase/ssr` 0.10, PostgreSQL + PostGIS, MML OGC API Features, Metsäkeskus WFS v1:stand, Tailwind CSS 4

**Prerequisites (Phase 0+1 — DONE):**

- ✅ Supabase project with Auth enabled (email + password)
- ✅ Database migration (`supabase/migrations/001_initial_schema.sql`) — profiles, forests, property_boundaries, compartments, plan_shares tables exist
- ✅ `@supabase/ssr` 0.10 installed
- ✅ Supabase client factories (`src/lib/supabase/{client,server,admin}.ts`)
- ✅ Environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, MML_API_KEY)
- ✅ ForestLayout shell with `{/* Auth placeholder — Phase 2 */}` comment
- ✅ Landing page with "Get Started" CTA
- ✅ Zustand store (map + forest slices)
- ✅ React hooks (useCompartments, useForest, useOperations)
- ✅ MapLibre GL + StandLayer + popups + legend

**⚠️ Prerequisites to Verify Before Starting (CRITICAL):**

- ⚠️ **MML API endpoint verification:** The MML API must return 200 for the property boundary endpoint before the import pipeline can work. The correct auth format is **HTTP Basic Authentication** with the API key as BOTH username and password (`-u "key:key"`). Header-based auth (`-H "api-key: ..."`) does NOT work. Verify the endpoint:

```bash
curl -sI -u "$MML_API_KEY:$MML_API_KEY" \
  "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/ogcapi/v1/collections"
# Expected: HTTP 200 (not 401 or 404)
# If 404: the endpoint path may have changed. Check MML documentation at:
# https://www.maanmittauslaitos.fi/rajapinnat/ohjeita-rajapinta-avaimen-kayttoon
```

- ⚠️ **If the MML endpoint returns 404:** The MML API infrastructure may have been restructured. The base domain is confirmed working (bigip passes auth with 200-series response once the correct path is found). This prerequisite MUST be resolved before P2.5. Contact MML technical support at verkkopalvelut@maanmittauslaitos.fi if the documented endpoint is unreachable.

- ⚠️ **Supabase Auth email provider:** Verify email auth is enabled in Supabase Dashboard → Authentication → Providers → Email (no "Confirm email" for development; enable for production).

---

## Task Ordering & Dependencies

```
P2.0 Supabase Middleware ──┬──► Track A: Auth UI ──────────────────────────────┐
  (BLOCKS ALL TRACKS)      │  P2.1 → P2.2 → P2.3 → P2.4                      │
                           │                                                   │
                           └──► Track B: Import Backend ───────────────────────┤
                               P2.5 → P2.6 → P2.7 → P2.8                     │
                                                                    │         │
                                                          P2.9 Import API (MERGE)
                                                                    │
                                                          P2.10 Import Page
                                                                    │
                                                          P2.11 Progress UI
                                                                    │
                                                          P2.12 Dashboard Page
                                                                    │
                                                          P2.13 E2E Integration
```

**P2.0** must run first — middleware is the foundation for all auth-protected routes. After P2.0, Track A (auth UI) and Track B (import backend) can run in parallel — the import backend utilities (MML/WFS clients, spatial services) have no auth dependency. P2.9 merges both tracks: the import API route needs auth middleware (to get `auth.uid()`) AND the backend utilities (to fetch/store data).

---

## Track A: Auth UI (~3h)

### P2.0 — Supabase Auth Proxy (0.5h) **[BLOCKS ALL TRACKS]**

**Objective:** Set up Next.js proxy that refreshes the Supabase session on every request and protects `/app/*` routes from unauthenticated access.

**⚠️ Next.js 16:** The `middleware` naming convention is **deprecated**. The file MUST be named `src/proxy.ts` and export a function named `proxy`. The runtime is `nodejs` (not `edge`).

**Files:**
- Create: `src/proxy.ts`

**Architecture:** Uses `@supabase/ssr` middleware pattern. Middleware calls `supabase.auth.getUser()` to validate the session cookie. If no valid session, redirects to `/auth/login`. Excludes public routes (`/`, `/auth/*`, `/api/*`, static assets).

```typescript
// src/proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session (cookie-only, no network call)
  const { data: { session } } = await supabase.auth.getSession();

  // Protect /app/* routes — only need session existence check,
  // NOT getUser() which makes a network call on every request
  if (!session && request.nextUrl.pathname.startsWith("/app")) {
    const redirectUrl = new URL("/auth/login", request.url);
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**⚠️ Supabase `@supabase/ssr` 0.10 note:** `getSession()` reads the cookie without a network call — mandatory for proxy performance. Do NOT call `getUser()` in the proxy — it makes a network call to Supabase on every request, doubling latency.

**Verification:** Run `npm run dev`, navigate to `/app/forest/test-1` → redirected to `/auth/login`. Navigate to `/` → landing page loads normally.

---

### P2.1 — Auth Callback Route (0.25h)

**Objective:** Handle the OAuth/email confirmation callback from Supabase. Exchanges the `code` in the URL for a session cookie.

**Files:**
- Create: `src/app/auth/callback/route.ts`

```typescript
// src/app/auth/callback/route.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/app/dashboard";

  if (code) {
    const response = NextResponse.redirect(new URL(next, request.url));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // Write cookies to the redirect response, not the request
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    await supabase.auth.exchangeCodeForSession(code);
    return response;
  }

  // No code present — redirect to login
  return NextResponse.redirect(new URL("/auth/login", request.url));
}
```

**⚠️ Key pattern:** In route handlers (unlike middleware), `setAll` must write to the `NextResponse` object, not to a result of `NextResponse.next({ request })`. Create the response FIRST, pass it to `setAll`'s cookies, then return it after `exchangeCodeForSession`.

**Supabase Auth redirect URL:** In Supabase Dashboard → Authentication → URL Configuration, set `Site URL` to `http://localhost:3000` (dev) and the production URL. Redirect URLs: `http://localhost:3000/auth/callback`, `https://<prod>/auth/callback`.

**Verification:** After login (P2.2), verify the callback route receives and processes the redirect from Supabase.

---

### P2.2 — Login & Register Pages (0.75h)

**Objective:** Create login and registration pages with email+password auth. Redirects to `/app/dashboard` on success.

**Files:**
- Create: `src/app/auth/login/page.tsx`
- Create: `src/app/auth/register/page.tsx`
- Create: `src/app/auth/layout.tsx` — shared auth layout (centered card)

**Auth layout:**

```tsx
// src/app/auth/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {children}
      </div>
    </div>
  );
}
```

**Login page:**

```tsx
// src/app/auth/login/page.tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/app/dashboard";

  // ... rest stays the same
}
```

**⚠️ Next.js 16 `useSearchParams()`:** This hook requires a `<Suspense>` boundary. Wrap the login page in `src/app/auth/login/page.tsx`:

```tsx
// src/app/auth/login/page.tsx
"use client";
import { Suspense } from "react";
import LoginForm from "./LoginForm"; // Move the form logic here

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="animate-pulse ...">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
```

**Verification:** Navigate to `/auth/login` → enter credentials → redirected to `/app/dashboard`. Navigate to `/auth/register` → create account → see confirmation or redirect.
```

**Register page:** Same structure but calls `supabase.auth.signUp()` with `emailRedirectTo` pointing to `/auth/callback`. Shows "Check your email" confirmation after signup (if email confirmation is enabled).

```typescript
const { error: authError } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback`,
  },
});
```

**Verification:** Navigate to `/auth/login` → enter credentials → redirected to `/app/dashboard`. Navigate to `/auth/register` → create account → see confirmation or redirect.

---

### P2.3 — Auth Hook & User Context (0.5h)

**Objective:** Create a React hook that provides the current user and auth state to any client component. Handles loading, signed-in, and signed-out states.

**Files:**
- Create: `src/lib/hooks/use-auth.ts`
- Create: `src/components/auth/AuthProvider.tsx` (optional context wrapper)

**Auth hook:**

```typescript
// src/lib/hooks/use-auth.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

export function useAuth(): AuthState & {
  signOut: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });

  useEffect(() => {
    const supabase = createClient();

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      });
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
  }, []);

  return { ...state, signOut };
}
```

**Verification:** Mount in a test component → `loading: true` → `user: User | null`. Sign out → `user: null`.

---

### P2.4 — Auth-Aware Header (0.5h)

**Objective:** Replace the placeholder header with a real auth-aware header showing the user's email and a sign-out button.

**Files:**
- Modify: `src/app/(app)/layout.tsx` — add user menu
- Create: `src/components/auth/UserMenu.tsx` — dropdown with email + sign out

**UserMenu component:**

```tsx
// src/components/auth/UserMenu.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/hooks/use-auth";

export default function UserMenu() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return <div className="h-8 w-8 rounded-full bg-gray-200 animate-pulse" />;
  }

  if (!user) {
    return null; // Middleware prevents reaching /app/* unauthenticated
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full px-3 py-1 text-sm hover:bg-gray-100 transition-colors"
      >
        <span className="h-7 w-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-medium text-green-800">
          {user.email?.charAt(0).toUpperCase()}
        </span>
        <span className="text-gray-700 hidden sm:inline max-w-[140px] truncate">
          {user.email}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-md bg-white shadow-lg border border-gray-200 py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.email}
            </p>
          </div>
          <button
            onClick={() => { signOut(); setOpen(false); }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

**Updated ForestLayout:**

```tsx
// src/app/(app)/layout.tsx
import UserMenu from "@/components/auth/UserMenu";
import Link from "next/link";

export default function ForestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <header className="h-12 border-b bg-white flex items-center justify-between px-4 shrink-0">
        <Link href="/app/dashboard" className="font-semibold text-gray-900 hover:text-green-700 transition-colors">
          ForestChat
        </Link>
        <UserMenu />
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
```

**Verification:** Sign in → header shows user email + avatar initial. Click user → dropdown with "Sign out". Sign out → redirected to `/auth/login`. Navigate to `/app/*` unauthenticated → redirect.

---

## Track B: Import Backend (~4.5h)

> **Note for subagents:** The MML API uses **HTTP Basic Authentication** — the API key is both the username AND password (`-u "key:key"`). Header-based auth (`-H "api-key: ..."`) does NOT work. The correct base URL must be verified first (see prerequisites). MML OmaTili API keys work immediately after creation — no service activation needed.

### P2.5 — MML API Client Utility (0.75h)

**Objective:** Create a typed client for the MML OGC API Features endpoint that fetches property boundary geometry by Finnish property ID (kiinteistötunnus).

**Files:**
- Create: `src/lib/import/mml-client.ts`

**API details (verified 2026-05-22):**

| Item | Value |
|---|---|
| Base URL | `https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/ogcapi/v1/` (verify with prerequisite check) |
| Collection | `kiinteistotunnukset` or `KiinteistotunnuksenSijaintitiedot` |
| Auth | **HTTP Basic Auth**: username=`api-key-value`, password=`api-key-value` |
| Filter | CQL2 or query parameter: `kiinteistotunnus=989-405-0001-0405` |
| CRS | EPSG:3067 (ETRS-TM35FIN, matches PostGIS geometry columns) |
| License | CC 4.0 |

**⚠️ CQL2 filter note:** The MML OGC API may use a different property name than `kiinteistotunnus`. Common alternatives: `kiinteistotunnus`, `propertyidentifier`, or `kiinteistoTunnus`. The client should handle these gracefully.

```typescript
// src/lib/import/mml-client.ts

const MML_BASE_URL = "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/ogcapi/v1/";
const MML_COLLECTION = "kiinteistotunnukset"; // Verify during prerequisite check

export interface MmlPropertyBoundary {
  propertyId: string;
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
  areaM2: number | null;
}

/**
 * Fetch a property boundary from MML by Finnish property ID.
 * Uses HTTP Basic Authentication: api-key as both username and password.
 * Returns null if the property is not found.
 * Throws on network/auth errors.
 */
export async function fetchPropertyBoundary(
  propertyId: string,
  apiKey: string
): Promise<MmlPropertyBoundary | null> {
  const url = new URL(`${MML_BASE_URL}collections/${MML_COLLECTION}/items`);

  // CQL2 filter by property ID
  url.searchParams.set("filter", `kiinteistotunnus='${propertyId}'`);
  url.searchParams.set("limit", "1");
  url.searchParams.set("crs", "http://www.opengis.net/def/crs/EPSG/0/3067");

  const response = await fetch(url.toString(), {
    headers: {
      // HTTP Basic Auth: api-key is both username and password
      Authorization: `Basic ${btoa(`${apiKey}:${apiKey}`)}`,
      Accept: "application/geo+json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "MML API key not authorized for kiinteisto-avoin. Activate the service in OmaTili."
      );
    }
    throw new Error(`MML API returned ${response.status}: ${await response.text()}`);
  }

  const geojson = await response.json();

  if (!geojson.features || geojson.features.length === 0) {
    return null; // Property not found
  }

  const feature = geojson.features[0];

  return {
    propertyId,
    geometry: feature.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon,
    areaM2: feature.properties?.pinta_ala ?? feature.properties?.area ?? null,
  };
}

**Verification (MANUAL):**
```bash
curl -s -u "$MML_API_KEY:$MML_API_KEY" \
  "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/ogcapi/v1/collections/kiinteistotunnukset/items?kiinteistotunnus=989-405-0001-0405&limit=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Features: {len(d.get(\"features\",[]))}')"
# Expected: Features: 1
# If 404: the endpoint or collection name has changed. Contact MML support.```



---

### P2.6 — Property Boundary Store Service (0.5h)

**Objective:** Create a service that fetches a boundary from MML and stores it in the `property_boundaries` table (PostGIS geometry).

**Files:**
- Create: `src/lib/import/boundary-service.ts`

```typescript
// src/lib/import/boundary-service.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPropertyBoundary } from "./mml-client";
import { env } from "@/lib/env";

/**
 * Fetch property boundary from MML and store it in the database.
 * Returns the stored boundary geometry (as GeoJSON for PostGIS ST_GeomFromGeoJSON).
 */
export async function importPropertyBoundary(
  forestId: string,
  propertyId: string
): Promise<GeoJSON.MultiPolygon> {
  const boundary = await fetchPropertyBoundary(propertyId, env.mmlApiKey);

  if (!boundary) {
    throw new Error(`Property ${propertyId} not found in MML. Check the property ID.`);
  }

  // Use admin client to bypass RLS (import runs server-side)
  const supabase = createAdminClient();

  // Store boundary as PostGIS geometry
  const { error } = await supabase
    .from("property_boundaries")
    .upsert({
      forest_id: forestId,
      property_id: propertyId,
      geometry: boundary.geometry, // PostGIS auto-handles GeoJSON insertion
      fetched_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to store property boundary: ${error.message}`);
  }

  return boundary.geometry;
}
```

**⚠️ Admin client note:** `createAdminClient()` is already defined in `src/lib/supabase/admin.ts` (Phase 0). It uses `SUPABASE_SECRET_KEY` which bypasses RLS — required for server-side data import where there's no user session context.

**Verification:** Unit test mocking MML client → boundary stored in `property_boundaries` table via admin client.

---

### P2.7 — Metsäkeskus WFS Client (1h)

**Objective:** Create a client for Metsäkeskus WFS that fetches stand (kuvio) polygons and attributes by bounding box.

**Files:**
- Create: `src/lib/import/wfs-client.ts`

**API details (verified 2026-05-22):**

| Item | Value |
|---|---|
| Base URL | `https://avoin.metsakeskus.fi/geoserver/v1/ows` |
| Layer | `v1:stand` |
| Auth | None (anonymous) |
| Output | GeoJSON with EPSG:3067 CRS |
| Filter | BBOX spatial filter |

**⚠️ CRITICAL:** The WFS `v1:stand` layer returns field names in **UPPERCASE** with **coded values**, NOT human-readable strings. The plan below uses the verified field names. See `src/lib/import/code-tables.ts` for code→text mappings.

**Actual WFS fields (verified):**

| WFS field | Type | Example | Maps to |
|---|---|---|---|
| `STANDNUMBER` | number | 77 | `stand_id` |
| `AREA` | float | 0.718 | `area_ha` |
| `DEVELOPMENTCLASS` | **code** | "Y1" | `development_class` (needs code table!) |
| `FERTILITYCLASS` | **code** | 3 | `site_type` (code table) |
| `MAINGROUP` | **code** | 1 | `main_species` (code table) |
| `MAINTREESPECIES` | **code** | 2 | tree species (code table) |
| `SOILTYPE` | **code** | 10 | `soil_type` (code table) |
| `DRAINAGESTATE` | **code** | 2 | `drainage_status` (code table) |
| `MEANAGE` | int | 59 | `age_years` |
| `VOLUME` | float | 40.18 | `volume_m3` |
| `BASALAREA` | float | 5.8 | `basal_area` |
| `MEANDIAMETER` | float | 22.49 | `avg_diameter` |
| `MEANHEIGHT` | float | 15.48 | `avg_height` |
| `VOLUMEGROWTH` | float | 1.09 | `growth_m3_per_ha` |
| `SAWLOGVOLUME` | float | 7.3 | → `attributes` JSONB |
| `PULPWOODVOLUME` | float | 32.49 | → `attributes` JSONB |
| `PROPORTIONPINE` | ratio | 0 | → `attributes` JSONB |
| `PROPORTIONSPRUCE` | ratio | 0.002 | → `attributes` JSONB |
| `PROPORTIONOTHER` | ratio | 0.998 | → `attributes` JSONB |
| `STEMCOUNT` | int | 150 | → `attributes` JSONB |
| `CUTTINGTYPE` | **code** | 1 | Pre-existing harvest proposal |
| `CUTTINGPROPOSALYEAR` | year | 2028 | Pre-existing harvest year |
| `SILVICULTURETYPE` | **code** | 2 | Pre-existing silviculture proposal |
| `SILVICULTUREPROPOSALYEAR` | year | 2029 | Pre-existing silviculture year |
| `STANDCLASS` | code | 4101 | → `attributes` JSONB |
| `MEASUREMENTDATE` | date | 2021-06-24 | → `attributes` JSONB |
| `TREESTANDDATE` | date | 2026-01-01 | → `attributes` JSONB |

**Geometry type:** WFS returns `Polygon` (not `MultiPolygon`). PostGIS auto-casts Polygon→MultiPolygon on insert.

**Code tables** (created in `src/lib/import/code-tables.ts`):

```typescript
// src/lib/import/code-tables.ts
// Finnish Forest Centre code→text mappings (Metsätietostandardi)

export const MAINGROUP_MAP: Record<number, string> = {
  1: "Pine",
  2: "Spruce",
  3: "Broadleaf",
};

export const FERTILITYCLASS_MAP: Record<number, string> = {
  1: "herb-rich",        // lehto
  2: "herb-rich heath",  // lehtomainen kangas
  3: "mesic",            // tuore kangas
  4: "sub-xeric",        // kuivahko kangas
  5: "xeric",            // kuiva kangas
  6: "barren",           // karukkokangas
};

export const DEVELOPMENTCLASS_MAP: Record<string, string> = {
  "A0": "open_area",           // Aukea
  "S0": "seedling",            // Taimikko
  "T1": "young_thinning",      // Nuori kasvatusmetsikkö (early)
  "T2": "young_thinning",      // Nuori kasvatusmetsikkö (late)
  "02": "mature_thinning",     // Varttunut kasvatusmetsikkö
  "03": "mature_thinning",     // Varttunut kasvatusmetsikkö
  "Y1": "regeneration_ready",  // Uudistuskypsä
  "04": "regeneration_ready",  // Uudistuskypsä
  "ER": "uneven_aged",         // Eri-ikäisrakenteinen
  "05": "shelterwood",         // Suojuspuusto
};

export function mapWfsCode(table: Record<string, string>, code: unknown): string | null {
  if (code === null || code === undefined) return null;
  return table[String(code)] ?? `unknown:${code}`;
}

export function mapWfsNumericCode(table: Record<number, string>, code: unknown): string | null {
  if (code === null || code === undefined) return null;
  const num = typeof code === "string" ? parseInt(code, 10) : code as number;
  return table[num] ?? null;
}
```

**WFS client:**

```typescript
// src/lib/import/wfs-client.ts
import {
  MAINGROUP_MAP, FERTILITYCLASS_MAP, DEVELOPMENTCLASS_MAP,
  mapWfsCode, mapWfsNumericCode,
} from "./code-tables";

export interface WfsStand {
  standId: string;
  areaHa: number | null;
  mainSpecies: string | null;
  developmentClass: string | null;   // human-readable
  siteType: string | null;           // human-readable
  soilType: string | null;           // raw code (no lookup table yet)
  drainageStatus: string | null;     // raw code (no lookup table yet)
  ageYears: number | null;
  volumeM3: number | null;
  basalArea: number | null;
  avgDiameter: number | null;
  avgHeight: number | null;
  growthM3PerHa: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  attributes: Record<string, unknown>;
}

const WFS_URL = "https://avoin.metsakeskus.fi/geoserver/v1/ows";

/** Bounding box from a GeoJSON Polygon or MultiPolygon. */
function bboxFromGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rings: GeoJSON.Position[][] = geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

export async function fetchStandsByBbox(
  bbox: [number, number, number, number],
  srsName: string = "EPSG:3067"
): Promise<WfsStand[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const url = new URL(WFS_URL);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", "v1:stand");
  url.searchParams.set("srsName", `urn:x-ogc:def:crs:${srsName}`);
  url.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY},urn:x-ogc:def:crs:${srsName}`);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("count", "2000"); // Max features per request

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`WFS returned ${response.status}: ${await response.text().then(t => t.slice(0, 200))}`);
  }

  const geojson = await response.json();
  if (!geojson.features?.length) return [];

  return geojson.features.map((f: GeoJSON.Feature) => {
    const p = f.properties ?? {};
    return {
      standId: String(p.STANDNUMBER ?? "?"),
      areaHa: p.AREA ?? null,
      // Translate codes to human-readable strings
      mainSpecies: mapWfsNumericCode(MAINGROUP_MAP, p.MAINGROUP),
      developmentClass: mapWfsCode(DEVELOPMENTCLASS_MAP, p.DEVELOPMENTCLASS),
      siteType: mapWfsNumericCode(FERTILITYCLASS_MAP, p.FERTILITYCLASS),
      soilType: p.SOILTYPE != null ? String(p.SOILTYPE) : null,
      drainageStatus: p.DRAINAGESTATE != null ? String(p.DRAINAGESTATE) : null,
      // Direct numeric fields (available in WFS)
      ageYears: p.MEANAGE ?? null,
      volumeM3: p.VOLUME ?? null,
      basalArea: p.BASALAREA ?? null,
      avgDiameter: p.MEANDIAMETER ?? null,
      avgHeight: p.MEANHEIGHT ?? null,
      growthM3PerHa: p.VOLUMEGROWTH ?? null,
      geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      // Preserve all original properties for future use
      attributes: p,
    };
  });
}
```

**⚠️ WFS pagination:** The WFS `count=2000` parameter caps results. Properties with >2000 stands need pagination via `startIndex`. Hokkala has 162 stands — well within limits.

**Verification:**
```bash
curl -s "https://avoin.metsakeskus.fi/geoserver/v1/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=v1:stand&count=1&outputFormat=application/json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); f=d['features'][0]; print(list(f['properties'].keys()))"
# Expected: STANDNUMBER, MAINGROUP, DEVELOPMENTCLASS, AREA, VOLUME, MEANAGE, etc.

---

### P2.8 — Spatial Intersection Service (1h)

**Objective:** Create a service that spatially filters stands to only those within the property boundary using PostGIS `ST_Within`.

**Files:**
- Create: `src/lib/import/spatial-service.ts`

```typescript
// src/lib/import/spatial-service.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStandsByBbox, bboxFromGeometry } from "./wfs-client";
import type { WfsStand } from "./wfs-client";
import type { Compartment } from "@/types/database";

/**
 * Intersect fetched WFS stands with the property boundary stored in PostGIS.
 *
 * Flow:
 * 1. Fetch all stands within the property's bounding box from WFS
 * 2. Insert them into a temp staging or filter in-memory via PostGIS query
 * 3. Return only stands whose geometry intersects the property boundary
 *
 * Strategy: Use PostGIS ST_Within by inserting boundary and querying.
 * Since we can't create temp tables easily via Supabase JS, we use
 * an in-memory approach: create a PostGIS geometry from the boundary
 * GeoJSON and filter stands client-side, OR use a Supabase RPC function.
 *
 * For MVP: batch-insert all stands into compartments, then use PostGIS
 * ST_Within in the query to mark/return only those within the boundary.
 * This avoids complex temp-table management.
 */
export async function filterStandsWithinProperty(
  boundaryGeometry: GeoJSON.MultiPolygon,
  stands: WfsStand[],
  forestId: string
): Promise<WfsStand[]> {
  const supabase = createAdminClient();

  // Insert all stands into compartments table (temporarily)
  // Then query with ST_Within to find which ones are inside the boundary
  const compartmentRows = stands.map((stand) => ({
    forest_id: forestId,
    stand_id: stand.standId,
    area_ha: stand.areaHa,
    main_species: stand.mainSpecies,
    development_class: stand.developmentClass,
    site_type: stand.siteType,
    soil_type: stand.soilType,
    drainage_status: stand.drainageStatus,
    age_years: stand.ageYears,
    volume_m3: stand.volumeM3,
    basal_area: stand.basalArea,
    avg_diameter: stand.avgDiameter,
    avg_height: stand.avgHeight,
    growth_m3_per_ha: stand.growthM3PerHa,
    geometry: stand.geometry, // PostGIS auto-handles GeoJSON
    attributes: stand.attributes,
  }));

  const { error } = await supabase.from("compartments").upsert(compartmentRows, {
    onConflict: "forest_id, stand_id",
  });

  if (error) {
    throw new Error(`Failed to insert compartments: ${error.message}`);
  }

  // Query for compartments within the property boundary using PostGIS
  const { data: filtered, error: queryError } = await supabase
    .from("compartments")
    .select("stand_id")
    .eq("forest_id", forestId)
    .filter(
      "geometry",
      "st_within",
      `SRID=3067;${JSON.stringify(boundaryGeometry)}`
    );

  if (queryError) {
    throw new Error(`Spatial filter query failed: ${queryError.message}`);
  }

  const withinStandIds = new Set(filtered?.map((c) => c.stand_id) ?? []);

  // Remove stands outside the boundary
  const outsideStandIds = stands
    .filter((s) => !withinStandIds.has(s.standId))
    .map((s) => s.standId);

  if (outsideStandIds.length > 0) {
    await supabase
      .from("compartments")
      .delete()
      .eq("forest_id", forestId)
      .in("stand_id", outsideStandIds);
  }

  return stands.filter((s) => withinStandIds.has(s.standId));
}
```

**⚠️ Alternative approach (PostGIS RPC):** The `st_within` filter on the Supabase JS client may not support SRID syntax. A more reliable approach is to create a Postgres function:

```sql
-- Add to migration (create new 002_spatial_functions.sql)
CREATE OR REPLACE FUNCTION compartments_within_boundary(
  p_forest_id UUID,
  p_boundary_geojson JSONB
)
RETURNS SETOF compartments
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.*
  FROM compartments c
  JOIN property_boundaries pb ON pb.forest_id = p_forest_id
  WHERE c.forest_id = p_forest_id
    AND ST_Within(c.geometry, ST_GeomFromGeoJSON(p_boundary_geojson::text));
$$;
```

**Decision:** Use the RPC function approach for reliability. Create migration `supabase/migrations/002_spatial_functions.sql`.

**Verification:** Insert 2 test compartments (1 inside boundary, 1 outside) → call function → returns only the inside one.

---

### P2.9 — Import Orchestrator API Route (1.25h)

**Objective:** Create the `POST /api/import/property` API route that orchestrates the full import pipeline: validate input, create forest record, fetch boundary → fetch stands → spatial filter → return result.

**Files:**
- Create: `src/app/api/import/property/route.ts`
- Create: `supabase/migrations/002_spatial_functions.sql` — RPC function for spatial filtering
- Create: `src/lib/import/code-tables.ts` — WFS code → human-readable mappings

**Migration (create new file):**

```sql
-- supabase/migrations/002_spatial_functions.sql
-- Spatial helper functions for the import pipeline

-- Filter compartments within a property boundary
CREATE OR REPLACE FUNCTION compartments_within_boundary(
  p_forest_id UUID,
  p_boundary_geojson JSONB
)
RETURNS TABLE(stand_id TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.stand_id
  FROM compartments c
  WHERE c.forest_id = p_forest_id
    AND ST_Within(
      c.geometry,
      ST_GeomFromGeoJSON(p_boundary_geojson::text)
    );
$$;
```

**API route:**

```typescript
// src/app/api/import/property/route.ts
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPropertyBoundary } from "@/lib/import/mml-client";
import { fetchStandsByBbox, bboxFromGeometry } from "@/lib/import/wfs-client";
import { env } from "@/lib/env";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse request body
    const body = await request.json();
    const { property_id, name } = body;

    if (!property_id || typeof property_id !== "string") {
      return NextResponse.json(
        { error: "property_id (kiinteistötunnus) is required" },
        { status: 400 }
      );
    }

    const forestName = name || `Forest ${property_id}`;

    // 3. Fetch property boundary from MML
    const boundary = await fetchPropertyBoundary(property_id, env.mmlApiKey);

    if (!boundary) {
      return NextResponse.json(
        { error: `Property ${property_id} not found. Check the ID and try again.` },
        { status: 404 }
      );
    }

    // 4. Create forest record
    const admin = createAdminClient();
    const { data: forest, error: forestError } = await admin
      .from("forests")
      .insert({
        owner_id: user.id,
        name: forestName,
        property_id,
        data_source: "mml_wfs",
      })
      .select()
      .single();

    if (forestError || !forest) {
      throw new Error(`Failed to create forest: ${forestError?.message}`);
    }

    // 5. Store property boundary
    const { error: boundaryError } = await admin
      .from("property_boundaries")
      .upsert({
        forest_id: forest.id,
        property_id,
        geometry: boundary.geometry,
        fetched_at: new Date().toISOString(),
      });

    if (boundaryError) {
      throw new Error(`Failed to store boundary: ${boundaryError.message}`);
    }

    // 6. Fetch stands from Metsäkeskus WFS (using bounding box of property)
    const bbox = bboxFromGeometry(boundary.geometry);
    const stands = await fetchStandsByBbox(bbox);

    if (stands.length === 0) {
      return NextResponse.json({
        forest_id: forest.id,
        property_id,
        total_area: boundary.areaM2 ? boundary.areaM2 / 10000 : null,
        compartment_count: 0,
        warning: "No stands found within the property bounding box.",
      });
    }

    // 7. Bulk-insert stands and spatial filter in one step (uses P2.8 service)
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { filterStandsWithinProperty } = await import("@/lib/import/spatial-service");
    const filteredStands = await filterStandsWithinProperty(
      boundary.geometry,
      stands,
      forest.id
    );

    const finalCount = filteredStands.length;

    const totalAreaHa = boundary.areaM2
      ? Math.round((boundary.areaM2 / 10000) * 100) / 100
      : null;

    await admin
      .from("forests")
      .update({
        total_area_ha: totalAreaHa,
        updated_at: new Date().toISOString(),
      })
      .eq("id", forest.id);

    // 10. Return success
    return NextResponse.json({
      forest_id: forest.id,
      property_id,
      total_area_ha: totalAreaHa,
      compartment_count: finalCount,
      fetched_count: stands.length,
      filtered_out: stands.length - finalCount,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Import failed unexpectedly",
      },
      { status: 500 }
    );
  }
}
```

**⚠️ Vercel timeout risk:** The WFS fetch may take 3-8 seconds for large properties. Vercel Hobby tier has a 10-second timeout. For Phase 2 MVP, the synchronous approach is acceptable for properties under ~500 ha. If timeouts occur, Phase 2.1 (async import with polling) will be added. Set `maxDuration: 30` if on Vercel Pro.

**Verification:** POST with `{ property_id: "989-405-0001-0405", name: "Hokkala" }` → returns forest_id + compartment count. `/app/forest/<id>` shows stands on map. Re-import same property → upsert (no duplicates).

---

## Merge Point: Import UI (~3h)

### P2.10 — Import Form Page (0.75h)

**Objective:** Create the "New Forest" page with a form to enter the Finnish property ID and forest name. Validates input format and calls the import API.

**Files:**
- Create: `src/app/(app)/forest/new/page.tsx`

```tsx
// src/app/(app)/forest/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewForestPage() {
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/import/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId.trim(),
          name: name.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Navigate to the new forest
      router.push(`/app/forest/${data.forest_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <h1 className="text-xl font-semibold text-gray-900">
          Import Forest Data
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter your Finnish property ID (kiinteistötunnus). ForestChat will
          automatically fetch your property boundary and stand data from Finnish
          open data sources.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="propertyId"
              className="block text-sm font-medium text-gray-700"
            >
              Property ID
            </label>
            <input
              id="propertyId"
              type="text"
              required
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="989-405-0001-0405"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 font-mono"
            />
            <p className="mt-1 text-xs text-gray-500">
              Format: XXX-XXX-XXXX-XXXX (e.g., 989-405-0001-0405)
            </p>
          </div>

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              Forest name (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hokkala"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !propertyId.trim()}
            className="w-full rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {loading ? "Importing…" : "Import"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**Verification:** Navigate to `/app/forest/new` (must be signed in) → enter property ID → submit → redirect to `/app/forest/<id>` with map showing stands.

---

### P2.11 — Import Progress UI & Loading States (0.75h)

**Objective:** Show a meaningful loading/progress state during import and handle edge cases (no stands found, import error).

**Files:**
- Modify: `src/app/(app)/forest/new/page.tsx` — add progress stages
- Create: `src/components/import/ImportProgress.tsx` — progress indicator

**ImportProgress component:**

```tsx
// src/components/import/ImportProgress.tsx
"use client";

interface ImportProgressProps {
  stage: "idle" | "fetching_boundary" | "fetching_stands" | "storing" | "done" | "error";
  message?: string;
}

const stages: { key: ImportProgressProps["stage"]; label: string }[] = [
  { key: "fetching_boundary", label: "Fetching property boundary from National Land Survey…" },
  { key: "fetching_stands", label: "Fetching stand data from Finnish Forest Centre…" },
  { key: "storing", label: "Processing and storing data…" },
];

export default function ImportProgress({ stage, message }: ImportProgressProps) {
  if (stage === "idle" || stage === "done") return null;

  const currentIndex = stages.findIndex((s) => s.key === stage);

  return (
    <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
      {stage === "error" ? (
        <p className="text-red-700">{message || "Import failed"}</p>
      ) : (
        <div className="space-y-1">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              {i < currentIndex ? (
                <span className="text-green-600">✓</span>
              ) : i === currentIndex ? (
                <span className="animate-spin text-blue-600">⏳</span>
              ) : (
                <span className="text-gray-300">○</span>
              )}
              <span
                className={
                  i < currentIndex
                    ? "text-green-700"
                    : i === currentIndex
                      ? "text-blue-700 font-medium"
                      : "text-gray-400"
                }
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Integration:** Update the import form's `handleSubmit` to progress through stages:
1. `fetching_boundary` → after submit
2. `fetching_stands` → (this is server-side, show briefly)
3. `storing` → after response received
4. `done` → navigate to forest page

**⚠️ Realistic progress:** The API call is synchronous (one HTTP request), so the intermediate stages flash quickly. This UI prepares for the async import (Phase 2.1) where polling will make these stages meaningful. For now, show `fetching_stands` with a minimum 1-second display for UX.

**Verification:** Submit import → progress indicator shows → redirects to forest page on success. Enter invalid property ID → error message shown.

---

### P2.12 — Dashboard / Forest List Page (0.75h)

**Objective:** Replace the empty `/app/dashboard` with a list of the user's forests. Each forest links to its map view.

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/components/forest/ForestList.tsx` — client component with data fetching

**Dashboard page:**

```tsx
// src/app/(app)/dashboard/page.tsx
import ForestList from "@/components/forest/ForestList";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">My Forests</h1>
        <Link
          href="/app/forest/new"
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 transition-colors"
        >
          + Import Forest
        </Link>
      </div>
      <ForestList />
    </div>
  );
}
```

**ForestList component:**

```tsx
// src/components/forest/ForestList.tsx
"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Forest } from "@/types/database";
import Link from "next/link";

export default function ForestList() {
  const [forests, setForests] = useState<Forest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        setLoading(false);
        return;
      }

      supabase
        .from("forests")
        .select("*")
        .eq("owner_id", session.user.id)
        .order("created_at", { ascending: false })
        .then(({ data, error: err }) => {
          if (err) {
            setError(err.message);
          } else {
            setForests(data ?? []);
          }
          setLoading(false);
        });
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-gray-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load forests: {error}
      </div>
    );
  }

  if (forests.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No forests yet.</p>
        <p className="text-sm text-gray-400 mt-1">
          Import your first forest to get started.
        </p>
        <Link
          href="/app/forest/new"
          className="mt-4 inline-block rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 transition-colors"
        >
          Import Forest
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {forests.map((forest) => (
        <Link
          key={forest.id}
          href={`/app/forest/${forest.id}`}
          className="block rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50/50 transition-colors"
        >
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">{forest.name}</h3>
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                {forest.property_id && <span>{forest.property_id}</span>}
                {forest.municipality && <span>· {forest.municipality}</span>}
                {forest.total_area_ha && (
                  <span>· {forest.total_area_ha.toLocaleString()} ha</span>
                )}
              </div>
            </div>
            <span className="text-gray-400">→</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
```

**Update landing page CTA:** Change the "Get Started" link from `/forest/test-1` to point to `/auth/login` or `/auth/register`:

```tsx
// In src/app/page.tsx, change the Link:
<Link
  href="/auth/register"
  className="rounded-full bg-green-700 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-green-800 transition-colors"
>
  Get Started
</Link>
```

**Verification:** Sign in → navigate to `/app/dashboard` → see list of forests (or empty state). Click a forest → navigate to map view. Click "Import Forest" → navigate to `/app/forest/new`.

---

### P2.13 — End-to-End Integration Test (0.75h)

**Objective:** Verify the full Phase 2 pipeline works end-to-end: register → login → import → map view.

**Files:**
- Create: `src/__tests__/integration/import.test.ts` — MSW-mocked import pipeline
- Create: `src/__tests__/components/LoginPage.test.tsx` — login form rendering + validation
- Create: `src/__tests__/unit/mml-client.test.ts` — MML client response parsing

**Checklist (manual):**

1. **Auth flow:**
   - [ ] Navigate to `/app/dashboard` unauthenticated → redirected to `/auth/login`
   - [ ] Click "Create one" → `/auth/register` page renders
   - [ ] Register new account → redirected to `/app/dashboard`
   - [ ] Sign out → redirected to `/auth/login`
   - [ ] Login with existing account → `/app/dashboard`
   - [ ] Header shows user email and avatar

2. **Import flow:**
   - [ ] Navigate to `/app/forest/new` → form renders
   - [ ] Submit empty form → browser validation prevents submission
   - [ ] Submit valid property ID → progress indicator shows → redirect to map
   - [ ] Map shows stand polygons (from real or test data)
   - [ ] Submit invalid property ID → error message displays

3. **Dashboard:**
   - [ ] `/app/dashboard` shows imported forest in list
   - [ ] Click forest → navigates to `/app/forest/<id>`
   - [ ] Empty state shows "No forests yet" with Import button

4. **Edge cases:**
   - [ ] Import the same property ID twice → upsert (no duplicate stands)
   - [ ] Property not found in MML → clear error message
   - [ ] WFS returns no stands → warning shown, forest still created

5. **Code quality:**
   - [ ] `npm run build` succeeds (no type/compilation errors)
   - [ ] `npm test` passes (all unit + integration tests)
   - [ ] No console errors during normal flow
   - [ ] No `NEXT_PUBLIC_MML_API_KEY` or API key leaks in client bundle

**Integration test (MSW-mocked):**

```typescript
// src/__tests__/integration/import.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Mock the full import pipeline
describe("Import API", () => {
  it("POST /api/import/property returns forest_id on success", async () => {
    // Mock MML + WFS responses via MSW
    // Send POST with valid property_id
    // Assert 200 + forest_id + compartment_count
  });

  it("POST /api/import/property returns 401 when unauthenticated", async () => {
    // No auth cookie → 401
  });

  it("POST /api/import/property returns 404 for unknown property", async () => {
    // Mock MML returning empty FeatureCollection
    // Assert 404 + error message
  });
});
```

**Verification:** All 15+ checklist items pass manually. All Vitest tests pass in CI.

---

## Files Created (Summary)

```
src/proxy.ts                                     ← P2.0 Auth proxy (Next.js 16 convention)
src/app/auth/callback/route.ts                    ← P2.1 Auth callback
src/app/auth/layout.tsx                           ← P2.2 Auth layout
src/app/auth/login/page.tsx                       ← P2.2 Login page (Suspense-wrapped)
src/app/auth/login/LoginForm.tsx                  ← P2.2 Login form component
src/app/auth/register/page.tsx                    ← P2.2 Register page
src/lib/hooks/use-auth.ts                         ← P2.3 Auth hook
src/components/auth/UserMenu.tsx                  ← P2.4 User menu
src/lib/import/mml-client.ts                      ← P2.5 MML API client (Basic Auth)
src/lib/import/boundary-service.ts                ← P2.6 Boundary store service
src/lib/import/code-tables.ts                     ← P2.7 WFS code→text lookup tables
src/lib/import/wfs-client.ts                      ← P2.7 WFS client (UPPERCASE fields)
src/lib/import/spatial-service.ts                 ← P2.8 Spatial filter service
src/app/api/import/property/route.ts              ← P2.9 Import API (uses P2.8)
supabase/migrations/002_spatial_functions.sql     ← P2.9 Spatial RPC
src/app/(app)/forest/new/page.tsx                 ← P2.10 Import form
src/components/import/ImportProgress.tsx          ← P2.11 Progress UI
src/app/(app)/dashboard/page.tsx                  ← P2.12 Dashboard
src/components/forest/ForestList.tsx              ← P2.12 Forest list
src/__tests__/integration/import.test.ts          ← P2.13 Integration test
src/__tests__/components/LoginPage.test.tsx       ← P2.13 Component test
src/__tests__/unit/mml-client.test.ts             ← P2.13 Unit test
```

## Files Modified (Summary)

```
src/app/(app)/layout.tsx                          ← P2.4 Auth-aware header
src/app/page.tsx                                  ← P2.12 Update CTA link
Supabase Auth settings                            ← Enable email provider
Supabase URL Configuration                        ← Site URL + redirect URLs
```

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| MML API key not activated for kiinteisto-avoin | **⚠️ Current** | Blocks import | Activate in [OmaTili](https://omatili.maanmittauslaitos.fi) before P2.5 |
| MML OGC API field names differ from plan | Medium | Medium | Subagent validates with real API call, adjusts client |
| Metsäkeskus WFS field names differ | Medium | Medium | Client uses fallback chains (`??`), validated before P2.7 |
| WFS import exceeds Vercel 10s timeout | Medium (large properties) | Medium | Phase 2.1 follow-up: async import with polling |
| Supabase Auth email confirmation required | Low | Low | Disable for dev, enable for production (config toggle) |
| RLS policies block import (admin client) | Low | High | Admin client (`SUPABASE_SECRET_KEY`) bypasses RLS — already verified in Phase 0 |
| Property boundary covers multiple WFS features | Low | Low | BBOX query fetches all, spatial filter removes extras |
| Middleware blocks `/auth/*` routes | Low | Medium | Middleware matcher excludes `/auth/*` explicitly |

---

## Out of Scope (Phase 3+)

- [ ] CSV file upload (backup import path)
- [ ] Async import with polling (Phase 2.1 if timeouts occur)
- [ ] Municipal auto-detection from MML response
- [ ] OAuth providers (Google, GitHub)
- [ ] Password reset flow
- [ ] Email confirmation enforcement
- [ ] Plan sharing UI

---

*Plan version: 1.0 — Created 2026-05-22*
*Derived from: `~/.hermes/plans/forestchat-architecture.md` v3.0, sections 2, 4, 7, and Phase 2 tasks (T3-T5).*