import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, readdir, readFile, writeFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");

/**
 * Resolves @workspace/* package imports to their TypeScript source files.
 * Required because pnpm workspace symlinks are not created in this environment
 * (pnpm install is blocked by the package firewall for certain transitive deps).
 * Each @workspace package exports its .ts source directly in package.json#exports,
 * so we read those mappings at build time and hand the resolved path to esbuild.
 */
const workspaceResolverPlugin = {
  name: "workspace-resolver",
  setup(build) {
    build.onResolve({ filter: /^@workspace\// }, (args) => {
      // args.path e.g. "@workspace/db" or "@workspace/db/schema"
      const withoutScope = args.path.slice("@workspace/".length); // e.g. "db" or "db/schema"
      const parts = withoutScope.split("/");
      const pkgName = parts[0]; // e.g. "db"
      const subpath = parts.length > 1 ? "./" + parts.slice(1).join("/") : ".";

      const pkgDir = path.join(workspaceRoot, "lib", pkgName);
      const pkgJson = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      const exports = pkgJson.exports ?? {};
      const relPath = exports[subpath];

      if (!relPath) {
        return { errors: [{ text: `No export "${subpath}" in @workspace/${pkgName}` }] };
      }

      return { path: path.resolve(pkgDir, relPath) };
    });
  },
};

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // Resolves @workspace/* packages to their TypeScript source (pnpm symlinks unavailable)
      workspaceResolverPlugin,
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Post-process: esbuild-plugin-pino bakes an absolute outputDir path into every
  // generated worker file.  Replace it with a portable runtime expression so the
  // package works on any machine (VPS, CI, etc.) without modification.
  const DYNAMIC_DIR = `new URL(".", import.meta.url).pathname.replace(/\\/$/, "")`;
  const files = await readdir(distDir);
  for (const file of files) {
    if (!file.endsWith(".mjs")) continue;
    const full = path.join(distDir, file);
    const src = await readFile(full, "utf8");
    const fixed = src.replaceAll(`"${distDir}"`, DYNAMIC_DIR);
    if (fixed !== src) {
      await writeFile(full, fixed, "utf8");
      console.log(`  patched outputDir → runtime __dirname  ${file}`);
    }
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
