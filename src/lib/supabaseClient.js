import { createClient } from "@supabase/supabase-js";
import { auth } from "./firebase";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  },
});