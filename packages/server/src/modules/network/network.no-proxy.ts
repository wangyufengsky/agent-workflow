import { BlockList, isIP } from 'node:net';

type Rule =
  | { kind: 'any' }
  | { kind: 'name'; name: string; port?: number }
  | { kind: 'ip'; ips: BlockList; port?: number };

/** `host[:port]` or `[v6][:port]` of a NO_PROXY entry; an unbracketed IPv6 address has no port. */
function splitPort(entry: string): { host: string; port?: number } {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
  if (bracketed?.[1] !== undefined) {
    return { host: bracketed[1], ...(bracketed[2] === undefined ? {} : { port: Number(bracketed[2]) }) };
  }
  const named = /^([^:]+):(\d+)$/.exec(entry);
  if (named?.[1] !== undefined) return { host: named[1], port: Number(named[2]) };
  return { host: entry };
}

const familyOf = (ip: string) => (isIP(ip) === 4 ? 'ipv4' : 'ipv6');

function ruleOf(entry: string): Rule {
  if (entry === '*') return { kind: 'any' };
  const { host, port } = splitPort(entry);
  const withPort = port === undefined ? {} : { port };
  const [address = '', bits] = host.split('/');
  const maxBits = isIP(address) === 4 ? 32 : 128;
  // An entry that is no address or network is taken as a name, which no address matches (curl ignores it too).
  if (isIP(address) !== 0 && (bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= maxBits))) {
    const ips = new BlockList();
    if (bits === undefined) ips.addAddress(address, familyOf(address));
    else ips.addSubnet(address, Number(bits), familyOf(address));
    return { kind: 'ip', ips, ...withPort };
  }
  return { kind: 'name', name: host.replace(/^\*?\./, '').replace(/\.$/, ''), ...withPort };
}

/**
 * Which requests go direct by the NO_PROXY entries (D174), whatever client makes them: `*`; a name, which also matches
 * its subdomains (`corp.example`, `.corp.example` and `*.corp.example` alike); an IPv4 or IPv6 address or network
 * (`10.0.0.0/8`, `fd00::/8`); any of them with `:port`. As in curl, an IP rule only matches an address written in the
 * URL and a name rule only a name: nothing is resolved. Node and bun know no networks and match addresses as text,
 * which is why their requests reach this one matcher through the forwarding proxy.
 */
export function noProxyMatcher(entries: readonly string[]): (host: string, port: number) => boolean {
  const rules = entries
    .flatMap((e) => e.split(','))
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '')
    .map(ruleOf);
  return (rawHost, port) => {
    const host = rawHost
      .toLowerCase()
      .replace(/^\[(.*)\]$/, '$1')
      .replace(/\.$/, '');
    const ip = isIP(host) === 0 ? null : host;
    return rules.some((rule) => {
      if (rule.kind === 'any') return true;
      if (rule.port !== undefined && rule.port !== port) return false;
      if (rule.kind === 'ip') return ip !== null && rule.ips.check(ip, familyOf(ip));
      return ip === null && (host === rule.name || host.endsWith(`.${rule.name}`));
    });
  };
}

/**
 * The entries as Chromium's proxy bypass rules (D176), which know networks themselves: a name matches only itself
 * there, so its subdomains are added; Chromium never sends loopback addresses to a proxy anyway.
 */
export function chromiumBypassRules(entries: readonly string[]): string {
  return entries
    .flatMap((entry) => {
      const { host, port } = splitPort(entry.trim().toLowerCase());
      const suffix = port === undefined ? '' : `:${port}`;
      if (host === '*' || host.includes('/')) return [host];
      if (isIP(host) !== 0) return [isIP(host) === 6 ? `[${host}]${suffix}` : `${host}${suffix}`];
      const name = host.replace(/^\*?\./, '');
      return [`${name}${suffix}`, `*.${name}${suffix}`];
    })
    .join(';');
}
