// Loads tests/fixtures/synthetic/*.json (committed) and tests/fixtures/real/**/*.json
// (real captures placed by the PL, git-ignored; may be absent).

const synthetic = import.meta.glob<unknown>("../fixtures/synthetic/*.json", {
  eager: true,
  import: "default",
});

export const realFixtures: Record<string, unknown> = import.meta.glob<unknown>(
  "../fixtures/real/**/*.json",
  { eager: true, import: "default" },
);

export function loadFixture(name: string): unknown {
  const data = synthetic[`../fixtures/synthetic/${name}`];
  if (data === undefined) {
    throw new Error(`fixture not found: ${name}`);
  }
  // Deep copy so a test cannot mutate what another test sees.
  return structuredClone(data);
}
