// Lecture complète d'une requête Supabase : PostgREST plafonne chaque réponse à 1 000 lignes
// (« max rows » du projet), un .limit() plus grand est ignoré. `build` renvoie une requête neuve,
// triée de façon stable (sinon des lignes peuvent sauter d'une page à l'autre).
export const PAGE_SIZE = 1000;

export async function fetchAll<T = any>(build: () => any, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, Math.min(from + PAGE_SIZE, max) - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return out;
}
