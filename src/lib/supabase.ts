import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Supabase/Postgrest errors are plain objects, not `Error` instances — `e instanceof Error`
 * silently fails for them and hides the real message. Use this in catch blocks instead.
 */
export function getErrorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}

/**
 * `supabase.functions.invoke()` collapses every non-2xx response into the generic
 * "Edge Function returned a non-2xx status code" message — the actual error body our
 * function sends back (`{ error: "..." }`) is only reachable via `error.context`, the raw
 * Response object. This unwraps it so the UI can show the real reason.
 */
export async function getEdgeFunctionErrorMessage(e: unknown, fallback = 'Something went wrong'): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    try {
      const body = await e.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // Response body wasn't JSON — fall through to the generic message below.
    }
  }
  return getErrorMessage(e, fallback);
}
