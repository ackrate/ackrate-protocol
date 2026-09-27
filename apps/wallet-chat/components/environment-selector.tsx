import { useId } from "react";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { ENVIRONMENT_ORIGINS, type EnvironmentDestination, type EnvironmentProfileId } from "@/lib/environment-profiles";

interface ProfileDefinition {
  id: EnvironmentProfileId;
  name: string;
  descriptor: string;
  deployment: EnvironmentDestination["deployment"];
  network: EnvironmentDestination["network"];
}

/** Display copy comes from these fixed definitions, never from the config payload. Staging first. */
const PROFILES: readonly ProfileDefinition[] = [
  { id: "staging", name: "SDK Staging", descriptor: "Stellar Testnet · test XLM", deployment: "staging", network: "testnet" },
  { id: "mainnet", name: "SDK Mainnet", descriptor: "Stellar Mainnet · real USDC", deployment: "production", network: "mainnet" },
];

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A destination links only when it is the single entry for its profile and carries the exact allowlisted origin. */
function allowlistedOrigin(profile: ProfileDefinition, current: EnvironmentProfileId, destinations: EnvironmentDestination[]): string | null {
  // The array arrives as JSON from /api/config; anything unexpected is treated as unconfigured.
  const matches = Array.isArray(destinations) ? destinations.filter((destination) => destination?.id === profile.id) : [];
  if (matches.length !== 1) return null;
  const [destination] = matches;
  const approved = ENVIRONMENT_ORIGINS[profile.id];
  if (destination.origin !== approved || destination.deployment !== profile.deployment || destination.network !== profile.network) return null;
  if (!isHttpsOrigin(approved) || approved === ENVIRONMENT_ORIGINS[current]) return null;
  return approved;
}

export function EnvironmentSelector({ current, destinations, pending }: { current: EnvironmentProfileId; destinations: EnvironmentDestination[]; pending: boolean }) {
  const labelId = useId();
  const noteId = useId();
  const reasonId = useId();
  const rows = PROFILES.map((profile) => ({
    profile,
    href: profile.id === current ? null : allowlistedOrigin(profile, current, destinations),
  }));
  const paused = pending && rows.some((row) => row.href);

  return (
    <nav className="profile-switch" aria-labelledby={labelId}>
      <span id={labelId} className="profile-switch-label">DEPLOYMENT PROFILE</span>
      <ul>
        {rows.map(({ profile, href }) => {
          const name = <span className="profile-name"><strong>{profile.name}</strong><small>{profile.descriptor}</small></span>;
          if (profile.id === current) {
            return <li key={profile.id} aria-current="true"><div className="profile-row is-current">{name}<b className="profile-chip">CURRENT</b></div></li>;
          }
          if (!href) {
            return <li key={profile.id}><div className="profile-row is-unavailable">{name}<span className="profile-action">Not configured</span></div></li>;
          }
          if (pending) {
            return <li key={profile.id}><a className="profile-row is-paused" role="link" aria-disabled="true" aria-describedby={`${reasonId} ${noteId}`}>{name}<span className="profile-action">Paused</span></a></li>;
          }
          return <li key={profile.id}><a className="profile-row" href={href} rel="noopener noreferrer" aria-describedby={noteId}>{name}<span className="profile-action">Open <ArrowUpRight size={12} aria-hidden /></span></a></li>;
        })}
      </ul>
      {paused && <p id={reasonId} className="profile-switch-reason">Waiting for LOBSTR. Finish or cancel the current request before switching profiles.</p>}
      <p id={noteId} className="profile-switch-note"><LockKeyhole size={12} aria-hidden /> Profiles are separate deployments with their own sign-in. Switching does not revoke mandates here.</p>
    </nav>
  );
}
