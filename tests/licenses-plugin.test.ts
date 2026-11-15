import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ownLicense,
  packageDirOf,
  repositoryUrl,
  SERVER_PACKAGES,
} from "../scripts/licenses-plugin";

/** A relative import's file, as the bundler finds it. */
function resolveSource(from: string, specifier: string): string {
  const target = path.resolve(path.dirname(from), specifier);
  const file = [
    target,
    target.replace(/\.js$/, ".ts"),
    `${target}.ts`,
    path.join(target, "index.ts"),
  ].find((candidate) =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
  );
  if (!file) throw new Error(`${from}: cannot resolve ${specifier}`);
  return file;
}

/**
 * The packages an entry's code imports, following its own imports. Type-only
 * imports are left out: they never reach the bundle.
 */
function packagesImportedFrom(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = [path.resolve(import.meta.dirname, entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const [
      ,
      typeOnly,
      staticSpecifier,
      dynamicSpecifier,
    ] of source.matchAll(
      /\b(?:import|export)\s+(type\s+)?(?:[^;"]*?\bfrom\s*)?"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)/g,
    )) {
      const specifier = staticSpecifier ?? dynamicSpecifier;
      if (typeOnly) continue;
      if (specifier.startsWith(".")) queue.push(resolveSource(file, specifier));
      else if (!specifier.startsWith("cloudflare:")) {
        const parts = specifier.split("/");
        packages.add(
          specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0],
        );
      }
    }
  }
  return packages;
}

describe("licenses plugin", () => {
  it("lists every package the Worker imports", () => {
    expect([...packagesImportedFrom("../src/worker/main.ts")].sort()).toEqual(
      [...SERVER_PACKAGES].sort(),
    );
  });

  // The puzzle worker is a bundle of its own, which the plugin does not see.
  // Importing a package there needs the plugin to list it first.
  it("keeps packages out of the puzzle worker", () => {
    expect([...packagesImportedFrom("../src/ui/puzzle-worker.ts")]).toEqual([]);
  });

  it("finds the package a bundled module comes from", () => {
    expect(
      packageDirOf("/repo/node_modules/uqr/dist/index.mjs?commonjs-proxy"),
    ).toBe("/repo/node_modules/uqr");
    expect(
      packageDirOf(
        "\0/repo/node_modules/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js",
      ),
    ).toBe("/repo/node_modules/@vue/runtime-dom");
    // A package nested inside another one is its own package.
    expect(
      packageDirOf("C:\\repo\\node_modules\\a\\node_modules\\b\\i.js"),
    ).toBe("C:/repo/node_modules/a/node_modules/b");
    expect(packageDirOf("/repo/src/App.vue")).toBeNull();
  });

  it("keeps a licence's own text, not its bundled dependencies'", () => {
    const vite = [
      "# Vite core license",
      "MIT License",
      "",
      "# Licenses of bundled dependencies",
      "## @jridgewell/trace-mapping",
    ].join("\n");
    expect(ownLicense("vite", vite)).toBe("# Vite core license\nMIT License");
    expect(ownLicense("vue", "MIT License\n\nCopyright (c) Vue\n")).toBe(
      "MIT License\n\nCopyright (c) Vue",
    );
    // Another package may inline its dependencies into the browser code:
    // their notices stay.
    expect(ownLicense("some-lib", vite)).toBe(vite);
  });

  it("turns the repository field into a page to link to", () => {
    expect(
      repositoryUrl({
        repository: { url: "git+https://github.com/vuejs/core.git" },
      }),
    ).toBe("https://github.com/vuejs/core");
    expect(repositoryUrl({ repository: "unjs/uqr" })).toBe(
      "https://github.com/unjs/uqr",
    );
    expect(repositoryUrl({ repository: "github:block65/web-push" })).toBe(
      "https://github.com/block65/web-push",
    );
    expect(repositoryUrl({ homepage: "https://example.test/" })).toBe(
      "https://example.test/",
    );
    expect(repositoryUrl({})).toBeNull();
    expect(
      repositoryUrl({ repository: "git+ssh://git@github.com/o/r.git" }),
    ).toBe("https://github.com/o/r");
    expect(repositoryUrl({ repository: "git@gitlab.com:o/r.git" })).toBe(
      "https://gitlab.com/o/r",
    );
    expect(repositoryUrl({ repository: "gitlab:o/r" })).toBe(
      "https://gitlab.com/o/r",
    );
    // A homepage that is not a web page is not linked.
    expect(repositoryUrl({ homepage: "javascript:alert(1)" })).toBeNull();
    expect(repositoryUrl({ homepage: "./docs" })).toBeNull();
  });
});
