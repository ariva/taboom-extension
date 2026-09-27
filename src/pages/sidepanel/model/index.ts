// Pure view logic for the side panel - easier to test.
// Barrel: the logic lives in the model-*.ts modules next to this file, split by concern.
// Existing importers and tests keep using this path; new code may import the specific
// module. The split modules never import this barrel (that would be an import cycle).
export * from "./derived.ts";
export * from "./search.ts";
export * from "./filters.ts";
export * from "./groups.ts";
export * from "./windows.ts";
export * from "./rows.ts";
