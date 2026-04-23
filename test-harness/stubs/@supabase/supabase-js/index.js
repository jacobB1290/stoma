// Test stub for @supabase/supabase-js. Returns a chainable no-op client so the
// QA kernel can import without exploding. The kernel only touches db.from(...)
// when components call DBKnowledge methods, and the test harness avoids those
// code paths by injecting context directly.

const chain = () => {
  const c = {};
  const noop = () => c;
  ["select","eq","neq","gt","gte","lt","lte","in","is","like","ilike","or","not",
   "order","limit","range","single","maybeSingle","insert","update","upsert",
   "delete","match","contains","containedBy","filter","throwOnError"]
    .forEach((k) => (c[k] = noop));
  c.then = (resolve) => resolve({ data: [], error: null, count: 0 });
  return c;
};

export const createClient = () => ({
  from: () => chain(),
  rpc: () => chain(),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    signOut: async () => ({ error: null }),
  },
});

export default { createClient };
