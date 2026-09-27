import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentSelector } from "../components/environment-selector";
import { ENVIRONMENT_ORIGINS, environmentDestinations, type EnvironmentDestination } from "../lib/environment-profiles";

const configured = environmentDestinations({ ACKRATE_STAGING_APP_ORIGIN: ENVIRONMENT_ORIGINS.staging, ACKRATE_MAINNET_APP_ORIGIN: ENVIRONMENT_ORIGINS.mainnet }).destinations;
const render = (current: "staging" | "mainnet", destinations = configured, pending = false) => renderToStaticMarkup(createElement(EnvironmentSelector, { current, destinations, pending }));

test("each current environment has one plain same-tab link to its separately configured counterpart", () => {
  for (const current of ["staging", "mainnet"] as const) {
    const markup = render(current);
    const other = current === "staging" ? "mainnet" : "staging";
    assert.equal((markup.match(/aria-current="true"/g) ?? []).length, 1);
    assert.equal((markup.match(/href=/g) ?? []).length, 1);
    assert.ok(markup.includes(`href="${ENVIRONMENT_ORIGINS[other]}"`));
    assert.ok(!markup.includes(`href="${ENVIRONMENT_ORIGINS[current]}"`));
    assert.doesNotMatch(markup, /target=|onClick|href="#"/);
    assert.match(markup, /SDK Staging/);
    assert.match(markup, /Stellar Testnet · test XLM/);
    assert.match(markup, /Stellar Mainnet · real USDC/);
    assert.match(markup, /Switching does not revoke mandates here/);
  }
});

test("missing, hostile, duplicate and mixed-network destinations never become links", () => {
  const mainnet = configured[1];
  const cases: EnvironmentDestination[][] = [
    environmentDestinations({}).destinations,
    [{ ...mainnet, origin: "https://attacker.example" }],
    [{ ...mainnet, origin: "javascript:alert(1)" }],
    [{ ...mainnet, network: "testnet" }],
    [{ ...mainnet, deployment: "staging" }],
    [mainnet, mainnet],
  ];
  for (const destinations of cases) {
    const markup = render("staging", destinations);
    assert.doesNotMatch(markup, /href=/);
    assert.match(markup, /Not configured/);
    assert.doesNotMatch(markup, /attacker|javascript:/);
  }
});

test("a pending wallet action removes navigation and describes the pause without hiding the current profile", () => {
  const markup = render("staging", configured, true);
  assert.doesNotMatch(markup, /href=/);
  assert.match(markup, /role="link" aria-disabled="true" aria-describedby="[^"]+ [^"]+"/);
  assert.match(markup, /Paused/);
  assert.match(markup, /Waiting for LOBSTR/);
  assert.equal((markup.match(/aria-current="true"/g) ?? []).length, 1);
  assert.match(render("staging", configured, false), /href=/);
});
