import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentSelector } from "../components/environment-selector";
import { ENVIRONMENT_ORIGINS, environmentDestinations } from "../lib/environment-profiles";

// Public, credential-free static fixtures; no application routes or wallet calls.
async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("pass an output directory");
  await mkdir(output, { recursive: true });
  const css = await readFile(path.join(__dirname, "../app/globals.css"), "utf8");
  const configured = environmentDestinations({ ACKRATE_STAGING_APP_ORIGIN: ENVIRONMENT_ORIGINS.staging, ACKRATE_MAINNET_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet }).destinations;
  const fixtures = [
    { name: "staging", current: "staging" as const, destinations: configured, pending: false },
    { name: "mainnet", current: "mainnet" as const, destinations: configured, pending: false },
    { name: "unconfigured", current: "staging" as const, destinations: environmentDestinations({}).destinations, pending: false },
    { name: "pending", current: "staging" as const, destinations: configured, pending: true },
  ];
  for (const fixture of fixtures) {
    const body = renderToStaticMarkup(<main className="shell"><section className="hero">
      <div><p className="eyebrow">SDK reference application</p><h1>Choose your environment.</h1><p>Synthetic interface fixture. No wallet or payment services are connected.</p></div>
      <div className="network-card glass"><div className="network-card-top"><span>Network</span><b className="success">FIXTURE</b></div>
        <strong>{fixture.current === "staging" ? "Stellar Testnet" : "Stellar Mainnet"}</strong>
        <div className="network-meta">Manifest-bound configuration</div>
        <EnvironmentSelector {...fixture} />
      </div>
    </section></main>);
    await writeFile(path.join(output, `${fixture.name}.html`), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDK environment fixture</title><style>${css.replace(/^@import[^;]+;/gm, "")}</style><body>${body}</body></html>`);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
